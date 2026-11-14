/**
 * 循迹 (dsh-thesis-trail): track falsifiable theses over time.
 *
 * State lives in one SQLite file under `~/.dsh/thesis-trail/` so a scheduled
 * pass, a manual pass from the panel, and a normal conversation all read and
 * write the same record of what was checked and what changed.
 *
 * The record is shared between the reader and the Agent. Every change to a
 * topic's definition, every comment, and every reply goes into `topic_log` with
 * its author, so each side sees what the other did on its next look. A field the
 * reader edited last is theirs: the Agent cannot overwrite it, only propose a
 * change that the panel shows as tracked changes for the reader to accept.
 * Comments can point at a passage (field + quoted text) and form threads; a
 * comment that asks the AI starts a pass right away.
 *
 * Passes run inside this plugin: its own timer decides when, and each due topic
 * is researched with one DeepSeek API request that searches and reads the web on
 * the service side (see research.js). No dsh session or schedule task is used.
 *
 * @module dsh-thesis-trail
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  MODE_OF, RESEARCH_MODEL, answerProse, latestSlot, nextSlot, parseAnswer, researchPrompt, runResearch, toolCounts,
} from './research.js'
import { boardToMarkdown, parseBoardMarkdown } from './board-file.js'

export const name = 'thesis-trail'
export const inject = ['tools', 'webServer', 'schedule']

const API_PREFIX = '/api/thesis-trail'
/** Pass time for a new board, local wall clock. */
const DEFAULT_TIME = '08:30'

/**
 * DeepSeek list prices in CNY per million tokens, from the official page. Peak
 * hours are Beijing time, Monday to Friday, 09:00-12:00 and 14:00-18:00; public
 * holidays are not modelled, so a holiday pass is priced as a working day. A
 * bundle row can replace or extend `models` with `config.prices`.
 */
export const DEFAULT_PRICES = {
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  checked_at: '2026-11-14',
  currency: 'CNY',
  models: {
    'deepseek-flash': { peak: { input: 2, cache_hit: 0.04, output: 8 }, off: { input: 1, cache_hit: 0.02, output: 4 } },
    'deepseek-v4-pro': { peak: { input: 9, cache_hit: 0.3, output: 27 }, off: { input: 4.5, cache_hit: 0.15, output: 13.5 } },
  },
  // Each billed search query and each fetched page: 5 CNY per 1,000.
  tools: { search: 0.005, fetch: 0.005 },
}
/** How often the plugin's timer looks for a scheduled pass that is due. */
const TICK_MS = 60 * 1000
/** Topics researched at the same time within one pass. */
const RESEARCH_CONCURRENCY = 2
/** An open run older than this was interrupted (dsh quit mid-pass). */
const STALE_RUN_MS = 2 * 60 * 60 * 1000
/** Waits before the first and second retry of a topic whose research failed for a passing reason. */
const RETRY_DELAYS_MS = [5 * 60 * 1000, 20 * 60 * 1000]
/** Failures worth retrying: the network, rate limits, the server, an answer without a result block. */
const TRANSIENT_ERROR = /^(request_failed|stream_failed|generation_failed|no_json_in_answer|http_(408|429|5\d\d))\b/
/** Research requests per topic that keep their full text; older ones keep numbers and summary only. */
const RESEARCH_LOG_KEEP = 6

/** Topic columns that carry authored content; every change to them is logged. */
const TOPIC_FIELDS = ['title', 'thesis', 'falsifier', 'bull_case', 'bear_case', 'metric', 'status']
const REQUIRED_FIELDS = new Set(['title', 'thesis', 'falsifier'])
const HUMAN_STATUSES = ['active', 'paused', 'closed']
const AGENT_STATUSES = ['active', 'paused', 'closed', 'merged']
/** Log kinds whose `changes` were applied to the topic and so decide who owns a field. */
const APPLIED_KINDS = ['create', 'edit', 'accept']
/**
 * How often a topic is checked again, by importance. Only the reader sets it.
 * The slack keeps a check that ran a little late from pushing the next one past
 * the scheduled pass: a pass at 08:30 that closes at 08:40 must still find the
 * topic due at tomorrow's 08:30.
 */
const IMPORTANCE = ['high', 'medium', 'low']
const DEFAULT_IMPORTANCE = 'medium'
/**
 * Rough CNY cost of researching one topic once, by importance, from real
 * requests in November 2026: a deep search runs about ¥0.20, a plain search
 * about ¥0.05. Only used to tell the reader what an import will cost.
 */
const PASS_ESTIMATE = { high: 0.2, medium: 0.05, low: 0.03 }
const DAY_MS = 24 * 60 * 60 * 1000
const RECHECK_MS = { high: DAY_MS, medium: 7 * DAY_MS, low: 30 * DAY_MS }
const RECHECK_SLACK_MS = 12 * 60 * 60 * 1000
/** Fields a comment can point into. */
const ANCHOR_FIELDS = ['title', 'thesis', 'falsifier', 'bull_case', 'bear_case', 'metric']
// Evidence older than this gets a warning: a quarterly report is superseded in ~90 days.
const STALE_EVIDENCE_DAYS = 120

/** "2026-11-14" in the given time zone. */
function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Whole days from an ISO date to now, or null when the date does not parse. */
function daysSince(iso) {
  const at = Date.parse(String(iso ?? ''))
  return Number.isNaN(at) ? null : Math.floor((Date.now() - at) / 86400000)
}

// ------------------------------------------------------------------ usage

/** Whether DeepSeek bills a request sent at this instant at the peak price. */
export function isPeak(ms) {
  // Beijing time has no daylight saving, so a fixed offset is exact.
  const local = new Date(ms + 8 * 3600 * 1000)
  const day = local.getUTCDay()
  if (day === 0 || day === 6) return false
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes()
  return (minute >= 9 * 60 && minute < 12 * 60) || (minute >= 14 * 60 && minute < 18 * 60)
}

/** Cost in CNY of one token row, or null when the model has no known price. */
export function costOf(prices, model, period, row) {
  const rate = prices.models?.[model]?.[period]
  if (!rate) return null
  return (row.input * rate.input + row.cache_hit * rate.cache_hit + row.output * rate.output) / 1e6
}

/** A short board id from a ticker in parentheses or the title's ASCII words. */
function slugOf(title) {
  const ticker = /[（(]\s*([A-Za-z0-9.]{1,12})\s*[)）]/u.exec(title)?.[1]
  const source = ticker ?? title
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS board (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  thesis TEXT NOT NULL,
  falsifier TEXT NOT NULL,
  bull_case TEXT,
  bear_case TEXT,
  metric TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into TEXT,
  next_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  run_id INTEGER,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT,
  published_at TEXT,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  direction INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence_topic (
  evidence_id INTEGER NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (evidence_id, topic_id)
);

CREATE TABLE IF NOT EXISTS assessment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  run_id INTEGER,
  created_at TEXT NOT NULL,
  stance REAL NOT NULL,
  confidence REAL,
  rationale TEXT NOT NULL,
  flipped INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT,
  queries INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seen (
  board_id TEXT PRIMARY KEY,
  last_evidence_id INTEGER NOT NULL DEFAULT 0,
  last_assessment_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per change, note, proposal, decision or reply, from either side.
--   author: human | agent
--   kind:   create | edit | note | proposal | accept | reject | reply
--   state:  human rows   open (the Agent has not looked) → seen | answered,
--                        or withdrawn when the reader resolves the thread first
--           proposal     pending → accepted | rejected | superseded
--           agent edit   applied → reverted
--           others       done
--   changes: JSON { field: { from, to } }
--   ref_id:  reply → the row it answers (a thread is a note plus its replies);
--            accept/reject → the proposal; a human edit that undoes an Agent
--            edit → that edit
--   anchor:  note only, JSON { field, quote, start? }: the passage commented on
--   ask_ai:  1 when the reader asked the AI to handle it now (starts a pass)
--   resolved_at: on a thread's first row, when the reader marked it resolved
CREATE TABLE IF NOT EXISTS topic_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  run_id INTEGER,
  created_at TEXT NOT NULL,
  changes TEXT,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'done',
  ref_id INTEGER
);

-- One scheduled pass: the turn its schedule reminder started, read back from the
-- session log. A pass is final once that turn has ended.
CREATE TABLE IF NOT EXISTS pass (
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  board_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  searches INTEGER NOT NULL DEFAULT 0,
  fetches INTEGER NOT NULL DEFAULT 0,
  final INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, turn)
);

-- Token counts of one pass per model and price period (peak | off). Counts are
-- disjoint: input is uncached input only.
CREATE TABLE IF NOT EXISTS pass_tokens (
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  model TEXT NOT NULL,
  period TEXT NOT NULL,
  input INTEGER NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, turn, model, period)
);


CREATE INDEX IF NOT EXISTS topic_board ON topic(board_id, seq);
CREATE INDEX IF NOT EXISTS pass_board ON pass(board_id, started_at);
CREATE INDEX IF NOT EXISTS evidence_board ON evidence(board_id, id DESC);
CREATE INDEX IF NOT EXISTS evidence_topic_topic ON evidence_topic(topic_id);
CREATE INDEX IF NOT EXISTS assessment_topic ON assessment(topic_id, id DESC);
CREATE INDEX IF NOT EXISTS topic_log_topic ON topic_log(topic_id, id DESC);
CREATE INDEX IF NOT EXISTS topic_log_state ON topic_log(board_id, author, state);
`

// ------------------------------------------------------------------ storage

/** dsh's data folder: $DSH_HOME, or ~/.dsh. */
export function dshHome() {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

/** Where the store lives when the bundle row does not name a file. */
export function defaultDatabasePath(home = dshHome()) {
  return join(home, 'thesis-trail', 'trail.db')
}

/** Where this plugin kept its store while it was called research-board. */
export function legacyDatabasePath(home = dshHome()) {
  return join(home, 'research-board', 'board.db')
}

/**
 * Carry the research-board store over on the first start under the new name.
 * VACUUM INTO writes a consistent snapshot that includes WAL content. The old
 * file stays in place, so switching back to the old plugin still finds its data.
 * @returns whether a copy was made.
 */
export function migrateLegacyDatabase(from, to) {
  if (existsSync(to) || !existsSync(from)) return false
  mkdirSync(dirname(to), { recursive: true })
  const legacy = new DatabaseSync(from)
  try {
    legacy.exec('PRAGMA busy_timeout = 5000')
    legacy.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`)
  } finally {
    legacy.close()
  }
  return true
}

/** Add a column to a table created by an older version of this plugin. */
function ensureColumn(db, table, column, ddl) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

/** When a topic checked at `checkedAt` is due again, by its importance. */
function recheckAt(importance, checkedAt) {
  const interval = RECHECK_MS[importance] ?? RECHECK_MS[DEFAULT_IMPORTANCE]
  return new Date(Date.parse(checkedAt) + interval - RECHECK_SLACK_MS).toISOString()
}

function nowIso() {
  return new Date().toISOString()
}

/** Normalize a URL so the same article from two feeds hashes the same. */
function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw).trim())
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|source|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    }
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.hostname.replace(/^www\./, '')}${path}${url.search}`
  } catch {
    return String(raw).trim().toLowerCase()
  }
}

/** Content identity for evidence deduplication. */
function evidenceHash(url, title) {
  return createHash('sha1').update(`${normalizeUrl(url)}\n${String(title).trim().toLowerCase()}`).digest('hex')
}

/** Coerce a value to a finite number in range, or undefined. */
function numberIn(value, min, max) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, parsed))
}

/** Clamp a stance to its declared domain. */
function clampStance(value) {
  return numberIn(value, -1, 1)
}

/** One board id from a request, or '' when it names none. */
function boardOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Trimmed text, or '' for anything missing. */
function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

/** Compare stored and submitted field values: NULL and '' mean the same thing. */
function same(a, b) {
  return text(a) === text(b)
}

function parseChanges(raw) {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** One log row as tools and the panel see it. */
function presentLog(row) {
  return {
    id: Number(row.id),
    topic_id: row.topic_id,
    author: row.author,
    kind: row.kind,
    run_id: row.run_id === null || row.run_id === undefined ? null : Number(row.run_id),
    created_at: row.created_at,
    changes: parseChanges(row.changes),
    body: row.body ?? null,
    state: row.state,
    ref_id: row.ref_id === null || row.ref_id === undefined ? null : Number(row.ref_id),
    anchor: parseChanges(row.anchor ?? null),
    ask_ai: Number(row.ask_ai ?? 0) === 1,
    resolved_at: row.resolved_at ?? null,
  }
}

/**
 * The first row of the thread a row belongs to: walk reply links up to the
 * note (or edit, or proposal) the conversation started from.
 */
function threadRoot(db, id) {
  const get = db.prepare('SELECT * FROM topic_log WHERE id = ?')
  let row = get.get(id)
  for (let depth = 0; row && row.kind === 'reply' && row.ref_id !== null && depth < 64; depth += 1) {
    const parent = get.get(row.ref_id)
    if (!parent) break
    row = parent
  }
  return row
}

/** A thread's rows, oldest first. Replies always come after what they answer. */
function threadRows(db, rootId) {
  const rows = db.prepare(
    'SELECT * FROM topic_log WHERE topic_id = (SELECT topic_id FROM topic_log WHERE id = ?) AND id >= ? ORDER BY id',
  ).all(rootId, rootId)
  const members = new Set()
  const thread = []
  for (const row of rows) {
    const id = Number(row.id)
    if (id === rootId || (row.kind === 'reply' && members.has(Number(row.ref_id)))) {
      members.add(id)
      thread.push(row)
    }
  }
  return thread
}

/**
 * Who last changed each authored field of a topic, and when. Only changes that
 * were applied count: a pending or rejected proposal owns nothing.
 */
function fieldOwners(db, topicId) {
  const owners = {}
  const rows = db.prepare(`
    SELECT id, author, created_at, changes FROM topic_log
    WHERE topic_id = ? AND changes IS NOT NULL AND kind IN (${APPLIED_KINDS.map(() => '?').join(', ')})
    ORDER BY id
  `).all(topicId, ...APPLIED_KINDS)
  for (const row of rows) {
    for (const field of Object.keys(parseChanges(row.changes) ?? {})) {
      owners[field] = { author: row.author, at: row.created_at, log_id: Number(row.id) }
    }
  }
  return owners
}

/** One topic row plus its derived current stance and collaboration counters. */
function topicRows(db, boardId) {
  const rows = db.prepare(`
    SELECT t.*,
      (SELECT a.stance FROM assessment a WHERE a.topic_id = t.id ORDER BY a.id DESC LIMIT 1) AS stance,
      (SELECT a.created_at FROM assessment a WHERE a.topic_id = t.id ORDER BY a.id DESC LIMIT 1) AS stance_at,
      (SELECT a.rationale FROM assessment a WHERE a.topic_id = t.id ORDER BY a.id DESC LIMIT 1) AS stance_reason,
      (SELECT COUNT(*) FROM evidence_topic et JOIN evidence e ON e.id = et.evidence_id
        WHERE et.topic_id = t.id AND e.id > COALESCE((SELECT last_evidence_id FROM seen WHERE board_id = t.board_id), 0)) AS unread,
      (SELECT MAX(e.published_at) FROM evidence_topic et JOIN evidence e ON e.id = et.evidence_id
        WHERE et.topic_id = t.id) AS last_evidence_at,
      (SELECT COUNT(*) FROM evidence_topic et WHERE et.topic_id = t.id) AS evidence_count,
      (SELECT COUNT(*) FROM topic_log l WHERE l.topic_id = t.id AND l.kind = 'proposal' AND l.state = 'pending') AS pending,
      (SELECT COUNT(*) FROM topic_log l WHERE l.topic_id = t.id AND l.author = 'human' AND l.state = 'open') AS waiting,
      (SELECT COUNT(*) FROM topic_log l WHERE l.topic_id = t.id AND l.author = 'agent'
        AND l.id > COALESCE((SELECT last_log_id FROM seen WHERE board_id = t.board_id), 0)) AS agent_new
    FROM topic t
    WHERE t.board_id = ?
    ORDER BY CASE t.importance WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END, t.seq, t.created_at
  `).all(boardId)
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    thesis: row.thesis,
    falsifier: row.falsifier,
    bull_case: row.bull_case,
    bear_case: row.bear_case,
    metric: row.metric,
    status: row.status,
    importance: IMPORTANCE.includes(row.importance) ? row.importance : DEFAULT_IMPORTANCE,
    merged_into: row.merged_into,
    next_due_at: row.next_due_at,
    checked_at: row.checked_at ?? null,
    falsified_at: row.falsified_at ?? null,
    falsified_note: row.falsified_note ?? null,
    updated_at: row.updated_at,
    stance: row.stance === null || row.stance === undefined ? null : Number(row.stance),
    stance_at: row.stance_at ?? null,
    stance_reason: row.stance_reason ?? null,
    evidence_count: Number(row.evidence_count ?? 0),
    unread: Number(row.unread ?? 0),
    last_evidence_at: row.last_evidence_at ?? null,
    pending_proposals: Number(row.pending ?? 0),
    waiting_agent: Number(row.waiting ?? 0),
    agent_new: Number(row.agent_new ?? 0),
  }))
}

/** Stance history for one topic, oldest first. */
function stanceHistory(db, topicId, limit = 24) {
  const rows = db.prepare(
    'SELECT stance, created_at FROM assessment WHERE topic_id = ? ORDER BY id DESC LIMIT ?',
  ).all(topicId, limit)
  return rows.reverse().map(row => ({ at: row.created_at, stance: Number(row.stance) }))
}

/** Board-level unread counters used by the sidebar badge. */
function badgeOf(db, boardId) {
  const cursor = db.prepare('SELECT * FROM seen WHERE board_id = ?').get(boardId)
  const lastEvidence = Number(cursor?.last_evidence_id ?? 0)
  const lastAssessment = Number(cursor?.last_assessment_id ?? 0)
  const lastLog = Number(cursor?.last_log_id ?? 0)
  const unread = db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE board_id = ? AND id > ?').get(boardId, lastEvidence)
  // Only a flip on a high-importance topic raises the red dot; the rest are counted.
  const flips = db.prepare(`
    SELECT SUM(t.importance = 'high') AS high, SUM(t.importance <> 'high') AS other
    FROM assessment a JOIN topic t ON t.id = a.topic_id
    WHERE t.board_id = ? AND a.id > ? AND a.flipped = 1
  `).get(boardId, lastAssessment)
  const agent = db.prepare(
    "SELECT COUNT(*) AS n FROM topic_log WHERE board_id = ? AND author = 'agent' AND id > ?",
  ).get(boardId, lastLog)
  // A falsifier the AI saw met stays on the red dot until the reader dismisses it.
  const falsified = db.prepare(
    "SELECT COUNT(*) AS n FROM topic WHERE board_id = ? AND status = 'active' AND falsified_at IS NOT NULL",
  ).get(boardId)
  return {
    unread: Number(unread?.n ?? 0),
    flipped: Number(flips?.high ?? 0),
    flipped_other: Number(flips?.other ?? 0),
    agent: Number(agent?.n ?? 0),
    falsified: Number(falsified?.n ?? 0),
  }
}

/** Compact state shared by the panel and `trail_brief`. */
function stateOf(db, boardId, options = {}) {
  const board = db.prepare('SELECT * FROM board WHERE id = ?').get(boardId)
  if (!board) return undefined
  const asOf = nowIso()
  // Only an active topic is ever due: a paused one with no due time is not.
  const topics = topicRows(db, boardId).map(topic => ({
    ...topic,
    due: topic.status === 'active' && (topic.next_due_at === null || topic.next_due_at <= asOf),
  }))
  const active = topics.filter(topic => topic.status === 'active')
  const due = topics.filter(topic => topic.due)
  const lastRun = db.prepare('SELECT * FROM run WHERE board_id = ? ORDER BY id DESC LIMIT 1').get(boardId)
  const openRun = db.prepare("SELECT * FROM run WHERE board_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(boardId)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const weekEvidence = db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE board_id = ? AND captured_at >= ?').get(boardId, weekAgo)
  const runs = db.prepare('SELECT COUNT(*) AS n FROM run WHERE board_id = ?').get(boardId)
  const badge = badgeOf(db, boardId)
  const detail = options.detail !== false
  return {
    board: { id: board.id, title: board.title, note: board.note, created_at: board.created_at },
    now: asOf,
    stats: {
      topics: active.length,
      total: topics.length,
      due: due.length,
      runs: Number(runs?.n ?? 0),
      evidence_7d: Number(weekEvidence?.n ?? 0),
      unread: badge.unread,
      flipped: badge.flipped,
      pending_proposals: topics.reduce((sum, topic) => sum + topic.pending_proposals, 0),
      waiting_agent: topics.reduce((sum, topic) => sum + topic.waiting_agent, 0),
      asked_ai: Number(db.prepare(
        "SELECT COUNT(*) AS n FROM topic_log WHERE board_id = ? AND author = 'human' AND state = 'open' AND ask_ai = 1",
      ).get(boardId)?.n ?? 0),
    },
    last_run: lastRun ? {
      id: Number(lastRun.id),
      mode: lastRun.mode,
      status: lastRun.status,
      started_at: lastRun.started_at,
      finished_at: lastRun.finished_at,
      summary: lastRun.summary,
    } : null,
    open_run: openRun ? { id: Number(openRun.id), started_at: openRun.started_at, mode: openRun.mode } : null,
    topics: topics.map(topic => {
      if (!detail) return topic
      const recent = db.prepare(`
        SELECT e.id, e.title, e.source, e.published_at, e.captured_at, e.direction
        FROM evidence e JOIN evidence_topic et ON et.evidence_id = e.id
        WHERE et.topic_id = ? ORDER BY e.id DESC LIMIT 3
      `).all(topic.id)
      return {
        ...topic,
        history: stanceHistory(db, topic.id, 16),
        recent: recent.map(row => ({
          id: Number(row.id),
          title: row.title,
          source: row.source,
          published_at: row.published_at,
          captured_at: row.captured_at,
          direction: Number(row.direction),
        })),
      }
    }),
  }
}

/**
 * What the reader left for the Agent: edits, notes and decisions on proposals
 * that no pass has looked at yet, oldest first.
 */
function inboxOf(db, boardId) {
  const rows = db.prepare(`
    SELECT l.*, t.title AS topic_title FROM topic_log l JOIN topic t ON t.id = l.topic_id
    WHERE l.board_id = ? AND l.author = 'human' AND l.state = 'open'
    ORDER BY l.id
  `).all(boardId)
  const proposal = db.prepare('SELECT * FROM topic_log WHERE id = ?')
  return rows.map(row => {
    const item = presentLog(row)
    const entry = {
      log_id: item.id,
      topic_id: item.topic_id,
      topic_title: row.topic_title,
      kind: item.kind,
      created_at: item.created_at,
      ...item.changes ? { changes: item.changes } : {},
      ...item.body ? { note: item.body } : {},
      ...item.anchor ? { anchor: item.anchor } : {},
      ...item.ask_ai ? { ask_ai: true } : {},
    }
    if (item.kind === 'reply' && item.ref_id !== null) {
      const root = threadRoot(db, item.id)
      if (root) {
        // The conversation so far, so a follow-up can be answered in context.
        entry.thread = threadRows(db, Number(root.id))
          .filter(member => Number(member.id) < item.id)
          .slice(-8)
          .map(member => ({
            log_id: Number(member.id),
            author: member.author,
            kind: member.kind,
            ...member.body ? { body: member.body } : {},
            ...member.anchor ? { anchor: parseChanges(member.anchor) } : {},
            ...member.changes ? { changes: parseChanges(member.changes) } : {},
          }))
      }
    }
    if ((item.kind === 'accept' || item.kind === 'reject') && item.ref_id !== null) {
      const original = proposal.get(item.ref_id)
      if (original) entry.proposal = { log_id: Number(original.id), changes: parseChanges(original.changes), reason: original.body }
    }
    if (item.kind === 'edit' && item.ref_id !== null) entry.reverted_agent_edit = item.ref_id
    return entry
  })
}

/** Per-topic collaboration context the Agent needs before touching a topic. */
function topicCollaboration(db, topicId) {
  const owners = fieldOwners(db, topicId)
  const pending = db.prepare(
    "SELECT * FROM topic_log WHERE topic_id = ? AND kind = 'proposal' AND state = 'pending' ORDER BY id",
  ).all(topicId).map(presentLog)
  const rejected = db.prepare(`
    SELECT p.id, p.changes, p.body AS reason, r.body AS note, r.created_at
    FROM topic_log p JOIN topic_log r ON r.ref_id = p.id AND r.kind = 'reject'
    WHERE p.topic_id = ? AND p.kind = 'proposal' AND p.state = 'rejected'
    ORDER BY r.id DESC LIMIT 3
  `).all(topicId)
  return {
    human_fields: Object.entries(owners)
      .filter(([field, owner]) => owner.author === 'human' && TOPIC_FIELDS.includes(field))
      .map(([field]) => field),
    pending_proposals: pending.map(item => ({
      log_id: item.id,
      fields: Object.keys(item.changes ?? {}),
      to: Object.fromEntries(Object.entries(item.changes ?? {}).map(([field, change]) => [field, change?.to ?? null])),
      created_at: item.created_at,
    })),
    rejected_proposals: rejected.map(row => ({
      log_id: Number(row.id),
      changes: parseChanges(row.changes),
      reason: row.reason,
      ...row.note ? { reader_note: row.note } : {},
      rejected_at: row.created_at,
    })),
  }
}

/** Full evidence, assessment and collaboration history for one topic. */
function timelineOf(db, boardId, topicId, limit = 40, logLimit = 100) {
  const topic = db.prepare('SELECT * FROM topic WHERE id = ? AND board_id = ?').get(topicId, boardId)
  if (!topic) return undefined
  const evidence = db.prepare(`
    SELECT e.* FROM evidence e JOIN evidence_topic et ON et.evidence_id = e.id
    WHERE et.topic_id = ? ORDER BY e.id DESC LIMIT ?
  `).all(topicId, limit).map(row => ({
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    url: row.url,
    source: row.source,
    published_at: row.published_at,
    captured_at: row.captured_at,
    summary: row.summary,
    direction: Number(row.direction),
  }))
  const assessments = db.prepare(
    'SELECT * FROM assessment WHERE topic_id = ? ORDER BY id DESC LIMIT ?',
  ).all(topicId, limit).map(row => ({
    id: Number(row.id),
    created_at: row.created_at,
    stance: Number(row.stance),
    confidence: row.confidence === null ? null : Number(row.confidence),
    rationale: row.rationale,
    flipped: Number(row.flipped) === 1,
  }))
  const log = db.prepare('SELECT * FROM topic_log WHERE topic_id = ? ORDER BY id DESC LIMIT ?')
    .all(topicId, Math.max(limit, logLimit)).map(presentLog)
  return {
    board: boardId,
    topic: {
      id: topic.id,
      title: topic.title,
      thesis: topic.thesis,
      falsifier: topic.falsifier,
      bull_case: topic.bull_case,
      bear_case: topic.bear_case,
      metric: topic.metric,
      status: topic.status,
      merged_into: topic.merged_into,
      next_due_at: topic.next_due_at,
    },
    owners: fieldOwners(db, topicId),
    evidence,
    assessments,
    log,
  }
}

// ------------------------------------------------------------------ tools

/** JSON tool result: schema stays permissive, the value is always JSON. */
function jsonResult(value) {
  return { ok: true, ...value }
}

/**
 * 字段表 { name: { type, required?, ... } } → JSON Schema。
 * ctx.tools.register 会把 parameters 原样当 JSON Schema 发给模型：
 * 不转换的话字段全被当成未知关键字忽略，名叫 title 的字段还会被当成 schema 的 title 关键字，整个请求被拒。
 */
function toJsonSchema(fields = {}) {
  if (fields.type === 'object') return fields
  const properties = {}
  const required = []
  for (const [key, { required: isRequired, ...schema }] of Object.entries(fields)) {
    properties[key] = schema
    if (isRequired) required.push(key)
  }
  return { type: 'object', properties, ...required.length ? { required } : {} }
}

/** Declare one tool with a permissive output schema. */
function tool(options) {
  return {
    name: options.name,
    description: options.description,
    parameters: toJsonSchema(options.parameters),
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    execute: options.execute,
    ...options.presentCall === undefined ? {} : { presentCall: options.presentCall },
  }
}

/**
 * Register 循迹: SQLite store, Agent tools, and the panel API.
 * @param ctx - Host plugin context.
 * @param config - bundle row configuration.
 */
export function apply(ctx, config = {}) {
  const configured = typeof config.database === 'string' && config.database.trim() !== ''
  const file = configured ? config.database : defaultDatabasePath()
  if (!configured) {
    try {
      if (migrateLegacyDatabase(legacyDatabasePath(), file)) console.info('[thesis-trail] copied the research-board store to', file)
    } catch (error) {
      console.warn('[thesis-trail] could not copy the research-board store:', error)
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  ensureColumn(db, 'seen', 'last_log_id', 'last_log_id INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'topic_log', 'anchor', 'anchor TEXT')
  ensureColumn(db, 'topic_log', 'ask_ai', 'ask_ai INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'topic_log', 'resolved_at', 'resolved_at TEXT')
  ensureColumn(db, 'board', 'schedule_id', 'schedule_id TEXT')
  ensureColumn(db, 'run', 'checked', 'checked TEXT')
  ensureColumn(db, 'topic', 'importance', "importance TEXT NOT NULL DEFAULT 'medium'")
  ensureColumn(db, 'topic', 'checked_at', 'checked_at TEXT')
  // The pass rule lives on the board; the plugin's own timer reads it.
  ensureColumn(db, 'board', 'rule_kind', 'rule_kind TEXT')
  ensureColumn(db, 'board', 'run_time', 'run_time TEXT')
  ensureColumn(db, 'board', 'weekdays', 'weekdays TEXT')
  ensureColumn(db, 'board', 'time_zone', 'time_zone TEXT')
  ensureColumn(db, 'board', 'active', 'active INTEGER NOT NULL DEFAULT 1')
  ensureColumn(db, 'board', 'last_slot_at', 'last_slot_at TEXT')
  // A pass row is one research request (one topic), or one turn of an older dsh session pass.
  ensureColumn(db, 'pass', 'topic_id', 'topic_id TEXT')
  ensureColumn(db, 'pass', 'mode', "mode TEXT NOT NULL DEFAULT 'session'")
  ensureColumn(db, 'pass', 'run_id', 'run_id INTEGER')
  ensureColumn(db, 'pass', 'summary', 'summary TEXT')
  ensureColumn(db, 'pass', 'trace', 'trace TEXT')
  ensureColumn(db, 'pass', 'answer', 'answer TEXT')
  ensureColumn(db, 'pass', 'error', 'error TEXT')
  // The AI's last word that the falsifier was met, until the reader dismisses it.
  ensureColumn(db, 'topic', 'falsified_at', 'falsified_at TEXT')
  ensureColumn(db, 'topic', 'falsified_note', 'falsified_note TEXT')
  // Gone in v8: the session-log scan marks and the prompt version of the dsh task.
  db.exec('DROP TABLE IF EXISTS usage_scan')
  if (db.prepare("SELECT 1 FROM pragma_table_info('board') WHERE name = 'prompt_version'").get()) {
    try { db.exec('ALTER TABLE board DROP COLUMN prompt_version') } catch { /* an SQLite without DROP COLUMN keeps it; nothing reads it */ }
  }
  // Up to v4 one task served the only board and its id lived in settings. It
  // moves onto that board, where adoptScheduleTasks() deletes the task.
  {
    const legacy = db.prepare("SELECT value FROM settings WHERE key = 'schedule_id'").get()?.value
    if (legacy !== undefined) {
      const only = db.prepare('SELECT id FROM board ORDER BY created_at, id LIMIT 1').get()?.id
      if (only) db.prepare('UPDATE board SET schedule_id = ? WHERE id = ? AND schedule_id IS NULL').run(legacy || null, only)
      db.prepare("DELETE FROM settings WHERE key IN ('schedule_id', 'schedule_prompt_version')").run()
    }
  }
  const close = () => { try { db.close() } catch { /* already closed */ } }
  ctx.effect(() => close)

  /** Run fn inside one transaction; a thrown error rolls everything back. */
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const readSetting = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value
  const writeSetting = (key, value) => db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value))

  const getTopic = (boardId, topicId) => db.prepare('SELECT * FROM topic WHERE id = ? AND board_id = ?').get(topicId, boardId)
  const getBoard = boardId => db.prepare('SELECT * FROM board WHERE id = ?').get(boardId)
  const boardList = () => db.prepare('SELECT * FROM board ORDER BY created_at, id').all()

  /**
   * The board a tool call is about. An explicit `board` wins; otherwise the run,
   * topic or reader item it names decides, so a pass that forgets the board still
   * writes to the right one. With several boards and nothing to go on, the call
   * must say which.
   */
  const resolveBoard = args => {
    const named = text(args.board)
    if (named !== '') return getBoard(named) ? { boardId: named } : { error: 'board_not_found', board: named }
    const fromRun = args.run_id === undefined || args.run_id === null ? undefined
      : db.prepare('SELECT board_id FROM run WHERE id = ?').get(Number(args.run_id))?.board_id
    const topicId = text(args.topic_id ?? args.topic) || text(Array.isArray(args.topic_ids) ? args.topic_ids[0] : '')
    const fromTopic = topicId === '' ? undefined : db.prepare('SELECT board_id FROM topic WHERE id = ?').get(topicId)?.board_id
    const fromLog = args.log_id === undefined || args.log_id === null ? undefined
      : db.prepare('SELECT board_id FROM topic_log WHERE id = ?').get(Number(args.log_id))?.board_id
    const derived = fromRun ?? fromTopic ?? fromLog
    if (derived) return { boardId: derived }
    const boards = boardList()
    if (boards.length === 1) return { boardId: boards[0].id }
    if (boards.length === 0) {
      return { error: 'no_boards', hint: 'The reader has not added a board yet. They add one, or import a board file, in the 循迹 panel.' }
    }
    return {
      error: 'board_required',
      boards: boards.map(board => ({ id: board.id, title: board.title })),
      hint: 'Several boards exist. Pass board with one of these ids.',
    }
  }

  const addLog = (boardId, topicId, entry) => Number(db.prepare(`
    INSERT INTO topic_log (board_id, topic_id, author, kind, run_id, created_at, changes, body, state, ref_id, anchor, ask_ai)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    boardId, topicId, entry.author, entry.kind, entry.run_id ?? null, nowIso(),
    entry.changes && Object.keys(entry.changes).length > 0 ? JSON.stringify(entry.changes) : null,
    entry.body ? String(entry.body) : null, entry.state ?? 'done', entry.ref_id ?? null,
    entry.anchor ? JSON.stringify(entry.anchor) : null, entry.ask_ai ? 1 : 0,
  ).lastInsertRowid)

  /** A passage reference { field, quote, start? }, or null when it does not name one. */
  const cleanAnchor = input => {
    if (!input || typeof input !== 'object') return null
    const field = text(input.field)
    const quote = String(input.quote ?? '').trim()
    if (!ANCHOR_FIELDS.includes(field) || quote === '') return null
    const start = Number.isInteger(input.start) && input.start >= 0 ? input.start : undefined
    return { field, quote: quote.slice(0, 600), ...start === undefined ? {} : { start } }
  }

  /** A topic the reader just touched is checked on the next pass. */
  const markDue = topicId => db.prepare("UPDATE topic SET next_due_at = NULL WHERE id = ? AND status = 'active'").run(topicId)

  /**
   * Validate submitted field values. Required fields cannot be emptied; an empty
   * optional field is stored as NULL.
   */
  const cleanPatch = (input, statuses) => {
    const patch = {}
    for (const field of TOPIC_FIELDS) {
      if (input?.[field] === undefined || input?.[field] === null) continue
      const value = text(input[field])
      if (REQUIRED_FIELDS.has(field) && value === '') return { error: `${field}_cannot_be_empty` }
      if (field === 'status' && !statuses.includes(value)) return { error: 'invalid_status', allowed: statuses }
      patch[field] = value
    }
    return { patch }
  }

  /** The part of a patch that actually differs from the stored topic. */
  const diffOf = (topic, patch) => {
    const changes = {}
    for (const [field, value] of Object.entries(patch)) {
      if (!same(topic[field], value)) changes[field] = { from: topic[field] ?? null, to: value === '' ? null : value }
    }
    return changes
  }

  const writeTopic = (topicId, values) => {
    const columns = Object.keys(values)
    if (columns.length === 0) return
    db.prepare(`UPDATE topic SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...columns.map(column => values[column] === '' ? null : values[column]), nowIso(), topicId)
  }

  /** A newer proposal or a reader edit makes an older pending proposal moot. */
  const supersede = (topicId, fields, exceptId) => {
    const covered = new Set(fields)
    const pending = db.prepare("SELECT id, changes FROM topic_log WHERE topic_id = ? AND kind = 'proposal' AND state = 'pending'").all(topicId)
    for (const row of pending) {
      if (Number(row.id) === exceptId) continue
      const proposed = Object.keys(parseChanges(row.changes) ?? {})
      if (proposed.length > 0 && proposed.every(field => covered.has(field))) {
        db.prepare("UPDATE topic_log SET state = 'superseded' WHERE id = ?").run(row.id)
      }
    }
  }

  // -------------------------------------------------------------- passes

  /** Start one run, refusing to leave two open at once. */
  const startRun = (boardId, mode) => {
    const open = db.prepare("SELECT id FROM run WHERE board_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(boardId)
    if (open) return { error: 'run_still_open', run_id: Number(open.id) }
    const info = db.prepare(
      'INSERT INTO run (board_id, mode, started_at, status) VALUES (?, ?, ?, ?)',
    ).run(boardId, mode, nowIso(), 'open')
    return { run_id: Number(info.lastInsertRowid) }
  }

  /**
   * Close the open run and advance each touched topic's next due time. Reader
   * items the Agent was shown in a brief count as seen once a pass closes,
   * whether or not it replied to each one.
   */
  const closeRun = (boardId, runId, status, summary, checked) => {
    const run = db.prepare('SELECT * FROM run WHERE id = ? AND board_id = ?').get(runId, boardId)
    if (!run) return { error: 'run_not_found' }
    if (run.status !== 'open') return { error: 'run_already_closed', status: run.status }
    const cursor = Number(readSetting(`brief_cursor:${boardId}`) ?? 0)
    return transaction(() => {
      db.prepare('UPDATE run SET status = ?, summary = ?, finished_at = ? WHERE id = ?')
        .run(status, summary ?? null, nowIso(), runId)
      const touched = db.prepare(`
        SELECT DISTINCT et.topic_id FROM evidence_topic et
        JOIN evidence e ON e.id = et.evidence_id WHERE e.run_id = ?
      `).all(runId)
      const hit = db.prepare('SELECT DISTINCT topic_id FROM assessment WHERE run_id = ?').all(runId)
      const touchedIds = new Set([...touched, ...hit].map(row => row.topic_id))
      for (const topicId of Array.isArray(checked) ? checked : []) touchedIds.add(String(topicId))
      db.prepare('UPDATE run SET checked = ? WHERE id = ?').run(JSON.stringify([...touchedIds]), runId)
      // A reader item that arrived during this pass keeps its topic due.
      const fresh = new Set(db.prepare(
        "SELECT DISTINCT topic_id FROM topic_log WHERE board_id = ? AND author = 'human' AND state = 'open' AND id > ?",
      ).all(boardId, cursor).map(row => row.topic_id))
      // A checked topic comes back after its importance interval, counted from the
      // start of this pass. A topic this pass skipped keeps its due time, so a due
      // one stays due. An earlier due time stays only when it was chosen (a date the
      // AI set, such as an earnings day); the one the last check left is replaced,
      // or research done by hand before it would leave the topic due right after.
      const now = nowIso()
      const setDue = db.prepare('UPDATE topic SET next_due_at = ?, checked_at = ? WHERE id = ?')
      for (const topic of db.prepare('SELECT id, importance, next_due_at, checked_at FROM topic WHERE board_id = ? AND status = ?').all(boardId, 'active')) {
        if (!touchedIds.has(topic.id)) continue
        let due = recheckAt(topic.importance, run.started_at)
        const fromLastCheck = Boolean(topic.checked_at) && topic.next_due_at === recheckAt(topic.importance, topic.checked_at)
        if (topic.next_due_at && topic.next_due_at > now && topic.next_due_at < due && !fromLastCheck) due = topic.next_due_at
        if (fresh.has(topic.id)) due = null
        setDue.run(due, run.started_at, topic.id)
      }
      const unanswered = db.prepare(
        "SELECT id FROM topic_log WHERE board_id = ? AND author = 'human' AND state = 'open' AND id <= ?",
      ).all(boardId, cursor).map(row => Number(row.id))
      db.prepare("UPDATE topic_log SET state = 'seen' WHERE board_id = ? AND author = 'human' AND state = 'open' AND id <= ?")
        .run(boardId, cursor)
      const arrived = Number(db.prepare(
        "SELECT COUNT(*) AS n FROM topic_log WHERE board_id = ? AND author = 'human' AND state = 'open' AND id > ?",
      ).get(boardId, cursor)?.n ?? 0)
      return {
        run_id: runId,
        status,
        touched: [...touchedIds],
        ...unanswered.length ? { closed_without_reply: unanswered } : {},
        ...arrived > 0 ? {
          new_inbox: arrived,
          next: 'The reader left more items while this pass ran. Call trail_brief again and reply to each new inbox item; replies need no open run.',
        } : {},
      }
    })
  }

  /** Insert one evidence row and its topic links, deduplicating by content hash. */
  const addEvidence = (boardId, runId, input) => {
    const title = text(input.title)
    const url = text(input.url)
    const summary = text(input.summary)
    if (title === '' || url === '') return { error: 'evidence_needs_title_and_url' }
    if (!/^https?:\/\//i.test(url)) return { error: 'evidence_url_must_be_http' }
    const hash = evidenceHash(url, title)
    const existing = db.prepare('SELECT id FROM evidence WHERE content_hash = ?').get(hash)
    if (existing) return { evidence_id: Number(existing.id), deduplicated: true }
    const info = db.prepare(`
      INSERT INTO evidence (board_id, run_id, kind, title, url, source, published_at, captured_at, content_hash, summary, direction)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      boardId, runId ?? null, String(input.kind ?? 'news'), title, url,
      input.source ? String(input.source) : null,
      input.published_at ? String(input.published_at) : null,
      nowIso(), hash, summary, Number(input.direction ?? 0),
    )
    const id = Number(info.lastInsertRowid)
    const link = db.prepare('INSERT OR IGNORE INTO evidence_topic (evidence_id, topic_id) VALUES (?, ?)')
    for (const topicId of Array.isArray(input.topic_ids) ? input.topic_ids : []) link.run(id, String(topicId))
    return { evidence_id: id, deduplicated: false }
  }

  /** Append one assessment, marking a material reversal. */
  const addAssessment = (topicId, runId, input) => {
    const topic = db.prepare('SELECT * FROM topic WHERE id = ?').get(topicId)
    if (!topic) return { error: 'topic_not_found', topic_id: topicId }
    const stance = clampStance(input.stance)
    if (stance === undefined) return { error: 'stance_must_be_between_minus_one_and_one' }
    const rationale = text(input.rationale)
    if (rationale === '') return { error: 'assessment_needs_rationale' }
    const previous = db.prepare('SELECT stance FROM assessment WHERE topic_id = ? ORDER BY id DESC LIMIT 1').get(topicId)
    const before = previous ? Number(previous.stance) : null
    const flipped = before !== null && ((before > 0 && stance <= 0) || (before < 0 && stance >= 0) || Math.abs(stance - before) >= 0.5)
    const info = db.prepare(`
      INSERT INTO assessment (topic_id, run_id, created_at, stance, confidence, rationale, flipped)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(topicId, runId ?? null, nowIso(), stance, numberIn(input.confidence ?? 0.5, 0, 1) ?? 0.5, rationale, flipped ? 1 : 0)
    db.prepare('UPDATE topic SET updated_at = ? WHERE id = ?').run(nowIso(), topicId)
    return { assessment_id: Number(info.lastInsertRowid), flipped, previous_stance: before, stance }
  }

  // -------------------------------------------------------------- topics

  /** Add one topic from either side; a falsifier is mandatory. */
  const addTopic = (boardId, input, author, options = {}) => {
    const { patch, error, allowed } = cleanPatch({ ...input, status: undefined }, HUMAN_STATUSES)
    if (error) return { error, allowed }
    if (!patch.title || !patch.thesis) return { error: 'topic_needs_title_and_thesis' }
    if (!patch.falsifier) return { error: 'topic_needs_falsifier', hint: 'Describe the observable outcome that proves this thesis wrong.' }
    // Importance decides how much a pass spends on the topic, so only the reader sets it.
    const importance = author === 'human' && input.importance !== undefined ? text(input.importance) : DEFAULT_IMPORTANCE
    if (!IMPORTANCE.includes(importance)) return { error: 'invalid_importance', allowed: IMPORTANCE }
    return transaction(() => {
      const nextSeq = Number(db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM topic WHERE board_id = ?').get(boardId)?.n ?? 0) + 1
      // Topic ids are global; the first board keeps the short t1, t2… form.
      const first = boardList()[0]?.id === boardId
      let id = text(input.id) || (first ? `t${nextSeq}` : `${boardId}-t${nextSeq}`)
      if (db.prepare('SELECT 1 FROM topic WHERE id = ?').get(id)) id = `t${nextSeq}-${Date.now().toString(36)}`
      const at = nowIso()
      db.prepare(`
        INSERT INTO topic (id, board_id, seq, title, thesis, falsifier, bull_case, bear_case, metric, status, importance, next_due_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(
        id, boardId, nextSeq, patch.title, patch.thesis, patch.falsifier,
        patch.bull_case || null, patch.bear_case || null, patch.metric || null, importance,
        author === 'agent' && input.next_due_at ? String(input.next_due_at) : null, at, at,
      )
      const changes = {}
      for (const [field, value] of Object.entries(patch)) if (value !== '') changes[field] = { from: null, to: value }
      if (importance !== DEFAULT_IMPORTANCE) changes.importance = { from: null, to: importance }
      const logId = addLog(boardId, id, {
        author,
        kind: 'create',
        run_id: input.run_id,
        changes,
        body: author === 'agent' ? text(input.reason) : text(input.note),
        // An imported topic asks nothing of the AI; being due is enough.
        state: author === 'human' && !options.imported ? 'open' : 'done',
      })
      return { topic_id: id, log_id: logId }
    })
  }

  /**
   * The reader edits a topic. `base` holds the values the form started from: a
   * field that changed underneath (a pass landed meanwhile) is a conflict, not
   * a silent overwrite.
   */
  const humanEdit = (boardId, topicId, input) => {
    const topic = getTopic(boardId, topicId)
    if (!topic) return { error: 'topic_not_found', status: 404 }
    const { patch, error, allowed } = cleanPatch(input.changes ?? {}, HUMAN_STATUSES)
    if (error) return { error, allowed, status: 400 }
    const wanted = input.changes?.importance
    if (wanted !== undefined && wanted !== null) {
      if (!IMPORTANCE.includes(text(wanted))) return { error: 'invalid_importance', allowed: IMPORTANCE, status: 400 }
      patch.importance = text(wanted)
    }
    const base = input.base && typeof input.base === 'object' ? input.base : {}
    const stale = Object.keys(patch).filter(field => base[field] !== undefined && !same(topic[field], base[field]))
    if (stale.length > 0) {
      return {
        error: 'changed_since_opened',
        status: 409,
        fields: stale,
        current: Object.fromEntries(stale.map(field => [field, topic[field] ?? null])),
      }
    }
    const changes = diffOf(topic, patch)
    const note = text(input.note)
    if (Object.keys(changes).length === 0 && note === '') return { error: 'nothing_to_update', status: 400 }
    // Importance only changes how often the topic is checked. It needs no answer
    // from the AI and does not make the topic due; it moves the next check.
    const onlyImportance = note === '' && Object.keys(changes).every(field => field === 'importance')
    return transaction(() => {
      writeTopic(topicId, Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to ?? ''])))
      supersede(topicId, Object.keys(changes))
      const logId = addLog(boardId, topicId, {
        author: 'human',
        kind: Object.keys(changes).length > 0 ? 'edit' : 'note',
        changes,
        body: note,
        state: onlyImportance ? 'seen' : 'open',
      })
      // The alert was about this falsifier on an active topic; either change ends it.
      if (changes.falsifier || (changes.status && changes.status.to !== 'active')) {
        db.prepare('UPDATE topic SET falsified_at = NULL, falsified_note = NULL WHERE id = ?').run(topicId)
      }
      if (changes.importance && topic.checked_at && topic.next_due_at !== null) {
        db.prepare('UPDATE topic SET next_due_at = ? WHERE id = ?').run(recheckAt(changes.importance.to, topic.checked_at), topicId)
      }
      if (!onlyImportance) markDue(topicId)
      return { topic_id: topicId, log_id: logId, changed: Object.keys(changes) }
    })
  }

  /**
   * A comment from the reader. It starts a thread (optionally pointing at a
   * passage) or, with reply_to, continues one; replying reopens a resolved thread.
   */
  const humanNote = (boardId, topicId, input = {}) => {
    if (!getTopic(boardId, topicId)) return { error: 'topic_not_found', status: 404 }
    const note = text(input.body)
    if (note === '') return { error: 'note_is_empty', status: 400 }
    let replyTo = null
    let root = null
    if (input.reply_to !== undefined && input.reply_to !== null) {
      const target = db.prepare('SELECT id FROM topic_log WHERE id = ? AND topic_id = ?').get(Number(input.reply_to), topicId)
      if (!target) return { error: 'thread_not_found', status: 404 }
      replyTo = Number(target.id)
      root = threadRoot(db, replyTo)
    }
    const anchor = replyTo === null ? cleanAnchor(input.anchor) : null
    return transaction(() => {
      const logId = addLog(boardId, topicId, {
        author: 'human',
        kind: replyTo === null ? 'note' : 'reply',
        body: note,
        state: 'open',
        ref_id: replyTo,
        anchor,
        ask_ai: input.ask_ai === true,
      })
      if (root?.resolved_at) db.prepare('UPDATE topic_log SET resolved_at = NULL WHERE id = ?').run(root.id)
      markDue(topicId)
      return { topic_id: topicId, log_id: logId, thread_id: root ? Number(root.id) : logId }
    })
  }

  /**
   * The reader closes or reopens a thread. Closing withdraws reader messages in
   * it that no pass has looked at: the reader no longer needs an answer.
   */
  const resolveThread = (boardId, logId, resolved) => {
    const row = db.prepare('SELECT id FROM topic_log WHERE id = ? AND board_id = ?').get(logId, boardId)
    if (!row) return { error: 'thread_not_found', status: 404 }
    const root = threadRoot(db, logId)
    return transaction(() => {
      db.prepare('UPDATE topic_log SET resolved_at = ? WHERE id = ?').run(resolved ? nowIso() : null, root.id)
      let withdrawn = 0
      if (resolved) {
        const withdraw = db.prepare("UPDATE topic_log SET state = 'withdrawn' WHERE id = ?")
        for (const member of threadRows(db, Number(root.id))) {
          if (member.author === 'human' && member.state === 'open') { withdraw.run(member.id); withdrawn += 1 }
        }
      }
      return { thread_id: Number(root.id), resolved, withdrawn }
    })
  }

  /**
   * The reader restores a topic to how it read right after one logged change
   * (log_id 0: before any logged change). Every newer change is rolled back from
   * its recorded `from`, and the result is one new reader edit, so a restore can
   * itself be undone the same way.
   */
  const restoreVersion = (boardId, topicId, logId, body) => {
    const topic = getTopic(boardId, topicId)
    if (!topic) return { error: 'topic_not_found', status: 404 }
    const applied = `kind IN (${APPLIED_KINDS.map(() => '?').join(', ')}) AND changes IS NOT NULL`
    if (logId !== 0 && !db.prepare(`SELECT id FROM topic_log WHERE id = ? AND topic_id = ? AND ${applied}`).get(logId, topicId, ...APPLIED_KINDS)) {
      return { error: 'version_not_found', status: 404 }
    }
    const newer = db.prepare(`SELECT * FROM topic_log WHERE topic_id = ? AND id > ? AND ${applied} ORDER BY id DESC`)
      .all(topicId, logId, ...APPLIED_KINDS)
    const values = Object.fromEntries(TOPIC_FIELDS.map(field => [field, topic[field] ?? null]))
    for (const row of newer) {
      for (const [field, change] of Object.entries(parseChanges(row.changes) ?? {})) {
        if (field in values) values[field] = change?.from ?? null
      }
    }
    for (const field of REQUIRED_FIELDS) {
      if (text(values[field]) === '') return { error: `${field}_cannot_be_empty`, status: 409 }
    }
    if (!AGENT_STATUSES.includes(text(values.status))) values.status = topic.status
    const changes = diffOf(topic, Object.fromEntries(Object.entries(values).map(([field, value]) => [field, text(value)])))
    if (Object.keys(changes).length === 0) return { error: 'already_current', status: 409 }
    return transaction(() => {
      writeTopic(topicId, Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to ?? ''])))
      supersede(topicId, Object.keys(changes))
      // Everything after the restored version is undone, Agent edits included.
      const reverted = db.prepare("UPDATE topic_log SET state = 'reverted' WHERE id = ? AND author = 'agent' AND kind = 'edit' AND state = 'applied'")
      for (const row of newer) reverted.run(row.id)
      const id = addLog(boardId, topicId, { author: 'human', kind: 'edit', changes, body: text(body), state: 'open' })
      markDue(topicId)
      return { topic_id: topicId, log_id: id, changed: Object.keys(changes) }
    })
  }

  /** The reader accepts or rejects one pending proposal. */
  const decide = (boardId, logId, accept, body) => {
    const proposal = db.prepare("SELECT * FROM topic_log WHERE id = ? AND board_id = ? AND kind = 'proposal'").get(logId, boardId)
    if (!proposal) return { error: 'proposal_not_found', status: 404 }
    if (proposal.state !== 'pending') return { error: 'proposal_already_decided', state: proposal.state, status: 409 }
    const topic = getTopic(boardId, proposal.topic_id)
    if (!topic) return { error: 'topic_not_found', status: 404 }
    const note = text(body)
    return transaction(() => {
      let applied = {}
      if (accept) {
        const proposed = parseChanges(proposal.changes) ?? {}
        applied = diffOf(topic, Object.fromEntries(Object.entries(proposed).map(([field, change]) => [field, text(change?.to)])))
        writeTopic(topic.id, Object.fromEntries(Object.entries(applied).map(([field, change]) => [field, change.to ?? ''])))
        markDue(topic.id)
      }
      db.prepare('UPDATE topic_log SET state = ? WHERE id = ?').run(accept ? 'accepted' : 'rejected', logId)
      const decision = addLog(boardId, topic.id, {
        author: 'human',
        kind: accept ? 'accept' : 'reject',
        changes: applied,
        body: note,
        state: 'open',
        ref_id: logId,
      })
      return { topic_id: topic.id, log_id: decision, changed: Object.keys(applied) }
    })
  }

  /**
   * The reader undoes one Agent edit. Fields that changed again since then are
   * left alone: undoing must not erase a newer change.
   */
  const revert = (boardId, logId, body) => {
    const edit = db.prepare("SELECT * FROM topic_log WHERE id = ? AND board_id = ? AND author = 'agent' AND kind = 'edit'").get(logId, boardId)
    if (!edit) return { error: 'agent_edit_not_found', status: 404 }
    if (edit.state !== 'applied') return { error: 'already_reverted', status: 409 }
    const topic = getTopic(boardId, edit.topic_id)
    if (!topic) return { error: 'topic_not_found', status: 404 }
    const restore = {}
    const skipped = []
    for (const [field, change] of Object.entries(parseChanges(edit.changes) ?? {})) {
      if (!TOPIC_FIELDS.includes(field)) continue
      if (same(topic[field], change?.to)) restore[field] = text(change?.from)
      else skipped.push(field)
    }
    if (Object.keys(restore).length === 0) return { error: 'changed_since', fields: skipped, status: 409 }
    const emptied = Object.keys(restore).find(field => REQUIRED_FIELDS.has(field) && restore[field] === '')
    if (emptied) return { error: `${emptied}_cannot_be_empty`, status: 409 }
    return transaction(() => {
      const changes = diffOf(topic, restore)
      writeTopic(topic.id, restore)
      db.prepare("UPDATE topic_log SET state = 'reverted' WHERE id = ?").run(logId)
      const undo = addLog(boardId, topic.id, { author: 'human', kind: 'edit', changes, body: text(body), state: 'open', ref_id: logId })
      markDue(topic.id)
      return { topic_id: topic.id, log_id: undo, changed: Object.keys(changes), skipped }
    })
  }

  /**
   * The Agent edits a topic. Fields whose last applied change came from the
   * reader become one proposal; the rest apply now. Scheduling and merge
   * bookkeeping are not authored content and always apply.
   */
  const agentEdit = (boardId, topicId, input, runId) => {
    const topic = getTopic(boardId, topicId)
    if (!topic) return { error: 'topic_not_found' }
    const reason = text(input.reason)
    if (reason === '') return { error: 'topic_update_needs_reason', hint: 'Say why the definition should change; the reader sees it next to the change.' }
    const { patch, error, allowed } = cleanPatch({ ...input, status: input.topic_status }, AGENT_STATUSES)
    if (error) return { error, allowed }
    const changes = diffOf(topic, patch)
    const meta = {}
    if (input.next_due_at !== undefined) meta.next_due_at = text(input.next_due_at)
    if (input.merged_into !== undefined) meta.merged_into = text(input.merged_into)
    if (Object.keys(changes).length === 0 && Object.keys(meta).length === 0) return { error: 'nothing_to_update' }
    const owners = fieldOwners(db, topicId)
    const applied = {}
    const proposed = {}
    for (const [field, change] of Object.entries(changes)) {
      if (owners[field]?.author === 'human') proposed[field] = change
      else applied[field] = change
    }
    // A merge target only means something together with the merged status.
    if (meta.merged_into !== undefined && proposed.status) {
      proposed.merged_into = { from: topic.merged_into ?? null, to: meta.merged_into || null }
      delete meta.merged_into
    }
    return transaction(() => {
      writeTopic(topicId, {
        ...Object.fromEntries(Object.entries(applied).map(([field, change]) => [field, change.to ?? ''])),
        ...meta,
      })
      let editId = null
      let proposalId = null
      if (Object.keys(applied).length > 0) {
        if (meta.merged_into && applied.status) applied.merged_into = { from: topic.merged_into ?? null, to: meta.merged_into || null }
        editId = addLog(boardId, topicId, { author: 'agent', kind: 'edit', run_id: runId, changes: applied, body: reason, state: 'applied' })
      }
      // An undecided suggestion from the AI is an offer, not history. The same offer
      // again adds nothing; a new one on the same fields replaces the old one, so
      // daily research cannot pile suggestions up while the reader is away.
      let repeated = false
      if (Object.keys(proposed).length > 0) {
        const waiting = db.prepare(`
          SELECT id, changes, EXISTS (SELECT 1 FROM topic_log r WHERE r.ref_id = p.id) AS answered
          FROM topic_log p WHERE topic_id = ? AND kind = 'proposal' AND state = 'pending' AND author = 'agent'
        `).all(topicId).map(row => ({ id: Number(row.id), answered: Number(row.answered) === 1, changes: parseChanges(row.changes) ?? {} }))
        const fields = Object.keys(proposed)
        const twin = waiting.find(row => {
          const keys = Object.keys(row.changes)
          return keys.length === fields.length && fields.every(field => keys.includes(field) && same(row.changes[field]?.to, proposed[field].to))
        })
        if (twin) {
          proposalId = twin.id
          repeated = true
        } else {
          proposalId = addLog(boardId, topicId, { author: 'agent', kind: 'proposal', run_id: runId, changes: proposed, body: reason, state: 'pending' })
          for (const row of waiting) {
            if (!Object.keys(row.changes).every(field => fields.includes(field))) continue
            // Nobody answered it: it goes. A suggestion the reader replied to stays in the history.
            if (row.answered) db.prepare("UPDATE topic_log SET state = 'superseded' WHERE id = ?").run(row.id)
            else db.prepare('DELETE FROM topic_log WHERE id = ?').run(row.id)
          }
        }
      }
      return {
        topic_id: topicId,
        applied: Object.keys(applied),
        proposed: repeated ? [] : Object.keys(proposed),
        ...repeated ? { already_pending: Object.keys(proposed) } : {},
        ...editId === null ? {} : { log_id: editId },
        ...proposalId === null ? {} : {
          proposal_id: proposalId,
          note: repeated
            ? 'The same suggestion is already waiting for the reader; nothing new was added.'
            : 'The reader edited these fields last, so the change waits for their decision. Do not propose it again unless new evidence changes the case.',
        },
      }
    })
  }

  /** The Agent answers one reader item. */
  const agentReply = (boardId, logId, body, runId) => {
    const item = db.prepare("SELECT * FROM topic_log WHERE id = ? AND board_id = ? AND author = 'human'").get(logId, boardId)
    if (!item) return { error: 'reader_item_not_found', hint: 'log_id must come from the inbox in trail_brief.' }
    const reply = text(body)
    if (reply === '') return { error: 'reply_is_empty' }
    return transaction(() => {
      const id = addLog(boardId, item.topic_id, { author: 'agent', kind: 'reply', run_id: runId, body: reply, ref_id: logId })
      db.prepare("UPDATE topic_log SET state = 'answered' WHERE id = ?").run(logId)
      return { log_id: id, topic_id: item.topic_id }
    })
  }

  /** The Agent opens a thread for the reader, e.g. a question about a passage. */
  const agentNote = (boardId, topicId, input, runId) => {
    if (!getTopic(boardId, topicId)) return { error: 'topic_not_found' }
    const note = text(input.body)
    if (note === '') return { error: 'note_is_empty' }
    const anchor = cleanAnchor({ field: input.field, quote: input.quote })
    return {
      log_id: addLog(boardId, topicId, { author: 'agent', kind: 'note', run_id: runId, body: note, anchor }),
      topic_id: topicId,
      ...anchor ? { anchored: anchor.field } : {},
    }
  }

  // -------------------------------------------------------------- tools

  const boardMiss = ({ error, ...rest }) => ({ ok: false, code: error, ...rest })

  ctx.effect(() => ctx.tools.register(tool({
    name: 'trail_brief',
    description: 'Read the thesis trail (循迹) before a tracking pass: each topic\'s falsifiable thesis, current stance and history, last evidence, whether it is due, and the inbox — direct edits, comments and proposal decisions the reader left that no pass has looked at yet. Only topics that are due or have inbox items come with full detail; the rest list id, title and thesis so you can link a new fact to them (trail_timeline reads one in full). A comment may carry an anchor (field + the quoted passage) and, for a follow-up in a thread, the earlier messages. The reader\'s edits are authoritative. Per topic, importance (high, medium or low, set by the reader) says how deeply to check it, and human_fields lists fields the reader wrote last (you can only propose changes to them) and rejected_proposals lists recent proposals the reader turned down. Each board tracks one company or asset; pass board. Start every pass here.',
    parameters: {
      board: { type: 'string', description: 'Board id. Required when more than one board exists.' },
      compact: { type: 'boolean', description: 'Omit per-topic history, recent evidence and collaboration detail; use when only titles and stances are needed.' },
      pass: { type: 'boolean', description: 'True when this call starts a scheduled tracking pass: the result then begins with instructions, the steps of the pass.' },
    },
    execute(args) {
      const resolved = resolveBoard({ board: args.board })
      if (resolved.error) return boardMiss(resolved)
      const { boardId } = resolved
      const compact = args.compact === true
      const state = stateOf(db, boardId, { detail: !compact })
      if (!state) return { ok: false, code: 'board_not_found', board: boardId }
      const inbox = inboxOf(db, boardId)
      if (inbox.length > 0) {
        const cursor = Number(readSetting(`brief_cursor:${boardId}`) ?? 0)
        writeSetting(`brief_cursor:${boardId}`, Math.max(cursor, ...inbox.map(item => item.log_id)))
      }
      // The pass prompt is fixed text, so the date has to come from here: without it
      // a model takes the newest report it finds as current even when it is a year old.
      const guide = args.pass === true ? { instructions: passGuide(getBoard(boardId)) } : {}
      const result = jsonResult({ ...guide, today: localDate(new Date(), timeZone), ...state, inbox })
      const asked = new Set(inbox.map(item => item.topic_id))
      result.topics = result.topics.map(topic => {
        if (compact) {
          return {
            id: topic.id, title: topic.title, status: topic.status, importance: topic.importance, stance: topic.stance, due: topic.due,
            next_due_at: topic.next_due_at, unread: topic.unread, pending_proposals: topic.pending_proposals,
          }
        }
        // A topic this pass will not work on only needs enough to link evidence to it.
        if (!topic.due && !asked.has(topic.id)) {
          return { id: topic.id, title: topic.title, thesis: topic.thesis, status: topic.status, importance: topic.importance, stance: topic.stance, due: false, next_due_at: topic.next_due_at }
        }
        return { ...topic, ...topicCollaboration(db, topic.id) }
      })
      return result
    },
    presentCall: () => ({ card: 'generic', title: 'Read thesis trail', kind: 'read' }),
  })))

  ctx.effect(() => ctx.tools.register(tool({
    name: 'trail_timeline',
    description: 'Read one topic\'s full record, newest first: evidence, stance snapshots, and the change log shared with the reader (who changed which field and why, notes, proposals, replies).',
    parameters: {
      board: { type: 'string', description: 'Board id. Can be omitted; the topic decides.' },
      topic: { type: 'string', required: true, description: 'Topic id from trail_brief.' },
      limit: { type: 'integer', description: 'Rows per section, 1-100; defaults to 40.' },
    },
    execute(args) {
      const resolved = resolveBoard({ board: args.board, topic: args.topic })
      if (resolved.error) return boardMiss(resolved)
      const { boardId } = resolved
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 40)))
      const timeline = timelineOf(db, boardId, text(args.topic), limit)
      if (!timeline) return { ok: false, code: 'topic_not_found', topic: args.topic }
      return jsonResult(timeline)
    },
    presentCall: () => ({ card: 'generic', title: 'Read topic timeline', kind: 'read' }),
  })))

  ctx.effect(() => ctx.tools.register(tool({
    name: 'trail_record',
    description: 'Write to the thesis trail (循迹). A tracking pass is a transaction: run_start, then evidence for what you found and assess for judgement changes, then run_close with what the pass covered; an unclosed run means the pass was interrupted. Answer every reader comment in the trail_brief inbox with reply (log_id + body); a comment with an anchor is about that quoted passage, and when it asks for a rewrite, make it with topic_update and say what you changed in the reply. Change a topic\'s definition with topic_update and a reason; fields the reader wrote last turn into a tracked-change proposal the reader accepts or rejects, so never repeat a rejected proposal without new evidence. Use note to ask the reader something, optionally pointing at a passage with field + quote. Each action takes only its own fields.',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['run_start', 'evidence', 'assess', 'run_close', 'reply', 'note', 'topic_add', 'topic_update'],
        description: 'run_start begins a pass and returns run_id; evidence records one external fact; assess appends a stance snapshot; run_close ends the pass; reply answers one inbox item; note leaves the reader a message on a topic; topic_add and topic_update change the agenda.',
      },
      board: { type: 'string', description: 'Board id. Always pass it on run_start; other actions fall back to the board of their run, topic or log_id.' },
      run_id: { type: 'integer', description: 'run_start: unused. evidence/assess/reply/note/topic_update: the open run, if any. run_close: the run to close.' },
      mode: { type: 'string', enum: ['daily', 'weekly', 'manual', 'event'], description: 'run_start: what cadence this pass is.' },
      status: { type: 'string', enum: ['ok', 'partial', 'failed'], description: 'run_close: outcome. Use partial when some due topics were not checked.' },
      summary: { type: 'string', description: 'run_close: one or two sentences on what this pass covered and found, including what did not change.' },
      topic_id: { type: 'string', description: 'evidence/assess/note/topic_update: the topic.' },
      topic_ids: { type: 'array', items: { type: 'string' }, description: 'evidence: every topic this fact bears on. One fact can hit several.' },
      log_id: { type: 'integer', description: 'reply: the inbox item you are answering.' },
      body: { type: 'string', description: 'reply/note: what you tell the reader, in their language. Be concrete: what you checked, what you changed, what you need from them.' },
      field: { type: 'string', enum: ANCHOR_FIELDS, description: 'note: optional, the field your note is about; with quote, the panel highlights that passage.' },
      quote: { type: 'string', description: 'note: optional, the exact text in that field your note refers to, copied verbatim.' },
      reason: { type: 'string', description: 'topic_update: required. Why the definition should change, citing evidence where there is any. topic_add: why this topic belongs on the agenda.' },
      kind: { type: 'string', enum: ['news', 'filing', 'transcript', 'paper', 'data', 'note'], description: 'evidence: source type.' },
      title: { type: 'string', description: 'evidence: headline. topic_add/topic_update: topic title.' },
      url: { type: 'string', description: 'evidence: the http(s) source. Required; an unsourced fact cannot be checked later.' },
      source: { type: 'string', description: 'evidence: publisher or domain.' },
      published_at: { type: 'string', description: 'evidence: ISO time of the original publication.' },
      delta_summary: { type: 'string', description: 'evidence: one sentence on what this fact says, in your own words.' },
      direction: { type: 'integer', enum: [-1, 0, 1], description: 'evidence: -1 against the thesis, 0 neutral or unclear, 1 supports it.' },
      stance: { type: 'number', description: 'assess: -1 confirms the bear case, 0 genuinely mixed, 1 confirms the bull case. Keep it comparable to earlier values.' },
      confidence: { type: 'number', description: 'assess: 0-1, how much this pass moved your confidence.' },
      rationale: { type: 'string', description: 'assess: why the stance is what it is now, and what changed since the previous value.' },
      thesis: { type: 'string', description: 'topic_add/topic_update: the falsifiable claim in one sentence.' },
      falsifier: { type: 'string', description: 'topic_add: required. The observable outcome that proves the thesis wrong. topic_update: replaces it.' },
      bull_case: { type: 'string', description: 'topic_add/topic_update: the bull expectation.' },
      bear_case: { type: 'string', description: 'topic_add/topic_update: the bear worry.' },
      metric: { type: 'string', description: 'topic_add/topic_update: the indicator to check each time.' },
      topic_status: { type: 'string', enum: AGENT_STATUSES, description: 'topic_update: active, paused, closed, or merged (with merged_into).' },
      next_due_at: { type: 'string', description: 'topic_add/topic_update: ISO time this topic should be checked again.' },
      merged_into: { type: 'string', description: 'topic_update: with topic_status merged, the surviving topic id.' },
      checked_topic_ids: { type: 'array', items: { type: 'string' }, description: 'run_close: every topic this pass actually examined. A checked topic is due again after its importance interval (high: next pass, medium: a week, low: a month); a due topic left out stays due.' },
    },
    execute(args) {
      const resolved = resolveBoard(args)
      if (resolved.error) return boardMiss(resolved)
      const { boardId } = resolved
      const runId = args.run_id === undefined || args.run_id === null ? undefined : Number(args.run_id)
      const action = String(args.action ?? '')
      const answer = result => result.error
        ? { ok: false, code: result.error, ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'error')) }
        : { ok: true, action, ...result }
      switch (action) {
        case 'run_start': {
          const mode = ['daily', 'weekly', 'manual', 'event'].includes(args.mode) ? args.mode : 'manual'
          return answer(startRun(boardId, mode))
        }
        case 'evidence': {
          const result = answer(addEvidence(boardId, runId, { ...args, summary: args.delta_summary ?? args.summary }))
          const age = daysSince(args.published_at)
          if (result.ok && age !== null && age > STALE_EVIDENCE_DAYS) {
            result.warning = `This source was published ${age} days ago. Check that no newer filing or report exists before treating it as the latest data.`
          }
          return result
        }
        case 'assess':
          return answer(addAssessment(text(args.topic_id), runId, args))
        case 'run_close': {
          if (runId === undefined) return { ok: false, code: 'run_id_required' }
          const status = ['ok', 'partial', 'failed'].includes(args.status) ? args.status : 'partial'
          return answer(closeRun(boardId, runId, status, args.summary, args.checked_topic_ids))
        }
        case 'reply':
          return answer(agentReply(boardId, Number(args.log_id), args.body, runId))
        case 'note':
          return answer(agentNote(boardId, text(args.topic_id), args, runId))
        case 'topic_add':
          return answer(addTopic(boardId, { ...args, run_id: runId }, 'agent'))
        case 'topic_update':
          return answer(agentEdit(boardId, text(args.topic_id), args, runId))
        default:
          return { ok: false, code: 'unknown_action', action }
      }
    },
    presentCall(args) {
      const titles = {
        run_start: 'Start tracking pass', evidence: 'Record evidence', assess: 'Update stance',
        run_close: 'Close tracking pass', reply: 'Reply to the reader', note: 'Leave a note',
        topic_add: 'Add topic', topic_update: 'Update topic',
      }
      return { card: 'generic', title: titles[args.action] ?? 'Record to thesis trail', kind: 'other' }
    },
  })))

  // ---------------------------------------------------------------- schedule
  //
  // Each board keeps its own pass rule: daily or weekly, a wall-clock time, a time
  // zone, active or paused. The plugin checks the rules once a minute. A rule fires
  // once per scheduled instant; when dsh was closed at that instant, the latest
  // missed one runs once at the next start and older ones do not pile up. Up to
  // v7 the rule lived in a dsh schedule task; adoptScheduleTasks() copies it here
  // once and deletes the task.

  /**
   * Steps for a pass run by hand in a chat: trail_brief with pass: true returns
   * them. Scheduled passes no longer go through a chat; see research below.
   */
  const passGuide = board => `这是「循迹」标的「${board.title}」的一轮巡检。board id 是 ${board.id}：调用 trail_brief、trail_timeline、trail_record 时都带上 board: "${board.id}"。trail_brief 里的 today 是今天的日期：引用财报、指引这类定期发布的数据前，先确认它是 today 之前最新的一期，不要把一年前的季报当成最新数据。

先处理 inbox，那是人在上次巡检之后留下的东西，人的意见以人为准：
- 评论（kind 是 note 或 reply）：带 anchor 的评论针对的是 anchor.field 那一段里的 anchor.quote 这句原文；reply 是已有讨论里的追问，thread 是之前的对话。每条都用 trail_record reply 回复（log_id 填那一条），正面回答。评论要求改写的，用 trail_record topic_update 改对应字段并写 reason，再在回复里说清改了什么。topic_update 返回的 proposed 里的字段并没有改，只是建议：回复时说「建议改成……，等你采纳」，不要说「改了」。
- 人的直接修改（edit）和对你建议的采纳或不采纳（accept / reject）：照此调整你的判断。需要说明时再用 reply 回复，不必每条都回。
- 人亲手改过的字段（每个议题的 human_fields）你不能直接改，topic_update 会变成修订建议等人采纳；被拒过的建议（rejected_proposals）没有新证据就不要再提。

然后只处理 due 为 true 的议题，不要把全部议题都重查一遍（人刚改过或评论过的议题会自动到期）。没到期的议题在 trail_brief 里只有标题和命题，用来判断一条新证据还关联哪些议题。

每个议题的 importance 是人定的重要性，决定查多深：
- high：至少查三个来源，优先一手资料（财报、电话会纪要、监管文件、公司公告），对照证伪条件逐条核对，判断有变化就 assess。
- medium：搜一到两次这个议题最近的进展，有实质发现才入库和评估。
- low：只搜一次有没有重大事件（财报、监管处罚、诉讼、并购、管理层变动），没有就算看过，不写评估。
人刚改过或评论过的议题，不论重要性，都要把人的问题答完整。
流程：trail_record run_start（mode 用 daily）→ 有实质发现就用 trail_record evidence 入库（必须带 url、published_at 和 direction）→ 判断有变化就用 trail_record assess 记录 stance 和理由 → 议题定义需要改就用 trail_record topic_update 并写 reason → 需要人拍板的问题用 trail_record note 留言（可以用 field 和 quote 指向具体那句话）→ 最后 trail_record run_close，summary 写清这轮查了什么、什么没变，checked_topic_ids 填实际看过的议题。什么都没查到也要 close，status 用 ok。run_close 返回 new_inbox 时，说明巡检期间人又留了言：再调一次 trail_brief，把新条目逐条回复。

互不依赖的调用（比如几条 reply、几条 evidence）可以在同一步里一起发出：每多一步，整段上下文都要重新发送一次。

注意：证据必须有真实 URL，没有来源的东西不要入库；同一件事不要重复记两条。`

  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timeZone = localZone

  // Shutting down (dsh quits or reloads the plugin) stops the timers, aborts the
  // research requests in flight, and keeps late callbacks off the closed database.
  let alive = true
  // The checks below run every minute. A failure that persists is logged once,
  // not once a minute, so dsh's log does not fill with the same line.
  const warned = new Map()
  const warn = (what, error) => {
    const message = String(error?.message ?? error)
    if (warned.get(what) === message) return
    warned.set(what, message)
    console.warn(`[thesis-trail] ${what}:`, message)
  }
  const recovered = what => warned.delete(what)
  const stopAll = new AbortController()
  ctx.effect(() => () => { alive = false; stopAll.abort() })

  // A research pass that dsh quit in the middle of left its run open. Close it
  // now, so the board does not wait for that run to time out.
  for (const row of db.prepare("SELECT key, value FROM settings WHERE key LIKE 'api_run:%'").all()) {
    db.prepare("UPDATE run SET status = 'failed', finished_at = ?, summary = COALESCE(summary, ?) WHERE id = ? AND status = 'open'")
      .run(nowIso(), '这一轮没有正常结束：研究进行中 dsh 退出了。', Number(row.value))
    db.prepare('DELETE FROM settings WHERE key = ?').run(row.key)
  }
  const clock = () => (typeof config.now === 'function' ? config.now() : Date.now())

  /** Accept HH:mm (or HH:mm:ss) and keep HH:mm. */
  function clockTime(value) {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/u.exec(String(value ?? '').trim())
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null
    return `${match[1].padStart(2, '0')}:${match[2]}`
  }

  /** ISO weekdays (1 = Monday … 7 = Sunday), deduplicated and sorted. */
  function weekdaysOf(value) {
    if (!Array.isArray(value)) return null
    return [...new Set(value.map(Number))].filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort((a, b) => a - b)
  }

  /** A board's rule with defaults filled in. */
  function ruleOf(board) {
    let weekdays = null
    try { weekdays = weekdaysOf(JSON.parse(board?.weekdays ?? 'null')) } catch { weekdays = null }
    return {
      kind: board?.rule_kind === 'weekly' ? 'weekly' : 'daily',
      time: clockTime(board?.run_time) ?? DEFAULT_TIME,
      weekdays: weekdays?.length ? weekdays : [1],
      timeZone: board?.time_zone || localZone,
      active: Number(board?.active ?? 1) === 1,
    }
  }

  /** What the panel shows: cadence, time, days, next pass. */
  function describeSchedule(board) {
    const rule = ruleOf(board)
    const next = rule.active ? nextSlot(rule, clock()) : null
    return {
      cadence: rule.active ? rule.kind : 'paused',
      kind: rule.kind,
      time: rule.time,
      timeZone: rule.timeZone,
      weekdays: rule.kind === 'weekly' ? rule.weekdays : [],
      active: rule.active,
      next: next === null ? null : new Date(next).toISOString(),
    }
  }

  /** Write a rule. A changed rule starts from now: a time that already passed today does not fire at once. */
  function writeRule(boardId, rule) {
    const slot = latestSlot(rule, clock())
    db.prepare('UPDATE board SET rule_kind = ?, run_time = ?, weekdays = ?, time_zone = ?, active = ?, last_slot_at = ? WHERE id = ?')
      .run(rule.kind, rule.time, JSON.stringify(rule.weekdays), rule.timeZone, rule.active ? 1 : 0,
        new Date(slot ?? clock()).toISOString(), boardId)
  }

  /**
   * The panel's cadence control: daily, weekly on some days, or paused. Pausing
   * keeps the days and time, so resuming brings the same rule back.
   */
  function setCadence(boardId, body = {}) {
    const board = getBoard(boardId)
    if (!board) return { error: 'board_not_found', status: 404 }
    const rule = ruleOf(board)
    if (body.time !== undefined) {
      rule.time = clockTime(body.time)
      if (!rule.time) return { error: 'invalid_time', status: 400 }
    }
    if (body.weekdays !== undefined) {
      const days = weekdaysOf(body.weekdays)
      if (!days?.length) return { error: 'weekdays_required', status: 400 }
      rule.weekdays = days
    }
    if (body.cadence === 'paused') rule.active = false
    else if (body.cadence === 'daily' || body.cadence === 'weekly') { rule.kind = body.cadence; rule.active = true }
    else if (typeof body.active === 'boolean') rule.active = body.active
    writeRule(boardId, rule)
    return { schedule: describeSchedule(getBoard(boardId)) }
  }

  /** Remove a board's old dsh schedule task; a failure is retried at the next start. */
  async function dropTask(board) {
    if (!board.schedule_id) return
    try {
      const result = await ctx.schedule?.edit({ id: board.schedule_id, action: 'delete' })
      if (result && 'code' in result && result.code !== 'schedule_not_found') return
      db.prepare('UPDATE board SET schedule_id = NULL WHERE id = ?').run(board.id)
      recovered('could not delete the old schedule task')
    } catch (error) {
      warn('could not delete the old schedule task', error)
    }
  }

  /** Boards from before v8 kept their rule in a dsh schedule task: copy it here once, then delete the task. */
  async function adoptScheduleTasks() {
    for (const board of boardList()) {
      if (!board.rule_kind) {
        const rule = ruleOf(board)
        if (board.schedule_id && ctx.schedule) {
          const task = await ctx.schedule.view({ id: board.schedule_id }).catch(() => null)
          if (task && !('code' in task)) {
            rule.kind = task.kind === 'weekly' ? 'weekly' : 'daily'
            rule.time = clockTime(task.time) ?? rule.time
            rule.timeZone = task.timeZone || rule.timeZone
            if (rule.kind === 'weekly') rule.weekdays = weekdaysOf(task.weekdays)?.length ? weekdaysOf(task.weekdays) : rule.weekdays
            rule.active = task.status === 'active'
          }
        }
        writeRule(board.id, rule)
      }
      await dropTask(getBoard(board.id))
    }
    db.prepare("DELETE FROM settings WHERE key LIKE 'kick_pending_since%' OR key LIKE 'schedule_error:%' OR key = 'usage_parser_version'").run()
  }

  /** Fire every active board whose latest scheduled instant has not run yet. */
  function tick() {
    if (!alive) return
    try {
      const now = clock()
      for (const board of boardList()) {
        if (!board.rule_kind) continue
        const rule = ruleOf(board)
        if (!rule.active) continue
        const slot = latestSlot(rule, now)
        if (slot === null) continue
        if (board.last_slot_at && slot <= Date.parse(board.last_slot_at)) continue
        db.prepare('UPDATE board SET last_slot_at = ? WHERE id = ?').run(new Date(slot).toISOString(), board.id)
        requestPass(board.id, { reason: 'scheduled' })
      }
      // Retries whose wait is over, one request per board. An entry in flight
      // waits (at = Infinity) until its pass reports back.
      const ready = new Map()
      for (const [topicId, retry] of retries) {
        if (retry.at > now) continue
        if (db.prepare('SELECT status FROM topic WHERE id = ?').get(topicId)?.status !== 'active') {
          retries.delete(topicId)
          continue
        }
        retry.at = Infinity
        if (!ready.has(retry.board)) ready.set(retry.board, [])
        ready.get(retry.board).push(topicId)
      }
      for (const [boardId, topicIds] of ready) requestPass(boardId, { reason: 'retry', topicIds })
      recovered('schedule check failed')
    } catch (error) {
      // A timer callback must never throw into dsh.
      warn('schedule check failed', error)
    }
  }

  // Adopting runs at start and again while an old task is still left to delete
  // (the schedule service can refuse while dsh is still starting).
  let adopting = null
  const adopt = () => {
    if (adopting) return adopting
    if (!alive) return Promise.resolve()
    adopting = adoptScheduleTasks()
      .catch(error => warn('adopting schedule tasks failed', error))
      .finally(() => { adopting = null })
    return adopting
  }

  /** Ask AI comments still waiting from before a restart: research their topics now. */
  function pickUpAsks() {
    if (!alive) return
    try {
      const byBoard = new Map()
      for (const row of db.prepare(
        "SELECT DISTINCT board_id, topic_id FROM topic_log WHERE author = 'human' AND state = 'open' AND ask_ai = 1",
      ).all()) {
        if (!byBoard.has(row.board_id)) byBoard.set(row.board_id, [])
        byBoard.get(row.board_id).push(row.topic_id)
      }
      for (const [boardId, topicIds] of byBoard) requestPass(boardId, { reason: 'ask', topicIds })
    } catch (error) {
      warn('picking up waiting comments failed', error)
    }
  }

  ctx.effect(() => {
    const start = setTimeout(() => { adopt().finally(() => { pickUpAsks(); tick() }) }, config.startDelayMs ?? 5000)
    const timer = setInterval(() => {
      if (!alive) return
      try {
        if (boardList().some(board => board.schedule_id || !board.rule_kind)) adopt()
      } catch { /* the next tick tries again */ }
      tick()
    }, TICK_MS)
    start.unref?.()
    timer.unref?.()
    return () => { clearTimeout(start); clearInterval(timer) }
  })

  // ---------------------------------------------------------------- research
  //
  // One pass researches the board's due topics (and any topic the reader left an
  // item on): one DeepSeek request per topic, two at a time. The service runs the
  // searches; the answer ends with a JSON block that is checked and written here.
  // Evidence is only kept when its URL is one the service actually returned or
  // opened in this request, so a link the model made up never enters the store.

  const prices = {
    ...DEFAULT_PRICES,
    models: { ...DEFAULT_PRICES.models, ...config.prices?.models ?? {} },
    tools: { ...DEFAULT_PRICES.tools, ...config.prices?.tools ?? {} },
  }
  const fetchImpl = typeof config.fetch === 'function' ? config.fetch : globalThis.fetch

  /** The DeepSeek key: bundle config, then the environment, then dsh's own ~/.dsh/.env. */
  /**
   * The DeepSeek API key: the one the reader saved in dsh (its credentials
   * service, which the Models page writes), else the launch environment, else
   * DEEPSEEK_API_KEY in $DSH_HOME/.env. Read for each use, so a changed key
   * applies at once. Never logged.
   */
  async function apiKey() {
    if (typeof config.apiKey === 'string' && config.apiKey.trim() !== '') return config.apiKey.trim()
    try {
      const stored = (await ctx.get?.('credentials')?.resolve('DEEPSEEK_API_KEY'))?.value
      if (typeof stored === 'string' && stored.trim() !== '') return stored.trim()
    } catch { /* no credentials service, or it failed: fall back below */ }
    if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim()
    const home = dshHome()
    try {
      const match = readFileSync(join(home, '.env'), 'utf8').match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*)$/m)
      const value = match?.[1]?.trim().replace(/^["']|["']$/g, '')
      return value || null
    } catch {
      return null
    }
  }

  const running = new Map()
  const pending = new Map()
  // topic id → { board, at, attempts }: research to try again. Kept in memory on
  // purpose: after a restart a due topic waits for its schedule, and an Ask AI
  // comment is picked up at start (pickUpAsks), so nothing is lost.
  const retries = new Map()

  /** Topics a pass should research: the named ones, or every due topic plus every topic with an open reader item. */
  function selectTopics(boardId, topicIds, includeDue) {
    const ids = new Set((topicIds ?? []).map(String))
    if (includeDue) {
      const now = nowIso()
      for (const row of db.prepare(
        "SELECT DISTINCT l.topic_id FROM topic_log l JOIN topic t ON t.id = l.topic_id WHERE l.board_id = ? AND l.author = 'human' AND l.state = 'open' AND t.status = 'active'",
      ).all(boardId)) ids.add(row.topic_id)
      for (const row of db.prepare(
        "SELECT id FROM topic WHERE board_id = ? AND status = 'active' AND (next_due_at IS NULL OR next_due_at <= ?)",
      ).all(boardId, now)) ids.add(row.id)
    }
    return db.prepare(`
      SELECT * FROM topic WHERE board_id = ?
      ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END, seq, created_at
    `).all(boardId).filter(topic => ids.has(topic.id))
  }

  /**
   * Ask for a pass. One pass runs per board at a time; requests that arrive while
   * it runs are merged into one follow-up pass. Returns at once.
   */
  function requestPass(boardId, { reason = 'manual', topicIds = null } = {}) {
    if (!alive) return { busy: false }
    const want = pending.get(boardId) ?? { due: false, topics: new Set(), reason }
    if (topicIds) for (const id of topicIds) want.topics.add(String(id))
    else want.due = true
    if (reason === 'scheduled' || !want.reason) want.reason = reason
    pending.set(boardId, want)
    const busy = running.has(boardId)
    if (!busy) drain(boardId)
    return { busy }
  }

  /** What the panel's buttons call: start research now, or queue it behind the pass that is running. */
  async function startResearch(boardId, topicIds, reason) {
    if (await apiKey() === null) return { ok: false, code: 'no_api_key' }
    const { busy } = requestPass(boardId, { reason, topicIds })
    return { ok: true, queued: busy }
  }

  function drain(boardId) {
    const job = (async () => {
      while (pending.has(boardId)) {
        const want = pending.get(boardId)
        pending.delete(boardId)
        if (await apiKey() === null) {
          writeSetting(`research_error:${boardId}`, 'no_api_key')
          for (const [topicId, retry] of retries) if (retry.board === boardId) retries.delete(topicId)
          continue
        }
        const topics = selectTopics(boardId, [...want.topics], want.due)
        if (topics.length === 0) {
          if (want.due) writeSetting(`idle_at:${boardId}`, nowIso())
          continue
        }
        await researchPass(boardId, topics, want.reason)
      }
    })()
      .catch(error => {
        if (!alive) return
        try { writeSetting(`research_error:${boardId}`, String(error?.message ?? error)) } catch { /* the database is gone */ }
      })
      .finally(() => {
        running.delete(boardId)
        if (alive && pending.has(boardId)) drain(boardId)
      })
    running.set(boardId, job)
    return job
  }

  /** When the board's next retry is due, or null. */
  function retryAtOf(boardId) {
    const times = [...retries.values()].filter(retry => retry.board === boardId && Number.isFinite(retry.at)).map(retry => retry.at)
    return times.length ? new Date(Math.min(...times)).toISOString() : null
  }

  /** Resolves when the board has no pass running or queued; for tests and shutdown. */
  async function settled(boardId) {
    while (running.has(boardId)) await running.get(boardId)
  }
  if (config.hooks && typeof config.hooks === 'object') Object.assign(config.hooks, { tick, settled, adoptScheduleTasks, requestPass })

  /** Research a set of topics as one run. */
  async function researchPass(boardId, topics, reason) {
    const board = getBoard(boardId)
    if (!board) return
    // A run left open by a pass that never finished is closed; a fresh one (a pass in a chat) is waited out.
    const open = db.prepare("SELECT * FROM run WHERE board_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(boardId)
    if (open) {
      if (clock() - Date.parse(open.started_at) < STALE_RUN_MS) {
        for (const topic of topics) {
          retries.set(topic.id, { board: boardId, at: clock() + RETRY_DELAYS_MS[0], attempts: retries.get(topic.id)?.attempts ?? 0 })
        }
        return
      }
      db.prepare("UPDATE run SET status = 'failed', finished_at = ?, summary = COALESCE(summary, ?) WHERE id = ?")
        .run(nowIso(), '这一轮没有正常结束（dsh 中途退出）。', open.id)
    }
    const mode = reason === 'scheduled' ? ruleOf(board).kind : { ask: 'event', retry: 'retry' }[reason] ?? 'manual'
    const started = startRun(boardId, mode)
    if (started.error) return
    const runId = started.run_id
    writeSetting(`api_run:${boardId}`, runId)
    // The reader items this pass answers; anything newer waits for the next pass.
    const inbox = inboxOf(db, boardId)
    const cursor = Math.max(Number(readSetting(`brief_cursor:${boardId}`) ?? 0), 0, ...inbox.map(item => item.log_id))
    writeSetting(`brief_cursor:${boardId}`, cursor)
    const others = db.prepare("SELECT id, title FROM topic WHERE board_id = ? AND status = 'active' ORDER BY seq").all(boardId)
    const queue = [...topics]
    const results = []
    let turn = 0
    const worker = async () => {
      while (queue.length > 0) {
        const topic = queue.shift()
        turn += 1
        const items = inbox.filter(item => item.topic_id === topic.id)
        results.push(await researchOne(board, topic, runId, turn, items, others))
      }
    }
    await Promise.all(Array.from({ length: Math.min(RESEARCH_CONCURRENCY, queue.length) }, worker))
    if (!alive) return
    const done = results.filter(result => result.ok)
    const failed = results.filter(result => !result.ok)
    const status = failed.length === 0 ? 'ok' : done.length > 0 ? 'partial' : 'failed'
    const summary = results.length === 1
      ? results[0].summary ?? `没有完成：${results[0].error}`
      : [`研究了 ${results.length} 个议题${failed.length ? `，${failed.length} 个没有完成` : ''}。`,
        ...results.map(result => `「${result.title}」：${result.ok ? result.summary ?? '' : `没有完成：${result.error}`}`)].join('\n')
    // closeRun marks every reader item up to the cursor as seen. Items on a topic
    // whose research failed, or on an active topic this pass did not include,
    // were not answered: they stay open for the next pass.
    const researched = new Set(done.map(result => result.topicId))
    const selected = new Set(topics.map(topic => topic.id))
    const active = new Set(others.map(other => other.id))
    const unanswered = inbox
      .filter(item => selected.has(item.topic_id) ? !researched.has(item.topic_id) : active.has(item.topic_id))
      .map(item => item.log_id)
    closeRun(boardId, runId, status, summary, done.map(result => result.topicId))
    db.prepare('DELETE FROM settings WHERE key = ?').run(`api_run:${boardId}`)
    // A topic whose research failed stays as due as it was, even when evidence
    // another topic found was linked to it.
    const restoreDue = db.prepare('UPDATE topic SET next_due_at = ?, checked_at = ? WHERE id = ?')
    for (const topic of topics) if (!researched.has(topic.id)) restoreDue.run(topic.next_due_at, topic.checked_at, topic.id)
    if (unanswered.length > 0) {
      db.prepare(`UPDATE topic_log SET state = 'open' WHERE state = 'seen' AND id IN (${unanswered.map(() => '?').join(', ')})`).run(...unanswered)
    }
    if (failed.length > 0) writeSetting(`research_error:${boardId}`, failed[0].error)
    else db.prepare('DELETE FROM settings WHERE key = ?').run(`research_error:${boardId}`)
    // A failure for a passing reason is tried again twice, after 5 and 20 minutes;
    // anything else waits for the next scheduled pass.
    for (const result of results) {
      const attempts = (retries.get(result.topicId)?.attempts ?? 0) + 1
      if (result.ok || !TRANSIENT_ERROR.test(result.error ?? '') || attempts > RETRY_DELAYS_MS.length) retries.delete(result.topicId)
      else retries.set(result.topicId, { board: boardId, at: clock() + RETRY_DELAYS_MS[attempts - 1], attempts })
    }
    // A comment that asks the AI while this pass runs is queued by its route, so
    // nothing more to do here; other items wait for the next scheduled pass.
  }

  /** One research request for one topic, written to the store. */
  async function researchOne(board, topic, runId, turn, items, others) {
    const importance = IMPORTANCE.includes(topic.importance) ? topic.importance : DEFAULT_IMPORTANCE
    const mode = MODE_OF[importance]
    const last = db.prepare('SELECT stance, created_at, rationale FROM assessment WHERE topic_id = ? ORDER BY id DESC LIMIT 1').get(topic.id)
    const evidence = db.prepare(`
      SELECT e.title, e.url, e.published_at FROM evidence e JOIN evidence_topic et ON et.evidence_id = e.id
      WHERE et.topic_id = ? ORDER BY COALESCE(e.published_at, e.captured_at) DESC LIMIT 15
    `).all(topic.id)
    const collaboration = topicCollaboration(db, topic.id)
    const day = iso => localDate(new Date(iso), localZone)
    const prompt = researchPrompt({
      today: localDate(new Date(clock()), localZone),
      board, topic, mode,
      lastChecked: topic.checked_at ? day(topic.checked_at) : null,
      stance: last ? { value: Number(last.stance), at: day(last.created_at), rationale: last.rationale } : null,
      evidence,
      inbox: items,
      humanFields: collaboration.human_fields,
      pending: collaboration.pending_proposals,
      rejected: collaboration.rejected_proposals,
      others: others.filter(other => other.id !== topic.id),
    })
    const result = await runResearch({ fetch: fetchImpl, apiKey: await apiKey(), prompt, mode, signal: stopAll.signal })
    if (!alive) return { ok: false, topicId: topic.id, title: topic.title, summary: null, error: 'stopped' }
    const parsed = result.error ? null : parseAnswer(result.text)
    const error = result.error ?? (parsed.ok ? null : parsed.error)
    let applied = null
    if (!error) {
      try {
        applied = applyAnswer(board.id, topic, runId, parsed.data, result.trace, items, others)
      } catch (failure) {
        applied = { error: String(failure?.message ?? failure) }
      }
    }
    recordPass(board.id, topic, runId, turn, mode, result, parsed?.data ?? null, error, applied)
    return {
      ok: !error,
      topicId: topic.id,
      title: topic.title,
      summary: text(parsed?.data?.summary) || null,
      error,
    }
  }

  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }

  /** Write one answer: evidence it actually saw, stance, replies, edits, a question, an earlier next check. */
  function applyAnswer(boardId, topic, runId, data, trace, items, others) {
    // A link can come back from a search and again from reading the page: keep both sides' details.
    const seen = new Map()
    for (const result of trace.results) {
      const key = normalizeUrl(result.url)
      const known = Object.entries(result).filter(([, value]) => value !== null && value !== undefined)
      seen.set(key, { ...seen.get(key), ...Object.fromEntries(known) })
    }
    for (const page of trace.pages) if (!seen.has(normalizeUrl(page.url))) seen.set(normalizeUrl(page.url), { url: page.url })
    for (const url of trace.cites) if (!seen.has(normalizeUrl(url))) seen.set(normalizeUrl(url), { url })
    const onBoard = new Set(others.map(other => other.id))
    const out = { evidence: 0, duplicates: 0, dropped: [], assessed: false, replies: 0, applied: [], proposed: [], question: false }
    const link = db.prepare('INSERT OR IGNORE INTO evidence_topic (evidence_id, topic_id) VALUES (?, ?)')
    for (const item of (Array.isArray(data.evidence) ? data.evidence : []).slice(0, 8)) {
      const url = text(item?.url)
      const source = url ? seen.get(normalizeUrl(url)) : undefined
      if (!source) { out.dropped.push(url || '(no url)'); continue }
      const topicIds = [topic.id, ...(Array.isArray(item.also_topics) ? item.also_topics : [])
        .map(String).filter(id => id !== topic.id && onBoard.has(id))]
      const published = /^\d{4}-\d{2}-\d{2}/.test(String(item.published_at ?? ''))
        ? String(item.published_at).slice(0, 10)
        : source.page_age ? String(source.page_age).slice(0, 10) : null
      const written = addEvidence(boardId, runId, {
        title: text(item.title) || source.title || url,
        url,
        source: source.site ?? hostOf(url),
        published_at: published,
        summary: text(item.summary),
        direction: [-1, 0, 1].includes(Number(item.direction)) ? Number(item.direction) : 0,
        kind: ['news', 'filing', 'transcript', 'paper', 'data', 'note'].includes(item.kind) ? item.kind : 'news',
        topic_ids: topicIds,
      })
      if (written.error) { out.dropped.push(url); continue }
      if (written.deduplicated) {
        out.duplicates += 1
        for (const id of topicIds) link.run(written.evidence_id, id)
      } else {
        out.evidence += 1
      }
    }
    const stance = Number(data.stance)
    if (data.stance !== null && data.stance !== undefined && data.stance !== '' && Number.isFinite(stance)) {
      const assessed = addAssessment(topic.id, runId, {
        stance,
        confidence: data.confidence,
        rationale: text(data.rationale) || text(data.summary),
      })
      out.assessed = !assessed.error
    }
    const asked = new Set(items.map(item => item.log_id))
    for (const reply of Array.isArray(data.replies) ? data.replies : []) {
      const logId = Number(reply?.log_id)
      if (!asked.has(logId) || text(reply.body) === '') continue
      if (!agentReply(boardId, logId, reply.body, runId).error) out.replies += 1
    }
    for (const edit of Array.isArray(data.edits) ? data.edits : []) {
      const field = text(edit?.field)
      const value = text(edit?.value)
      if (!ANCHOR_FIELDS.includes(field) || value === '' || same(topic[field], value)) continue
      const changed = agentEdit(boardId, topic.id, { [field]: value, reason: text(edit.reason) || text(data.summary) || '研究后修订' }, runId)
      if (changed.error) continue
      out.applied.push(...changed.applied ?? [])
      out.proposed.push(...changed.proposed ?? [])
    }
    // One open AI question per topic: while one waits for the reader, a new one is not added.
    if (text(data.question) !== '') {
      const waiting = db.prepare(`
        SELECT 1 FROM topic_log q WHERE q.topic_id = ? AND q.author = 'agent' AND q.kind = 'note' AND q.resolved_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM topic_log r WHERE r.ref_id = q.id) LIMIT 1
      `).get(topic.id)
      if (waiting) out.question_skipped = true
      else out.question = !agentNote(boardId, topic.id, { body: data.question }, runId).error
    }
    // The falsifier met: one alert on the topic, refreshed by later passes, until the reader dismisses it.
    if (data.falsifier_triggered === true) {
      db.prepare('UPDATE topic SET falsified_at = ?, falsified_note = ? WHERE id = ?')
        .run(nowIso(), text(data.rationale) || text(data.summary) || null, topic.id)
      out.falsified = true
    }
    const nextCheck = /^\d{4}-\d{2}-\d{2}$/.test(text(data.next_check)) ? text(data.next_check) : null
    if (nextCheck) {
      const at = new Date(`${nextCheck}T00:00:00`).toISOString()
      if (at > nowIso()) db.prepare('UPDATE topic SET next_due_at = ? WHERE id = ?').run(at, topic.id)
    }
    return out
  }

  /** One research request as a pass row: tokens, searches, what it looked at, what it concluded. */
  function recordPass(boardId, topic, runId, turn, mode, result, data, error, applied) {
    const usage = result.usage ?? {}
    const { searches, fetches } = toolCounts(usage)
    const sessionId = `api-run-${runId}`
    // What the research log shows; the search results themselves are only needed while the answer is checked.
    const trace = {
      queries: result.trace.queries.slice(0, 60),
      pages: result.trace.pages.slice(0, 60),
      applied,
      ...data ? { stance: data.stance ?? null, falsifier_triggered: data.falsifier_triggered === true } : {},
    }
    transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO pass (session_id, turn, board_id, schedule_id, started_at, ended_at, steps, searches, fetches, final,
          topic_id, mode, run_id, summary, trace, answer, error)
        VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, turn, boardId, new Date(result.startedAt).toISOString(), new Date(result.endedAt).toISOString(),
        result.steps, searches, fetches, topic.id, mode, runId, text(data?.summary) || null,
        JSON.stringify(trace), answerProse(result.text).slice(0, 20000) || null, error,
      )
      db.prepare(`
        INSERT OR REPLACE INTO pass_tokens (session_id, turn, model, period, input, cache_hit, output)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId, turn, RESEARCH_MODEL, isPeak(result.startedAt) ? 'peak' : 'off',
        Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0),
        Number(usage.cache_read_input_tokens ?? 0), Number(usage.output_tokens ?? 0),
      )
      pruneResearch()
    })
  }

  /**
   * Keep the full text (answer and trace) of each topic's latest research only,
   * as many as the panel shows. Older rows keep tokens, cost and summary.
   */
  function pruneResearch() {
    db.prepare(`
      UPDATE pass SET answer = NULL, trace = NULL WHERE rowid IN (
        SELECT rowid FROM (
          SELECT rowid, answer, trace, ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY started_at DESC) AS n
          FROM pass WHERE mode <> 'session' AND topic_id IS NOT NULL
        ) WHERE n > ? AND (answer IS NOT NULL OR trace IS NOT NULL)
      )
    `).run(RESEARCH_LOG_KEEP)
  }
  pruneResearch()

  // ---------------------------------------------------------------- boards

  /** Add a board (one company or asset to track) with its pass rule. */
  function addBoard(input = {}) {
    const title = text(input.title)
    if (title === '') return { error: 'board_needs_title', status: 400 }
    if (title.length > 80) return { error: 'board_title_too_long', status: 400 }
    let id = slugOf(text(input.id) || title)
    if (id === '') id = `b${Date.now().toString(36)}`
    const base = id
    for (let n = 2; getBoard(id); n += 1) id = `${base}-${n}`
    db.prepare('INSERT INTO board (id, title, note, created_at) VALUES (?, ?, ?, ?)').run(id, title, text(input.note) || null, nowIso())
    writeRule(id, { ...ruleOf(getBoard(id)), kind: 'daily', active: true })
    const cadence = setCadence(id, {
      cadence: ['daily', 'weekly', 'paused'].includes(input.cadence) ? input.cadence : 'daily',
      ...input.time === undefined ? {} : { time: input.time },
      ...input.weekdays === undefined ? {} : { weekdays: input.weekdays },
    })
    if (cadence.error) {
      db.prepare('DELETE FROM board WHERE id = ?').run(id)
      return cadence
    }
    return { board: id, schedule: cadence.schedule }
  }

  /**
   * Check a board file and, unless `dry_run`, create its board and topics with
   * the given cadence. Imported topics are all due, so the next pass researches
   * every one of them.
   */
  function importBoard(input = {}) {
    const parsed = parseBoardMarkdown(input.markdown)
    const problems = [...parsed.problems]
    if (parsed.title.length > 80) problems.push({ code: 'board_title_too_long' })
    const topics = parsed.topics.map(topic => ({ ...topic, importance: topic.importance ?? DEFAULT_IMPORTANCE }))
    const preview = {
      title: parsed.title,
      note: parsed.note,
      topics: topics.map(topic => ({ title: topic.title, importance: topic.importance })),
      estimate: topics.reduce((sum, topic) => sum + PASS_ESTIMATE[topic.importance], 0),
      problems,
    }
    if (problems.length > 0) return { error: 'board_file_invalid', status: 400, ...preview }
    if (input.dry_run === true) return preview
    const created = addBoard({ title: parsed.title, note: parsed.note, cadence: input.cadence, time: input.time, weekdays: input.weekdays })
    if (created.error) return created
    for (const topic of topics) {
      const result = addTopic(created.board, topic, 'human', { imported: true })
      if (!result.error) continue
      // A half-made board is worse than none: take it all back.
      transaction(() => {
        db.prepare('DELETE FROM topic_log WHERE board_id = ?').run(created.board)
        db.prepare('DELETE FROM topic WHERE board_id = ?').run(created.board)
        db.prepare('DELETE FROM board WHERE id = ?').run(created.board)
      })
      return { ...result, status: 400, topic: topic.title }
    }
    return { board: created.board, schedule: created.schedule, ...preview }
  }

  /** Rename a board or change its note. */
  function editBoard(boardId, input = {}) {
    const board = getBoard(boardId)
    if (!board) return { error: 'board_not_found', status: 404 }
    const title = input.title === undefined ? board.title : text(input.title)
    if (title === '') return { error: 'board_needs_title', status: 400 }
    const note = input.note === undefined ? board.note : text(input.note) || null
    if (title === board.title && note === board.note) return { error: 'nothing_to_update', status: 400 }
    db.prepare('UPDATE board SET title = ?, note = ? WHERE id = ?').run(title, note, boardId)
    return { board: boardId }
  }

  // ---------------------------------------------------------------- usage
  //
  // Every research request is one pass row with its billed tokens and its billed
  // searches and fetches, straight from the API response. Rows with mode
  // 'session' are older passes that ran in dsh sessions; their search fees were
  // not known and are not counted.

  /** Cost of one pass row's searches and fetches. */
  const toolCost = pass => pass.mode === 'session' ? 0
    : Number(pass.searches ?? 0) * prices.tools.search + Number(pass.fetches ?? 0) * prices.tools.fetch

  /** Every recorded pass with its tokens and cost, newest first. */
  function usageOf() {
    const tokenRows = db.prepare('SELECT * FROM pass_tokens').all()
    const byPass = new Map()
    for (const row of tokenRows) {
      const key = `${row.session_id}\u0000${row.turn}`
      if (!byPass.has(key)) byPass.set(key, [])
      byPass.get(key).push(row)
    }
    const runById = db.prepare('SELECT id, status, summary, checked FROM run WHERE id = ?')
    const runIn = db.prepare(`
      SELECT id, status, summary, checked FROM run
      WHERE board_id = ? AND started_at >= ? AND started_at <= ? ORDER BY id LIMIT 1
    `)
    const titleOf = db.prepare('SELECT title FROM topic WHERE id = ?')
    const passes = db.prepare('SELECT * FROM pass ORDER BY started_at DESC LIMIT 2000').all().map(pass => {
      const rows = byPass.get(`${pass.session_id}\u0000${pass.turn}`) ?? []
      const models = [...new Set(rows.map(row => row.model))]
      let cost = 0
      let unpriced = 0
      const sum = { input: 0, cache_hit: 0, output: 0 }
      for (const row of rows) {
        sum.input += Number(row.input)
        sum.cache_hit += Number(row.cache_hit)
        sum.output += Number(row.output)
        const value = costOf(prices, row.model, row.period, { input: Number(row.input), cache_hit: Number(row.cache_hit), output: Number(row.output) })
        if (value === null) unpriced += Number(row.input) + Number(row.cache_hit) + Number(row.output)
        else cost += value
      }
      // Priced when at least part of the tokens has a price; a request that failed before any token is free.
      const priced = rows.length > 0 && (unpriced === 0 || unpriced < sum.input + sum.cache_hit + sum.output)
      const tools = toolCost(pass)
      const run = pass.run_id ? runById.get(pass.run_id) : runIn.get(pass.board_id, pass.started_at, pass.ended_at ?? nowIso())
      let checked = []
      try { checked = JSON.parse(run?.checked ?? '[]') } catch { checked = [] }
      return {
        id: `${pass.session_id}#${pass.turn}`,
        session_id: pass.session_id,
        board_id: pass.board_id,
        topic_id: pass.topic_id ?? null,
        topic_title: pass.topic_id ? titleOf.get(pass.topic_id)?.title ?? null : null,
        mode: pass.mode ?? 'session',
        started_at: pass.started_at,
        ended_at: pass.ended_at,
        final: Number(pass.final) === 1,
        steps: Number(pass.steps),
        searches: Number(pass.searches),
        fetches: Number(pass.fetches),
        models,
        ...sum,
        token_cost: priced ? cost : null,
        tool_cost: tools,
        cost: priced ? cost + tools : null,
        unpriced_tokens: unpriced,
        summary: pass.summary ?? null,
        error: pass.error ?? null,
        run: run ? { id: Number(run.id), status: run.status, summary: run.summary, checked } : null,
      }
    })
    return {
      currency: prices.currency,
      prices: { source: prices.source, checked_at: prices.checked_at, models: prices.models, tools: prices.tools },
      boards: boardList().map(board => ({ id: board.id, title: board.title })),
      passes,
    }
  }

  /** Cost of passes since the first of this month (local time), per board and in total. */
  function monthCost() {
    const now = new Date()
    const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const rows = db.prepare(`
      SELECT p.board_id, t.model, t.period, SUM(t.input) AS input, SUM(t.cache_hit) AS cache_hit, SUM(t.output) AS output
      FROM pass p JOIN pass_tokens t ON t.session_id = p.session_id AND t.turn = p.turn
      WHERE p.started_at >= ? GROUP BY p.board_id, t.model, t.period
    `).all(since)
    const boards = {}
    let total = 0
    for (const row of rows) {
      const value = costOf(prices, row.model, row.period, { input: Number(row.input), cache_hit: Number(row.cache_hit), output: Number(row.output) }) ?? 0
      boards[row.board_id] = (boards[row.board_id] ?? 0) + value
      total += value
    }
    const tools = db.prepare(`
      SELECT board_id, SUM(searches) AS searches, SUM(fetches) AS fetches FROM pass
      WHERE started_at >= ? AND mode <> 'session' GROUP BY board_id
    `).all(since)
    for (const row of tools) {
      const value = toolCost({ mode: 'api', searches: row.searches, fetches: row.fetches })
      boards[row.board_id] = (boards[row.board_id] ?? 0) + value
      total += value
    }
    return { since, total, boards }
  }

  /** The latest research requests on one topic, for the panel's research log. */
  function researchOf(topicId, limit = RESEARCH_LOG_KEEP) {
    return db.prepare(`
      SELECT * FROM pass WHERE topic_id = ? AND mode <> 'session' ORDER BY started_at DESC LIMIT ?
    `).all(topicId, limit).map(pass => {
      let trace = {}
      try { trace = JSON.parse(pass.trace ?? '{}') } catch { trace = {} }
      const tokens = db.prepare('SELECT * FROM pass_tokens WHERE session_id = ? AND turn = ?').all(pass.session_id, pass.turn)
      const tokenCost = tokens.reduce((sum, row) => sum + (costOf(prices, row.model, row.period, row) ?? 0), 0)
      return {
        id: `${pass.session_id}#${pass.turn}`,
        run_id: pass.run_id,
        mode: pass.mode,
        started_at: pass.started_at,
        ended_at: pass.ended_at,
        steps: Number(pass.steps),
        searches: Number(pass.searches),
        fetches: Number(pass.fetches),
        cost: tokenCost + toolCost(pass),
        summary: pass.summary,
        error: pass.error,
        queries: trace.queries ?? [],
        pages: trace.pages ?? [],
        applied: trace.applied ?? null,
        falsifier_triggered: trace.falsifier_triggered === true,
        answer: pass.answer,
      }
    })
  }

  // ---------------------------------------------------------------- http

  // `webServer` is a declared injection, so the plugin activates only once the
  // carrier exists: reading it with ctx.get() at activation time races the mount
  // and silently leaves the panel without a route (the SPA fallback then answers 404).
  const web = ctx.webServer

  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

  /** Reader writes answer with the error's own status, or 200 with the result. */
  const outcome = result => {
    if (!result.error) return json({ ok: true, ...result })
    const { status = 400, ...rest } = result
    return json({ ok: false, ...rest }, status)
  }

  /** Every route, as one Fetch Request → Response function. */
  async function route(request) {
    const url = new URL(request.url, 'http://127.0.0.1')
    const path = url.pathname.slice(API_PREFIX.length) || '/'
    // No board named: the first one. A fresh store has none until the reader adds one.
    const boardId = boardOf(url.searchParams.get('board')) || (boardList()[0]?.id ?? '')
    try {
      if (request.method === 'GET' && path === '/state') {
        const state = stateOf(db, boardId)
        if (!state) return json({ error: 'board_not_found' }, 404)
        const month = monthCost()
        return json({
          ...state,
          cost: { currency: prices.currency, month: month.total, board_month: month.boards[boardId] ?? 0, since: month.since },
          research: {
            running: running.has(boardId),
            error: readSetting(`research_error:${boardId}`) ?? null,
            idle_at: readSetting(`idle_at:${boardId}`) ?? null,
            retry_at: retryAtOf(boardId),
            has_key: await apiKey() !== null,
          },
        })
      }
      if (request.method === 'GET' && path === '/boards') {
        const month = monthCost()
        const boards = boardList().map(board => {
          const stats = stateOf(db, board.id, { detail: false })?.stats ?? {}
          return {
            id: board.id,
            title: board.title,
            note: board.note,
            created_at: board.created_at,
            schedule: describeSchedule(board),
            running: running.has(board.id),
            stats: {
              topics: stats.topics, due: stats.due, pending_proposals: stats.pending_proposals,
              waiting_agent: stats.waiting_agent, unread: stats.unread,
            },
            badge: badgeOf(db, board.id),
            month_cost: month.boards[board.id] ?? 0,
          }
        })
        return json({ boards, currency: prices.currency, month_cost: month.total, has_key: await apiKey() !== null })
      }
      if (request.method === 'GET' && path === '/usage') {
        return json(usageOf())
      }
      if (request.method === 'POST' && path === '/board/import') {
        const body = await request.json().catch(() => ({}))
        return outcome(importBoard(body))
      }
      if (request.method === 'GET' && path === '/board/export') {
        const board = getBoard(boardId)
        if (!board) return json({ error: 'board_not_found' }, 404)
        // Closed and merged topics are history, not part of what to track.
        const topics = db.prepare("SELECT * FROM topic WHERE board_id = ? AND status IN ('active', 'paused') ORDER BY seq, id").all(boardId)
        return json({ ok: true, board: board.id, markdown: boardToMarkdown(board, topics, url.searchParams.get('lang') === 'en' ? 'en' : 'zh') })
      }
      if (request.method === 'POST' && (path === '/board/add' || path === '/board/edit')) {
        const body = await request.json().catch(() => ({}))
        return outcome(path === '/board/add' ? addBoard(body) : editBoard(body.board ? boardOf(body.board) : boardId, body))
      }
      if (request.method === 'GET' && path === '/timeline') {
        const topicId = url.searchParams.get('topic') ?? ''
        const timeline = timelineOf(db, boardId, topicId, 60, 500)
        return timeline ? json({ ...timeline, research: researchOf(topicId) }) : json({ error: 'topic_not_found' }, 404)
      }
      if (request.method === 'GET' && path === '/badge') {
        if (url.searchParams.has('board')) return json(badgeOf(db, boardId))
        // The sidebar icon speaks for every board.
        const total = { unread: 0, flipped: 0, flipped_other: 0, agent: 0, falsified: 0 }
        for (const board of boardList()) {
          const badge = badgeOf(db, board.id)
          for (const key of Object.keys(total)) total[key] += badge[key]
        }
        return json(total)
      }
      if (request.method === 'POST' && path === '/seen') {
        if (!getBoard(boardId)) return json({ error: 'board_not_found' }, 404)
        const latest = db.prepare('SELECT MAX(id) AS e FROM evidence WHERE board_id = ?').get(boardId)
        const latestAssessment = db.prepare(`
          SELECT MAX(a.id) AS a FROM assessment a JOIN topic t ON t.id = a.topic_id WHERE t.board_id = ?
        `).get(boardId)
        const latestLog = db.prepare('SELECT MAX(id) AS l FROM topic_log WHERE board_id = ?').get(boardId)
        db.prepare(`
          INSERT INTO seen (board_id, last_evidence_id, last_assessment_id, last_log_id) VALUES (?, ?, ?, ?)
          ON CONFLICT(board_id) DO UPDATE SET last_evidence_id = excluded.last_evidence_id,
            last_assessment_id = excluded.last_assessment_id, last_log_id = excluded.last_log_id
        `).run(boardId, Number(latest?.e ?? 0), Number(latestAssessment?.a ?? 0), Number(latestLog?.l ?? 0))
        return json({ ok: true })
      }
      if (/^\/(topic|proposal|log|thread)\//.test(path)) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
        if (!getBoard(boardId)) return json({ ok: false, error: 'board_not_found' }, 404)
        const body = await request.json().catch(() => ({}))
        if (path === '/topic/add') return outcome(addTopic(boardId, { ...body, status: undefined }, 'human'))
        if (path === '/topic/edit') return outcome(humanEdit(boardId, text(body.topic), body))
        if (path === '/topic/restore') return outcome(restoreVersion(boardId, text(body.topic), Number(body.log_id ?? -1), body.note))
        if (path === '/topic/note') {
          const result = humanNote(boardId, text(body.topic), body)
          // Asking the AI researches that topic now; the comment is saved either way.
          if (!result.error && body.ask_ai === true) result.run = await startResearch(boardId, [text(body.topic)], 'ask')
          return outcome(result)
        }
        if (path === '/topic/falsified/dismiss') {
          const topic = getTopic(boardId, text(body.topic))
          if (!topic) return json({ ok: false, error: 'topic_not_found' }, 404)
          db.prepare('UPDATE topic SET falsified_at = NULL, falsified_note = NULL WHERE id = ?').run(topic.id)
          return json({ ok: true })
        }
        if (path === '/topic/research') {
          const topic = getTopic(boardId, text(body.topic))
          if (!topic) return json({ ok: false, error: 'topic_not_found' }, 404)
          return outcome({ run: await startResearch(boardId, [topic.id], 'manual') })
        }
        if (path === '/thread/resolve') return outcome(resolveThread(boardId, Number(body.id), body.resolved !== false))
        if (path === '/proposal/decide') return outcome(decide(boardId, Number(body.id), body.accept === true, body.note))
        if (path === '/log/revert') return outcome(revert(boardId, Number(body.id), body.note))
        return json({ error: 'not_found' }, 404)
      }
      if (request.method === 'GET' && path === '/schedule') {
        if (!getBoard(boardId)) return json({ error: 'board_not_found' }, 404)
        return json(describeSchedule(getBoard(boardId)))
      }
      if (request.method === 'POST' && path === '/schedule') {
        const body = await request.json().catch(() => ({}))
        const result = setCadence(boardId, body)
        if (result.error) return outcome(result)
        return json(result.schedule)
      }
      if (request.method === 'POST' && path === '/run-now') {
        if (!getBoard(boardId)) return json({ ok: false, code: 'board_not_found' }, 404)
        if (selectTopics(boardId, null, true).length === 0 && !running.has(boardId)) {
          return json({ ok: false, code: 'nothing_due' }, 409)
        }
        return json(await startResearch(boardId, null, 'manual'))
      }
      return json({ error: 'not_found' }, 404)
    } catch (error) {
      return json({ error: 'internal_error', message: String(error?.message ?? error) }, 500)
    }
  }

  // The route must be a `handler`: dsh answers anything but GET and HEAD sent to a
  // `resource` route with 405 itself, so the panel's writes would never arrive.
  ctx.effect(() => web.register({
    kind: 'prefix',
    path: API_PREFIX,
    async handler(req, res) {
      let response
      try {
        response = await route(await requestOf(req))
      } catch (error) {
        response = error?.code === 'body_too_large'
          ? json({ error: 'body_too_large' }, 413)
          : json({ error: 'bad_request', message: String(error?.message ?? error) }, 400)
      }
      await sendResponse(res, response)
    },
  }))
}

const MAX_BODY_BYTES = 1024 * 1024

/** A Node request as a Fetch Request. Only the headers the routes read are kept. */
export async function requestOf(req) {
  const method = String(req.method ?? 'GET').toUpperCase()
  const headers = new Headers()
  for (const name of ['content-type', 'accept']) {
    const value = req.headers?.[name]
    if (typeof value === 'string') headers.set(name, value)
  }
  let body
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { code: 'body_too_large' })
      chunks.push(chunk)
    }
    body = Buffer.concat(chunks)
  }
  return new Request(new URL(req.url ?? '/', 'http://127.0.0.1'), { method, headers, body })
}

/** Write a Fetch Response to a Node response. */
export async function sendResponse(res, response) {
  const body = Buffer.from(await response.arrayBuffer())
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  res.setHeader('content-length', String(body.length))
  res.end(body)
}
