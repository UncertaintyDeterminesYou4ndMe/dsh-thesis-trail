// Host logic against a mock ctx and a throwaway database. Never touches ~/.dsh.
// Run: npm test   (Node 24, or DSH's bundled Node, for node:sqlite)
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const dir = mkdtempSync(join(tmpdir(), 'thesis-trail-test-'))
// Removed on every exit, a failed assertion included.
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
const file = join(dir, 'trail.db')
// A fresh store has no board. Every store here starts by importing this one,
// so its ten topics are t1…t10 on board `acme`.
const FIXTURE = readFileSync(new URL('./board.md', import.meta.url), 'utf8')
const { apply, inject, migrateLegacyDatabase, isPeak, costOf, DEFAULT_PRICES, defaultDatabasePath } = await import('../index.js')
const { latestSlot, nextSlot, parseAnswer, answerProse, researchPrompt } = await import('../research.js')
const { makeWeb, ACME_510K } = await import('./fake-web.mjs')
assert.deepEqual(inject, ['tools', 'webServer', 'schedule'])

// ---------------------------------------------------------------- legacy migration
{
  const legacy = join(dir, 'legacy', 'board.db')
  const target = join(dir, 'migrated', 'trail.db')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(dir, 'legacy'), { recursive: true })
  const old = new DatabaseSync(legacy)
  old.exec("PRAGMA journal_mode = WAL; CREATE TABLE board (id TEXT PRIMARY KEY, title TEXT); INSERT INTO board VALUES ('acme', 'Acme');")
  // Leave the write in the WAL: the copy must still carry it.
  assert.equal(migrateLegacyDatabase(legacy, target), true)
  old.close()
  const copy = new DatabaseSync(target, { readOnly: true })
  assert.equal(copy.prepare('SELECT title FROM board').get().title, 'Acme')
  copy.close()
  assert.equal(migrateLegacyDatabase(legacy, target), false, 'an existing target is never overwritten')
  console.log('migration: ok')
}

// ---------------------------------------------------------------- old schema upgrade
{
  const old = new DatabaseSync(file)
  old.exec('CREATE TABLE seen (board_id TEXT PRIMARY KEY, last_evidence_id INTEGER NOT NULL DEFAULT 0, last_assessment_id INTEGER NOT NULL DEFAULT 0)')
  old.close()
}

// ---------------------------------------------------------------- network guard
// Research requests in these tests go to the fake DeepSeek below. The real key
// and the real network are out of reach: no env key, a DSH_HOME without .env,
// and a global fetch that fails the test.
delete process.env.DEEPSEEK_API_KEY
process.env.DSH_HOME = join(dir, 'no-dsh-home')
globalThis.fetch = () => { throw new Error('a test tried to reach the network') }
// The default store follows DSH_HOME, so a second dsh home never opens the first one's data.
assert.equal(defaultDatabasePath(), join(dir, 'no-dsh-home', 'thesis-trail', 'trail.db'))

// ---------------------------------------------------------------- mock host
// The schedule service only matters for adopting the tasks of v7 and earlier:
// view a task, copy its rule, delete it.
function makeHost(initial = []) {
  const tools = new Map()
  const routes = []
  const disposers = []
  const tasks = initial
  const deleted = []
  const control = { failDelete: false }
  const ctx = {
    schedule: {
      async view({ id }) { const task = tasks.find(item => item.id === id); return task ? { ...task } : { id, code: 'schedule_not_found' } },
      async edit({ id, action }) {
        if (action !== 'delete') throw new Error(`unexpected schedule edit: ${action}`)
        if (control.failDelete) throw new Error('schedule service not ready')
        const index = tasks.findIndex(item => item.id === id)
        if (index < 0) return { id, code: 'schedule_not_found' }
        tasks.splice(index, 1)
        deleted.push(id)
        return { id }
      },
    },
    effect(fn) { const d = fn(); disposers.push(d) },
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  return { ctx, tools, routes, tasks, deleted, control, dispose: () => disposers.forEach(d => typeof d === 'function' && d()) }
}

// ---------------------------------------------------------------- fake DeepSeek
// Answers a research request with a stream shaped like the real one. `reply`
// decides each answer: { status } for an HTTP error, or the search results,
// opened pages, usage and the answer's JSON block.
const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
function makeDeepSeek() {
  const calls = []
  let gate = null
  const api = {
    calls,
    reply: () => ({ answer: { summary: '没有新进展', evidence: [], stance: null } }),
    /** Hold every request until the returned function is called. */
    hold() {
      let open
      gate = new Promise(resolve => { open = resolve })
      return () => { gate = null; open() }
    },
    /** The public sources, when a test attaches a fake of them; otherwise any other URL throws. */
    web: null,
    async fetch(url, init) {
      if (!String(url).startsWith('https://api.deepseek.com/')) {
        if (api.web) return api.web(url, init)
        throw new Error(`a test without a fake web reached ${url}`)
      }
      const body = JSON.parse(init.body)
      const prompt = body.messages[0].content
      calls.push({ url, headers: init.headers, body, prompt, topic: /议题 (\S+)：/.exec(prompt)?.[1] ?? null })
      if (gate) await gate
      const plan = api.reply(calls.at(-1)) ?? {}
      if (plan.status) return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: plan.status })
      const usage = { input: 1000, cache: 0, output: 200, searches: 1, fetches: 0, ...plan.usage }
      const events = [{ type: 'message_start', message: { usage: { input_tokens: usage.input, cache_read_input_tokens: usage.cache, output_tokens: 0 } } }]
      let index = 0
      // `noTools`: the model answers from memory, without searching or opening anything.
      if (plan.noTools) usage.searches = 0
      else {
        events.push({ type: 'content_block_start', index: index++, content_block: { type: 'server_tool_use', id: 'u1', name: 'deepseek_web_search', input: { action: 'search', queries: plan.queries ?? ['q'] } } })
        events.push({ type: 'content_block_start', index: index++, content_block: { type: 'web_search_tool_result', tool_use_id: 'u1', content: (plan.results ?? []).map(link => ({ type: 'web_search_result', url: link, title: `title of ${link}`, page_age: '2026-11-10', site_name: 'site' })) } })
      }
      for (const link of plan.opened ?? []) {
        events.push({ type: 'content_block_start', index: index++, content_block: { type: 'server_tool_use', id: `o${index}`, name: 'deepseek_web_search', input: { action: 'open_page', url: link } } })
        events.push({ type: 'content_block_start', index: index++, content_block: { type: 'web_fetch_tool_result', content: { url: link, content: { title: `page ${link}` }, published_at: '2026-11-09' } } })
      }
      const text = plan.text ?? `研究过程的说明。\n\n\`\`\`json\n${JSON.stringify(plan.answer ?? {})}\n\`\`\`\n`
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
      events.push({ type: 'content_block_stop', index })
      events.push({ type: 'message_delta', delta: { stop_reason: plan.stop ?? 'end_turn' }, usage: { output_tokens: usage.output, server_tool_use: { tool_search: usage.searches, tool_fetch: usage.fetches } } })
      events.push({ type: 'message_stop' })
      return new Response(sse(events), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    },
  }
  return api
}

const deepseek = makeDeepSeek()
const hooks = {}
/** Bundle config for a test apply: always the fake key and the fake DeepSeek. */
const config = (extra = {}) => ({ database: file, apiKey: 'test-key', fetch: deepseek.fetch, startDelayMs: 0, sourceDelayMs: 0, hooks, ...extra })

const settle = () => new Promise(resolve => setTimeout(resolve, 30))
/** Let a started pass reach DeepSeek: it gathers its material first, without timers in tests. */
const callsReach = async count => {
  for (let i = 0; i < 100 && deepseek.calls.length < count; i += 1) await new Promise(resolve => setImmediate(resolve))
}
let host = makeHost()
apply(host.ctx, config())
await settle()

// ---------------------------------------------------------------- registration
assert.equal(host.routes.length, 1)
assert.equal(host.routes[0].path, '/api/thesis-trail')
// dsh sends only GET and HEAD to a `resource` route; writes need a handler.
assert.equal(typeof host.routes[0].handler, 'function')
assert.equal(host.routes[0].resource, undefined)
assert.deepEqual([...host.tools.keys()], ['trail_brief', 'trail_timeline', 'trail_record'])
for (const [name, def] of host.tools) {
  assert.equal(def.parameters?.type, 'object', `${name}: parameters must be an object-rooted JSON Schema`)
}
console.log('registration: ok')

// ---------------------------------------------------------------- helpers
const route = host.routes[0]
// Calls go through the route's Node-style handler, exactly as dsh's web server does.
async function callRoute(route, method, path, rawBody) {
  const payload = rawBody === undefined ? [] : [Buffer.from(rawBody)]
  const req = {
    method,
    url: `/api/thesis-trail${path}`,
    headers: rawBody === undefined ? {} : { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield* payload },
  }
  let done
  const finished = new Promise(resolve => { done = resolve })
  const res = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value }, end(chunk) { done(chunk) } }
  await route.handler(req, res)
  const text = String(await finished ?? '')
  return { status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }
}
/**
 * The reader imports the fixture board into a fresh store. Imported text is the
 * reader's, so the AI may only suggest changes to it; most tests here want
 * topics nobody has claimed yet, as older stores seeded them, so the create
 * entries are dropped unless `keepAuthor`.
 */
async function importFixture(route, dbFile, { keepAuthor = false } = {}) {
  const res = await callRoute(route, 'POST', '/board/import', JSON.stringify({ markdown: FIXTURE }))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  if (!keepAuthor) {
    const db = new DatabaseSync(dbFile)
    db.exec("DELETE FROM topic_log WHERE kind = 'create'")
    db.close()
  }
  return res.body
}
const http = (method, path, body) => callRoute(route, method, path, body === undefined ? undefined : JSON.stringify(body))
const tool = (name, args) => host.tools.get(name).execute(args)
const record = args => tool('trail_record', args)
const IMPORTANCE_NAMES = ['high', 'medium', 'low']
const topicOf = async id => (await http('GET', '/state')).body.topics.find(topic => topic.id === id)

await importFixture(route, file)

// ---------------------------------------------------------------- schedule
{
  const schedule = (await http('GET', '/schedule')).body
  assert.equal(schedule.cadence, 'daily', 'a new board passes daily')
  assert.equal(schedule.time, '08:30')
  assert.ok(Date.parse(schedule.next) > Date.now())
  assert.equal(host.tasks.length, 0, 'the plugin keeps its own schedule, no dsh task')
  assert.equal(deepseek.calls.length, 0, 'starting up does not research: the latest pass time counts as done')
  // A pass run by hand in a chat still gets its steps from the brief.
  const guide = host.tools.get('trail_brief').execute({ board: 'acme', pass: true }).instructions
  assert.equal(typeof guide, 'string')
  assert.match(guide, /board: "acme"/)
  assert.match(guide, /due 为 true/, 'the steps work only on due topics')
  assert.match(guide, /importance/, 'the steps say how deep each importance goes')
  assert.match(guide, /new_inbox/, 'the steps tell the agent to answer comments left during a pass')
  assert.match(guide, /today/, 'the steps point the agent at today\'s date')
  assert.match(guide, /不要说「改了」/, 'the steps say a proposal is not a change')
  assert.equal(host.tools.get('trail_brief').execute({ board: 'acme' }).instructions, undefined, 'an ordinary brief has no steps')
  console.log('schedule: ok')
}

// Every topic starts not due, so due-marking is observable.
{
  const db = new DatabaseSync(file)
  db.exec("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z'")
  db.close()
}

// ---------------------------------------------------------------- reader edits
const t1 = await topicOf('t1')
const newFalsifier = '续约率低于 92%，或任一前十大客户终止合同。'
let res = await http('POST', '/topic/edit', {
  topic: 't1', changes: { falsifier: newFalsifier }, base: { falsifier: t1.falsifier }, note: '把门槛收紧到 92%',
})
assert.equal(res.status, 200, JSON.stringify(res.body))
assert.deepEqual(res.body.changed, ['falsifier'])
assert.equal((await topicOf('t1')).next_due_at, null, 'a reader edit makes the topic due')
assert.equal((await topicOf('t1')).waiting_agent, 1)

res = await http('POST', '/topic/edit', { topic: 't1', changes: { falsifier: 'x' }, base: { falsifier: t1.falsifier } })
assert.equal(res.status, 409, 'a form opened before the last change conflicts')
assert.equal(res.body.error, 'changed_since_opened')
assert.equal(res.body.current.falsifier, newFalsifier)

res = await http('POST', '/topic/edit', { topic: 't1', changes: { thesis: '' } })
assert.equal(res.status, 400, 'required fields cannot be emptied')
res = await http('POST', '/topic/edit', { topic: 't1', changes: { status: 'merged' } })
assert.equal(res.status, 400, 'the reader cannot pick an agent-only status')
res = await http('GET', '/topic/edit')
assert.equal(res.status, 405)
console.log('reader edit: ok')

// ---------------------------------------------------------------- brief shows the inbox
let brief = tool('trail_brief', {})
assert.match(brief.today, /^\d{4}-\d{2}-\d{2}$/, 'the brief carries today\'s date')
assert.equal(brief.inbox.length, 1)
assert.equal(brief.inbox[0].changes.falsifier.to, newFalsifier)
assert.equal(brief.inbox[0].note, '把门槛收紧到 92%')
const t1Brief = brief.topics.find(topic => topic.id === 't1')
assert.deepEqual(t1Brief.human_fields, ['falsifier'])
const readerEditId = brief.inbox[0].log_id
console.log('brief inbox: ok')

// ---------------------------------------------------------------- agent edits: apply vs propose
res = record({ action: 'topic_update', topic_id: 't1', falsifier: '续约率低于 88%', metric: '续约率、合同条款' })
assert.equal(res.ok, false)
assert.equal(res.code, 'topic_update_needs_reason')

res = record({ action: 'topic_update', topic_id: 't1', falsifier: '续约率低于 88%', metric: '续约率、合同条款', reason: '管理层口径是 88%' })
assert.equal(res.ok, true, JSON.stringify(res))
assert.deepEqual(res.applied, ['metric'])
assert.deepEqual(res.proposed, ['falsifier'])
const agentEditId = res.log_id
const firstProposal = res.proposal_id
let current = await topicOf('t1')
assert.equal(current.falsifier, newFalsifier, 'the reader-owned field is untouched')
assert.equal(current.metric, '续约率、合同条款', 'an unowned field applies directly')
assert.equal(current.pending_proposals, 1)

// A second proposal on the same field replaces the first; nobody answered the
// first, so it is removed rather than kept as history.
res = record({ action: 'topic_update', topic_id: 't1', falsifier: '续约率低于 89%', reason: '再核对了一次' })
const secondProposal = res.proposal_id
let timeline = (await http('GET', '/timeline?topic=t1')).body
assert.equal(timeline.log.find(item => item.id === firstProposal), undefined)
assert.equal((await topicOf('t1')).pending_proposals, 1)
// The same proposal again is not added twice.
res = record({ action: 'topic_update', topic_id: 't1', falsifier: '续约率低于 89%', reason: '又核对了一次' })
assert.equal(res.proposal_id, secondProposal)
assert.deepEqual(res.already_pending, ['falsifier'])
assert.equal((await topicOf('t1')).pending_proposals, 1)
console.log('agent edit: ok')

// ---------------------------------------------------------------- reader decides
res = await http('POST', '/proposal/decide', { id: secondProposal, accept: true })
assert.equal(res.status, 200, JSON.stringify(res.body))
assert.equal((await topicOf('t1')).falsifier, '续约率低于 89%')
res = await http('POST', '/proposal/decide', { id: secondProposal, accept: false })
assert.equal(res.status, 409, 'a decided proposal cannot be decided again')

// Accepting makes the field the reader's again: the next change is a proposal too.
res = record({ action: 'topic_update', topic_id: 't1', falsifier: '续约率低于 80%', reason: '试探' })
assert.deepEqual(res.proposed, ['falsifier'])
res = await http('POST', '/proposal/decide', { id: res.proposal_id, accept: false, note: '80% 太松了' })
assert.equal(res.status, 200)
brief = tool('trail_brief', {})
const rejected = brief.topics.find(topic => topic.id === 't1').rejected_proposals
assert.equal(rejected.length, 1)
assert.equal(rejected[0].reader_note, '80% 太松了')
assert.ok(brief.inbox.some(item => item.kind === 'reject' && item.proposal?.reason === '试探'))
console.log('decisions: ok')

// ---------------------------------------------------------------- reader reverts an agent edit
res = await http('POST', '/log/revert', { id: agentEditId })
assert.equal(res.status, 200, JSON.stringify(res.body))
assert.equal((await topicOf('t1')).metric, t1.metric, 'the original value is back')
res = await http('POST', '/log/revert', { id: agentEditId })
assert.equal(res.status, 409, 'a revert cannot be applied twice')
timeline = (await http('GET', '/timeline?topic=t1')).body
assert.equal(timeline.log.find(item => item.id === agentEditId).state, 'reverted')
assert.equal(timeline.owners.metric.author, 'human')
console.log('revert: ok')

// ---------------------------------------------------------------- replies and run close
res = record({ action: 'reply', log_id: readerEditId, body: '已按 92% 的门槛核对最新披露。' })
assert.equal(res.ok, true, JSON.stringify(res))
res = record({ action: 'reply', log_id: agentEditId, body: 'x' })
assert.equal(res.code, 'reader_item_not_found', 'only reader items take a reply')

brief = tool('trail_brief', {})
const run = record({ action: 'run_start', mode: 'daily' })
// A note left after the brief was read must survive this pass's close.
res = await http('POST', '/topic/note', { topic: 't2', body: '下次重点看 NRR 的口径变化' })
assert.equal(res.status, 200)
const lateNote = res.body.log_id
res = record({ action: 'run_close', run_id: run.run_id, status: 'ok', summary: '只处理了 inbox', checked_topic_ids: ['t1'] })
assert.equal(res.ok, true, JSON.stringify(res))
assert.equal(res.new_inbox, 1, 'the close reports the note that arrived mid-pass')
assert.match(res.next, /trail_brief/)
assert.ok(res.closed_without_reply.length >= 1, 'items shown but not answered are reported')
timeline = (await http('GET', '/timeline?topic=t1')).body
assert.equal(timeline.log.find(item => item.id === readerEditId).state, 'answered')
assert.ok(timeline.log.filter(item => item.author === 'human' && item.kind !== 'edit').every(item => item.state !== 'open'))
const t2Log = (await http('GET', '/timeline?topic=t2')).body.log
assert.equal(t2Log.find(item => item.id === lateNote).state, 'open', 'a note from mid-pass waits for the next pass')
assert.equal((await topicOf('t2')).next_due_at, null, 'and keeps its topic due')
assert.notEqual((await topicOf('t1')).next_due_at, null)
console.log('reply and close: ok')

// ---------------------------------------------------------------- add topic, notes, counters
res = await http('POST', '/topic/add', { title: '新议题', thesis: '某件事会发生' })
assert.equal(res.status, 400, 'a topic needs a falsifier')
res = await http('POST', '/topic/add', { title: '新议题', thesis: '某件事会发生', falsifier: '某件事没有发生', note: '先放进来' })
assert.equal(res.status, 200, JSON.stringify(res.body))
const added = await topicOf(res.body.topic_id)
assert.equal(added.next_due_at, null)
assert.equal(added.waiting_agent, 1)
res = record({ action: 'note', topic_id: added.id, body: '这个命题的时间范围是多久？' })
assert.equal(res.ok, true)

let state = (await http('GET', '/state')).body
assert.ok(state.stats.waiting_agent >= 2)
let badge = (await http('GET', '/badge')).body
assert.ok(badge.agent > 0, 'agent activity shows on the badge')
await http('POST', '/seen')
badge = (await http('GET', '/badge')).body
assert.equal(badge.agent, 0)

res = await http('POST', '/topic/edit', { topic: added.id, changes: { status: 'paused' } })
assert.equal(res.status, 200)
res = record({ action: 'topic_update', topic_id: added.id, topic_status: 'active', reason: '有新消息' })
assert.deepEqual(res.proposed, ['status'], 'a reader pause is not undone by the agent')
console.log('topics and counters: ok')

// ---------------------------------------------------------------- anchored comments, threads, Ask AI
{
  const t4 = await topicOf('t4')
  const quote = t4.thesis.slice(0, 6)
  const callsBefore = deepseek.calls.length
  // Hold the research request, so the thread can be checked while it runs.
  const release = deepseek.hold()
  res = await http('POST', '/topic/note', {
    topic: 't4', body: '这句话的时间范围是多久？', anchor: { field: 'thesis', quote, start: 0 }, ask_ai: true,
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const rootId = res.body.log_id
  assert.equal(res.body.thread_id, rootId, 'a new comment starts its own thread')
  assert.equal(res.body.run?.ok, true, 'Ask AI researches the topic at once')
  assert.equal(res.body.run.queued, false)
  // The pass gathers primary material first (here every source fails at once), then calls DeepSeek.
  await callsReach(callsBefore + 1)
  assert.equal(deepseek.calls.length, callsBefore + 1)
  const askCall = deepseek.calls.at(-1)
  assert.equal(askCall.topic, 't4', 'only the asked topic is researched')
  assert.match(askCall.prompt, /这句话的时间范围是多久？/)
  assert.match(askCall.prompt, new RegExp(`\\[log ${rootId}\\]`))
  assert.equal(askCall.url, 'https://api.deepseek.com/anthropic/v1/messages')
  assert.equal(askCall.headers['x-api-key'], 'test-key')
  assert.equal(askCall.body.model, 'deepseek-flash')
  assert.deepEqual(askCall.body.tools, [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }])
  assert.equal(askCall.body.thinking.type, 'disabled', 'a medium topic gets a plain search')
  assert.equal((await http('GET', '/state')).body.research.running, true)

  // A comment without Ask AI waits for the scheduled pass.
  res = await http('POST', '/topic/note', { topic: 't4', body: '不急，下次一起看', anchor: { field: 'nope', quote: 'x' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.run, undefined)
  assert.equal(deepseek.calls.length, callsBefore + 1)
  const plainId = res.body.log_id

  let log = (await http('GET', '/timeline?topic=t4')).body.log
  const root = log.find(item => item.id === rootId)
  assert.deepEqual(root.anchor, { field: 'thesis', quote, start: 0 })
  assert.equal(root.ask_ai, true)
  assert.equal(log.find(item => item.id === plainId).anchor, null, 'an anchor on an unknown field is dropped')
  assert.equal((await http('GET', '/state')).body.stats.asked_ai, 1)

  brief = tool('trail_brief', {})
  const asked = brief.inbox.find(item => item.log_id === rootId)
  assert.equal(asked.ask_ai, true)
  assert.equal(asked.anchor.field, 'thesis')

  // The AI answers; the reader follows up on the answer.
  res = record({ action: 'reply', log_id: rootId, body: '两年。' })
  assert.equal(res.ok, true, JSON.stringify(res))
  const aiReplyId = res.log_id
  res = await http('POST', '/topic/note', { topic: 't4', body: '为什么是两年？', reply_to: aiReplyId })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.thread_id, rootId, 'a reply joins the thread of the message it answers')
  const followId = res.body.log_id
  res = await http('POST', '/topic/note', { topic: 't4', body: 'x', reply_to: 999999 })
  assert.equal(res.status, 404)

  brief = tool('trail_brief', {})
  const follow = brief.inbox.find(item => item.log_id === followId)
  assert.equal(follow.kind, 'reply')
  assert.deepEqual(follow.thread.map(item => item.log_id), [rootId, aiReplyId], 'the follow-up carries the conversation so far')
  assert.equal(follow.thread[0].anchor.quote, quote)

  // Resolving withdraws what is still waiting; replying reopens.
  res = await http('POST', '/thread/resolve', { id: followId, resolved: true })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.thread_id, rootId)
  assert.equal(res.body.withdrawn, 1)
  log = (await http('GET', '/timeline?topic=t4')).body.log
  assert.ok(log.find(item => item.id === rootId).resolved_at)
  assert.equal(log.find(item => item.id === followId).state, 'withdrawn')
  assert.ok(!tool('trail_brief', {}).inbox.some(item => item.log_id === followId), 'a withdrawn comment leaves the inbox')

  res = await http('POST', '/topic/note', { topic: 't4', body: '还有一个问题', reply_to: rootId })
  assert.equal(res.status, 200)
  log = (await http('GET', '/timeline?topic=t4')).body.log
  assert.equal(log.find(item => item.id === rootId).resolved_at, null, 'a reply reopens a resolved thread')

  res = await http('POST', '/thread/resolve', { id: rootId, resolved: true })
  res = await http('POST', '/thread/resolve', { id: rootId, resolved: false })
  assert.equal(res.status, 200)
  assert.equal(res.body.withdrawn, 0)
  log = (await http('GET', '/timeline?topic=t4')).body.log
  assert.equal(log.find(item => item.id === rootId).resolved_at, null)
  assert.equal((await http('POST', '/thread/resolve', { id: 999999 })).status, 404)

  // The AI can point a note at a passage too.
  res = record({ action: 'note', topic_id: 't4', body: '这里的口径需要你定', field: 'bear_case', quote: '口径' })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.anchored, 'bear_case')
  log = (await http('GET', '/timeline?topic=t4')).body.log
  assert.equal(log.find(item => item.id === res.log_id).anchor.field, 'bear_case')
  res = record({ action: 'note', topic_id: 't4', body: '没有锚点', field: 'zzz', quote: 'x' })
  assert.equal(res.ok, true)
  assert.equal(res.anchored, undefined)

  // Ask AI while the first request still runs: it waits, then runs after it.
  res = await http('POST', '/topic/note', { topic: 't4', body: '等这轮结束再看', ask_ai: true })
  assert.equal(res.status, 200)
  assert.equal(res.body.run.ok, true)
  assert.equal(res.body.run.queued, true)
  assert.equal(deepseek.calls.length, callsBefore + 1, 'one pass per board at a time')
  // The fake answers every reader item named in the prompt, plus one it was never shown.
  deepseek.reply = request => ({
    answer: {
      summary: '回答了评论',
      evidence: [],
      stance: null,
      replies: [...request.prompt.matchAll(/\[log (\d+)\] 读者(?:评论|追问)/g)]
        .map(match => ({ log_id: Number(match[1]), body: `回复 ${match[1]}` }))
        .concat([{ log_id: 999999, body: '不存在的条目' }]),
    },
  })
  release()
  await hooks.settled('acme')
  assert.equal(deepseek.calls.length, callsBefore + 2, 'the queued request ran after the first')
  assert.match(deepseek.calls.at(-1).prompt, /等这轮结束再看/)
  log = (await http('GET', '/timeline?topic=t4')).body.log
  const replies = log.filter(item => item.author === 'agent' && item.kind === 'reply')
  assert.ok(replies.some(item => item.ref_id === rootId && item.body === `回复 ${rootId}`), 'the research answered the comment')
  assert.ok(!replies.some(item => item.body === '不存在的条目'), 'a reply to an item the request was not shown is dropped')
  const after = (await http('GET', '/state')).body
  assert.equal(after.stats.asked_ai, 0, 'every Ask AI comment got its answer')
  assert.equal(after.research.running, false)
  assert.equal(after.research.error, null)
  const t4Research = (await http('GET', '/timeline?topic=t4')).body.research
  assert.equal(t4Research.length, 2)
  assert.equal(t4Research[0].mode, 'search')
  console.log('comments and threads: ok')
}

// ---------------------------------------------------------------- stale evidence
{
  const run = record({ action: 'run_start', mode: 'daily' })
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  res = record({ action: 'evidence', run_id: run.run_id, topic_ids: ['t5'], kind: 'filing', title: '一年前的季报', url: 'https://example.com/old-10q', published_at: old, summary: 'x', direction: 0 })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.match(res.warning, /published 4\d\d days ago/, 'an old source is flagged')
  res = record({ action: 'evidence', run_id: run.run_id, topic_ids: ['t5'], kind: 'filing', title: '上周的季报', url: 'https://example.com/new-10q', published_at: new Date(Date.now() - 7 * 86400000).toISOString(), summary: 'y', direction: 0 })
  assert.equal(res.warning, undefined, 'a recent source is not')
  record({ action: 'run_close', run_id: run.run_id, status: 'ok', summary: 'stale check', checked_topic_ids: ['t5'] })
  console.log('stale evidence: ok')
}

// ---------------------------------------------------------------- restore a version
{
  const original = await topicOf('t3')
  res = await http('POST', '/topic/edit', { topic: 't3', changes: { thesis: '版本 A' } })
  const versionA = res.body.log_id
  res = record({ action: 'topic_update', topic_id: 't3', metric: 'AI 加的指标', reason: '补指标' })
  assert.deepEqual(res.applied, ['metric'])
  const aiMetric = res.log_id
  res = await http('POST', '/topic/edit', { topic: 't3', changes: { thesis: '版本 B' } })
  res = record({ action: 'topic_update', topic_id: 't3', thesis: 'AI 想要的命题', reason: '更可证伪' })
  const proposalId = res.proposal_id
  assert.ok(proposalId)

  res = await http('POST', '/topic/restore', { topic: 't3', log_id: versionA, note: '回到 A' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(res.body.changed.sort(), ['metric', 'thesis'])
  let current = await topicOf('t3')
  assert.equal(current.thesis, '版本 A')
  assert.equal(current.metric, original.metric, 'a later AI edit is rolled back too')
  let log = (await http('GET', '/timeline?topic=t3')).body.log
  assert.equal(log.find(item => item.id === aiMetric).state, 'reverted')
  assert.equal(log.find(item => item.id === proposalId).state, 'superseded', 'a pending proposal on a restored field is dropped')
  const restoreRow = log.find(item => item.id === res.body.log_id)
  assert.equal(restoreRow.author, 'human')
  assert.equal(restoreRow.body, '回到 A')

  res = await http('POST', '/topic/restore', { topic: 't3', log_id: versionA })
  assert.equal(res.status, 409)
  assert.equal(res.body.error, 'already_current')

  // log_id 0 is the topic as it was before any logged change.
  res = await http('POST', '/topic/restore', { topic: 't3', log_id: 0 })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  current = await topicOf('t3')
  assert.equal(current.thesis, original.thesis)
  assert.equal(current.metric, original.metric)

  // A restore is itself a version: going back to "A" works after it.
  res = await http('POST', '/topic/restore', { topic: 't3', log_id: versionA })
  assert.equal(res.status, 200)
  assert.equal((await topicOf('t3')).thesis, '版本 A')

  assert.equal((await http('POST', '/topic/restore', { topic: 't3', log_id: 999999 })).status, 404)
  assert.equal((await http('POST', '/topic/restore', { topic: 'nope', log_id: 0 })).status, 404)
  console.log('restore: ok')
}

assert.equal((await http('GET', '/zzz')).status, 404)
res = await callRoute(route, 'POST', '/topic/note', JSON.stringify({ topic: 't1', body: 'x'.repeat(1024 * 1024 + 10) }))
assert.equal(res.status, 413, 'an oversized body is refused')
res = await callRoute(route, 'POST', '/topic/note', '{not json')
assert.equal(res.status, 404, 'a malformed body reads as empty: no topic named, no crash')
assert.equal(res.body.error, 'topic_not_found')
assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
assert.equal((await http('GET', '/state?board=nope')).status, 404)

// ---------------------------------------------------------------- brief: due flag, slim topics
{
  const brief = tool('trail_brief', {})
  assert.ok(brief.topics.every(topic => typeof topic.due === 'boolean'))
  const paused = brief.topics.find(topic => topic.status === 'paused')
  assert.ok(paused, 'the test board has a paused topic')
  assert.equal(paused.due, false, 'a paused topic is never due, even with no due time')
  const idle = brief.topics.find(topic => !topic.due && !brief.inbox.some(item => item.topic_id === topic.id))
  assert.ok(idle, 'some topic is neither due nor in the inbox')
  assert.ok(idle.thesis, 'an idle topic keeps its thesis for linking evidence')
  assert.equal(idle.history, undefined, 'but not its history')
  assert.equal(idle.human_fields, undefined)
  const busy = brief.topics.find(topic => topic.due)
  assert.ok(Array.isArray(busy.history) && Array.isArray(busy.human_fields), 'a due topic comes in full')
  const state = (await http('GET', '/state')).body
  assert.equal(state.stats.due, state.topics.filter(topic => topic.due).length)
  console.log('brief due: ok')
}

// ---------------------------------------------------------------- importance
{
  const sql = (query, ...params) => { const db = new DatabaseSync(file); const out = db.prepare(query).all(...params); db.close(); return out }
  let state = (await http('GET', '/state')).body
  assert.ok(state.topics.every(topic => topic.importance === 'medium'), 'every existing topic starts at medium')

  // Raising importance moves the next check closer, counted from the last check.
  sql("UPDATE topic SET status = 'active', checked_at = '2026-01-01T00:00:00.000Z', next_due_at = '2026-01-07T12:00:00.000Z' WHERE id = 't3'")
  const waitingBefore = state.stats.waiting_agent
  res = await http('POST', '/topic/edit', { topic: 't3', changes: { importance: 'high' }, base: { importance: 'medium' } })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  let t3 = await topicOf('t3')
  assert.equal(t3.importance, 'high')
  assert.equal(t3.next_due_at, '2026-01-01T12:00:00.000Z', 'high: one day after the last check, less the slack')
  state = (await http('GET', '/state')).body
  assert.equal(state.stats.waiting_agent, waitingBefore, 'an importance change asks nothing of the AI')
  const t3Log = (await http('GET', '/timeline?topic=t3')).body.log
  const change = t3Log.find(item => item.changes?.importance)
  assert.equal(change.state, 'seen')
  assert.deepEqual(change.changes.importance, { from: 'medium', to: 'high' })
  assert.ok(!tool('trail_brief', {}).inbox.some(item => item.log_id === change.id), 'and it is not in the inbox')
  // A forced-due topic (a reader item waits) stays due when importance changes.
  sql("UPDATE topic SET status = 'active', checked_at = '2026-01-01T00:00:00.000Z', next_due_at = NULL WHERE id = 't4'")
  res = await http('POST', '/topic/edit', { topic: 't4', changes: { importance: 'low' } })
  assert.equal(res.status, 200)
  assert.equal((await topicOf('t4')).next_due_at, null)
  res = await http('POST', '/topic/edit', { topic: 't4', changes: { importance: 'urgent' } })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'invalid_importance')

  // The list puts high first and low last.
  state = (await http('GET', '/state')).body
  assert.equal(state.topics[0].id, 't3')
  assert.equal(state.topics.at(-1).id, 't4')

  // Only the reader sets importance: the AI's update ignores it, its new topics start at medium.
  res = record({ action: 'topic_update', topic_id: 't3', importance: 'low', reason: '不重要' })
  assert.equal(res.ok, false)
  assert.equal((await topicOf('t3')).importance, 'high')
  res = await http('POST', '/topic/add', { title: '低优先', thesis: '某事', falsifier: '某事没发生', importance: 'low' })
  assert.equal((await topicOf(res.body.topic_id)).importance, 'low')
  res = record({ action: 'topic_add', title: 'AI 议题', thesis: '某事', falsifier: '没发生', importance: 'high', reason: '新线索' })
  assert.equal((await topicOf(res.topic_id)).importance, 'medium')

  // The brief carries importance on full and slim topics; the prompt says what it means.
  const brief = tool('trail_brief', {})
  assert.ok(brief.topics.every(topic => IMPORTANCE_NAMES.includes(topic.importance)))

  // Closing a pass: each checked topic comes back after its own interval from the pass start.
  sql("UPDATE topic SET status = 'active', next_due_at = NULL WHERE id IN ('t3', 't4', 't5', 't6')")
  sql("UPDATE topic SET importance = 'medium' WHERE id IN ('t5', 't6')")
  const pass = record({ action: 'run_start', mode: 'daily' })
  assert.ok(pass.run_id, JSON.stringify(pass))
  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  res = record({ action: 'topic_update', run_id: pass.run_id, topic_id: 't5', next_due_at: soon, reason: '财报后再看' })
  assert.equal(res.ok, true, JSON.stringify(res))
  res = record({ action: 'run_close', run_id: pass.run_id, status: 'ok', summary: '按重要性', checked_topic_ids: ['t3', 't4', 't5'] })
  assert.equal(res.ok, true, JSON.stringify(res))
  const started = sql('SELECT started_at FROM run WHERE id = ?', pass.run_id)[0].started_at
  const after = ms => new Date(Date.parse(started) + ms).toISOString()
  const hour = 60 * 60 * 1000
  const topicRow = id => sql('SELECT next_due_at, checked_at FROM topic WHERE id = ?', id)[0]
  assert.equal(topicRow('t3').next_due_at, after(24 * hour - 12 * hour), 'high: due by the next daily pass')
  assert.equal(topicRow('t4').next_due_at, after(30 * 24 * hour - 12 * hour), 'low: a month')
  assert.equal(topicRow('t5').next_due_at, soon, 'an earlier due time the AI set in this pass wins')
  assert.equal(topicRow('t3').checked_at, started)
  assert.equal(topicRow('t6').next_due_at, null, 'a due topic the pass skipped stays due')
  assert.equal(topicRow('t6').checked_at, null)

  // Only a flip on a high-importance topic raises the red dot; others join the number.
  await http('POST', '/seen')
  const flipRun = record({ action: 'run_start', mode: 'daily' })
  for (const [id, a, b] of [['t3', 0.6, -0.6], ['t5', 0.6, -0.6], ['t5', -0.6, 0.6]]) {
    record({ action: 'assess', topic_id: id, run_id: flipRun.run_id, stance: a, rationale: '前' })
    record({ action: 'assess', topic_id: id, run_id: flipRun.run_id, stance: b, rationale: '后' })
  }
  record({ action: 'run_close', run_id: flipRun.run_id, status: 'ok', summary: '翻转', checked_topic_ids: [] })
  const flips = sql("SELECT a.topic_id, COUNT(*) AS n FROM assessment a WHERE a.run_id = ? AND a.flipped = 1 GROUP BY a.topic_id", flipRun.run_id)
  const highFlips = flips.filter(row => row.topic_id === 't3').reduce((sum, row) => sum + row.n, 0)
  const otherFlips = flips.filter(row => row.topic_id !== 't3').reduce((sum, row) => sum + row.n, 0)
  assert.ok(highFlips > 0 && otherFlips > 0, JSON.stringify(flips))
  const dot = (await http('GET', '/badge?board=acme')).body
  assert.equal(dot.flipped, highFlips)
  assert.equal(dot.flipped_other, otherFlips)
  const all = (await http('GET', '/badge')).body
  assert.ok(all.flipped_other >= otherFlips, 'the sidebar total carries the other flips too')
  await http('POST', '/seen')
  console.log('importance: ok')
}

// ---------------------------------------------------------------- cadence
{
  res = await http('POST', '/schedule', { cadence: 'weekly', weekdays: [5, 1, 3, 3], time: '07:45' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.cadence, 'weekly')
  assert.deepEqual(res.body.weekdays, [1, 3, 5])
  assert.equal(res.body.time, '07:45')
  res = await http('POST', '/schedule', { cadence: 'paused' })
  assert.equal(res.body.cadence, 'paused')
  assert.equal(res.body.active, false)
  assert.equal(res.body.next, null)
  assert.deepEqual(res.body.weekdays, [1, 3, 5], 'pausing keeps the days')
  res = await http('POST', '/schedule', { time: '06:00' })
  assert.equal(res.body.cadence, 'paused', 'changing the time does not resume')
  res = await http('POST', '/schedule', { cadence: 'weekly' })
  assert.equal(res.body.active, true)
  assert.deepEqual(res.body.weekdays, [1, 3, 5], 'resuming brings the same days back')
  assert.equal(res.body.time.slice(0, 5), '06:00')
  res = await http('POST', '/schedule', { cadence: 'daily', time: '08:30' })
  assert.equal(res.body.cadence, 'daily')
  assert.deepEqual(res.body.weekdays, [])
  assert.equal((await http('POST', '/schedule', { time: '25:00' })).status, 400)
  assert.equal((await http('POST', '/schedule', { cadence: 'weekly', weekdays: [] })).status, 400)
  assert.equal(host.tasks.length, 0, 'a cadence change touches no dsh task')
  console.log('cadence: ok')
}

// ---------------------------------------------------------------- boards
{
  res = await http('POST', '/board/add', { title: 'NVIDIA (NVDA)', note: 'AI 算力', cadence: 'weekly', weekdays: [1], time: '09:00' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.board, 'nvda', 'a ticker in parentheses becomes the id')
  assert.equal(res.body.schedule.cadence, 'weekly')
  assert.deepEqual(res.body.schedule.weekdays, [1])
  assert.equal(res.body.schedule.time, '09:00')
  assert.equal(host.tasks.length, 0, 'a board creates no dsh task')
  res = await http('POST', '/board/add', { title: 'NVIDIA (NVDA)', cadence: 'paused' })
  assert.equal(res.body.board, 'nvda-2', 'ids stay unique')
  assert.equal(res.body.schedule.cadence, 'paused')
  assert.equal((await http('POST', '/board/add', { title: '  ' })).status, 400)

  let boards = (await http('GET', '/boards')).body.boards
  assert.deepEqual(boards.map(board => board.id), ['acme', 'nvda', 'nvda-2'])
  assert.equal(boards.find(board => board.id === 'nvda-2').schedule.active, false)

  res = await http('POST', '/topic/add?board=nvda', { title: '数据中心收入', thesis: '会继续增长', falsifier: '连续两个季度环比下滑' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.topic_id, 'nvda-t1', 'topic ids on other boards carry the board id')

  // With several boards, a call that names none and points at nothing must ask.
  let out = tool('trail_brief', {})
  assert.equal(out.ok, false)
  assert.equal(out.code, 'board_required')
  assert.deepEqual(out.boards.map(board => board.id), ['acme', 'nvda', 'nvda-2'])
  out = tool('trail_brief', { board: 'nvda' })
  assert.deepEqual(out.topics.map(topic => topic.id), ['nvda-t1'])
  assert.equal(record({ action: 'run_start', mode: 'daily' }).code, 'board_required')
  assert.equal(record({ action: 'run_start', board: 'zzz' }).code, 'board_not_found')
  const nvdaRun = record({ action: 'run_start', mode: 'daily', board: 'nvda' })
  assert.equal(nvdaRun.ok, true)
  // Later calls can leave the board out: the run or topic decides.
  out = record({ action: 'evidence', run_id: nvdaRun.run_id, topic_ids: ['nvda-t1'], kind: 'filing', title: 'Q3 10-Q', url: 'https://example.com/nvda-10q', published_at: new Date().toISOString(), summary: 'x', direction: 1 })
  assert.equal(out.ok, true, JSON.stringify(out))
  out = record({ action: 'assess', topic_id: 'nvda-t1', run_id: nvdaRun.run_id, stance: 0.5, rationale: '增长仍在' })
  assert.equal(out.ok, true)
  const nvdaNote = (await http('POST', '/topic/note?board=nvda', { topic: 'nvda-t1', body: '看一下毛利' })).body.log_id
  out = record({ action: 'reply', log_id: nvdaNote, body: '毛利 75%' })
  assert.equal(out.ok, true, 'a reply finds its board from the log id')
  out = record({ action: 'run_close', run_id: nvdaRun.run_id, status: 'ok', summary: 'nvda', checked_topic_ids: ['nvda-t1'] })
  assert.equal(out.ok, true)
  const nvdaState = (await http('GET', '/state?board=nvda')).body
  assert.equal(nvdaState.stats.runs, 1)
  assert.equal(nvdaState.topics[0].evidence_count, 1)
  assert.equal((await http('GET', '/state')).body.topics.some(topic => topic.id === 'nvda-t1'), false, 'boards do not leak')
  assert.equal(tool('trail_timeline', { topic: 'nvda-t1' }).board, 'nvda', 'the timeline finds the board from the topic')

  // Ask AI researches that board's topic, not the first board's.
  const callsBefore = deepseek.calls.length
  res = await http('POST', '/topic/note?board=nvda', { topic: 'nvda-t1', body: '现在查一下', ask_ai: true })
  assert.equal(res.body.run.ok, true)
  await hooks.settled('nvda')
  assert.deepEqual(deepseek.calls.slice(callsBefore).map(call => call.topic), ['nvda-t1'])
  assert.match(deepseek.calls.at(-1).prompt, /NVIDIA \(NVDA\)/)
  // A board with nothing due says so instead of sending a request.
  res = await http('POST', '/run-now?board=nvda-2')
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'nothing_due')
  assert.equal(deepseek.calls.length, callsBefore + 1)
  assert.equal((await http('POST', '/run-now?board=zzz')).status, 404)

  res = await http('POST', '/board/edit?board=nvda', { title: 'NVIDIA', note: 'AI 算力龙头' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  boards = (await http('GET', '/boards')).body.boards
  assert.equal(boards.find(board => board.id === 'nvda').title, 'NVIDIA')

  // The sidebar badge counts every board; a board query counts one.
  const all = (await http('GET', '/badge')).body
  const one = (await http('GET', '/badge?board=nvda')).body
  assert.ok(all.unread >= one.unread && one.unread >= 1)
  console.log('boards: ok')
}

// ---------------------------------------------------------------- research
{
  const write = (query, ...params) => { const db = new DatabaseSync(file); db.prepare(query).run(...params); db.close() }
  const read = (query, ...params) => { const db = new DatabaseSync(file, { readOnly: true }); const rows = db.prepare(query).all(...params); db.close(); return rows }
  const evidenceOf = id => read('SELECT e.url FROM evidence e JOIN evidence_topic et ON et.evidence_id = e.id WHERE et.topic_id = ? ORDER BY e.id', id).map(row => row.url)
  // Only t1 (high), t2 (medium) and t3 (low) are due, and no reader item is open.
  write("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z' WHERE board_id = 'acme'")
  write("UPDATE topic_log SET state = 'seen' WHERE board_id = 'acme' AND author = 'human' AND state = 'open'")
  write("UPDATE topic SET status = 'active', importance = 'high', next_due_at = NULL WHERE id = 't1'")
  write("UPDATE topic SET status = 'active', importance = 'medium', next_due_at = NULL WHERE id = 't2'")
  write("UPDATE topic SET status = 'active', importance = 'low', next_due_at = NULL WHERE id = 't3'")
  const t2Before = evidenceOf('t2').length
  const t1Falsifier = (await topicOf('t1')).falsifier
  const later = new Date(Date.now() + 3 * 86400000)
  const nextCheck = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`
  deepseek.reply = request => {
    if (request.topic === 't1') {
      return {
        results: ['https://www.sec.gov/t1-10q', 'https://news.example.com/t1?utm_source=feed'],
        opened: ['https://www.sec.gov/t1-10q'],
        usage: { input: 40000, cache: 400000, output: 9000, searches: 19, fetches: 4 },
        answer: {
          summary: 't1 读了 10-Q',
          evidence: [
            { title: '10-Q', url: 'https://www.sec.gov/t1-10q', published_at: '2026-11-05', direction: 1, kind: 'filing', summary: '收入增长' },
            { title: '新闻', url: 'https://news.example.com/t1', direction: -1, kind: 'news', summary: '有人质疑', also_topics: ['t2', 'nvda-t1', 'zzz'] },
            { title: '编的', url: 'https://made-up.example.com/x', direction: 1, kind: 'news', summary: '没打开过' },
          ],
          stance: 0.6,
          confidence: 0.7,
          rationale: '10-Q 支持命题',
          replies: [],
          edits: [{ field: 'falsifier', value: '新的证伪条件', reason: '10-Q 口径变了' }, { field: 'status', value: 'closed' }],
          question: '要不要把海外收入单列？',
          next_check: null,
        },
      }
    }
    if (request.topic === 't2') return { status: 429 }
    return { answer: { summary: '没有重大事件', evidence: [], stance: null, next_check: nextCheck } }
  }
  const before = deepseek.calls.length
  res = await http('POST', '/run-now')
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.ok, true)
  await hooks.settled('acme')
  const calls = deepseek.calls.slice(before)
  assert.deepEqual(calls.map(call => call.topic), ['t1', 't2', 't3'], 'due topics only, high importance first')
  const byTopic = Object.fromEntries(calls.map(call => [call.topic, call]))
  assert.equal(byTopic.t1.body.thinking.type, 'enabled', 'high importance: deep thinking search')
  assert.equal(byTopic.t1.body.max_tokens, 16000)
  assert.match(byTopic.t1.prompt, /至少核对三个独立来源/)
  assert.equal(byTopic.t2.body.thinking.type, 'disabled', 'medium: plain search')
  assert.equal(byTopic.t3.body.thinking.type, 'disabled')
  assert.equal(byTopic.t3.body.max_tokens, 3000)
  assert.match(byTopic.t3.prompt, /只查/, 'low importance only checks for major events')

  // t1: only links the service returned or opened become evidence.
  const t1Evidence = evidenceOf('t1')
  assert.ok(t1Evidence.includes('https://www.sec.gov/t1-10q'))
  assert.ok(t1Evidence.includes('https://news.example.com/t1'), 'a tracking parameter does not hide a seen link')
  assert.ok(!t1Evidence.includes('https://made-up.example.com/x'), 'a link the model never saw is dropped')
  assert.equal(evidenceOf('t2').length, t2Before + 1, 'also_topics links the fact to another topic on the board')
  assert.ok(!evidenceOf('nvda-t1').includes('https://news.example.com/t1'), 'but never to a topic on another board')
  const filing = read("SELECT * FROM evidence WHERE url = 'https://www.sec.gov/t1-10q'")[0]
  assert.equal(filing.kind, 'filing')
  assert.equal(filing.direction, 1)
  assert.equal(filing.published_at, '2026-11-05')
  assert.equal(filing.source, 'sec.gov', 'the source is the link host, not the search service\'s site name')
  assert.equal(read("SELECT published_at FROM evidence WHERE url = 'https://news.example.com/t1'")[0].published_at, '2026-11-10', 'the page age fills a missing date')
  const t1Now = await topicOf('t1')
  assert.equal(t1Now.stance, 0.6)
  assert.equal(t1Now.status, 'active', 'research cannot change a status')
  assert.equal(t1Now.falsifier, t1Falsifier, 'the reader wrote the falsifier, so the change waits as a proposal')
  const t1Log = (await http('GET', '/timeline?topic=t1')).body.log
  assert.ok(t1Log.some(item => item.kind === 'proposal' && item.state === 'pending' && item.changes?.falsifier?.to === '新的证伪条件'))
  assert.ok(t1Log.some(item => item.author === 'agent' && item.kind === 'note' && item.body === '要不要把海外收入单列？'))
  const t1Row = read("SELECT next_due_at, checked_at FROM topic WHERE id = 't1'")[0]
  assert.equal(Date.parse(t1Row.next_due_at) - Date.parse(t1Row.checked_at), 12 * 3600000, 'high: back in a day less the slack')

  // t2 failed: it stays due, and the error shows.
  assert.equal((await topicOf('t2')).next_due_at, null, 'a failed topic stays due, even with evidence linked to it')
  let state = (await http('GET', '/state')).body
  assert.match(state.research.error, /^http_429/)
  assert.equal(state.last_run.status, 'partial')
  assert.match(state.last_run.summary, /研究了 3 个议题，1 个没有完成/)
  // t3: a next check from the answer that is earlier than 30 days wins.
  assert.equal((await topicOf('t3')).next_due_at, new Date(`${nextCheck}T00:00:00`).toISOString())

  // The topic's research log: what it searched and read, what it wrote, what it cost.
  const research = (await http('GET', '/timeline?topic=t1')).body.research
  assert.equal(research[0].mode, 'deep')
  assert.equal(research[0].searches, 19)
  assert.equal(research[0].fetches, 4)
  assert.deepEqual(research[0].queries, ['q'])
  assert.deepEqual(research[0].pages, [{ action: 'open_page', url: 'https://www.sec.gov/t1-10q' }])
  assert.equal(research[0].applied.evidence, 2)
  assert.deepEqual(research[0].applied.dropped, ['https://made-up.example.com/x'])
  assert.deepEqual(research[0].applied.proposed, ['falsifier'])
  assert.equal(research[0].answer.trim(), '研究过程的说明。', 'the log keeps the prose without the JSON block')
  const period = isPeak(Date.parse(research[0].started_at)) ? 'peak' : 'off'
  const tokenCost = costOf(DEFAULT_PRICES, 'deepseek-flash', period, { input: 40000, cache_hit: 400000, output: 9000 })
  assert.ok(Math.abs(research[0].cost - (tokenCost + 23 * 0.005)) < 1e-9, 'tokens plus 23 billed searches and reads')

  // Usage: one row per request, search fees included.
  const usage = (await http('GET', '/usage')).body
  assert.equal(usage.sync, undefined, 'nothing to sync: usage comes from the API response')
  const deep = usage.passes.find(pass => pass.topic_id === 't1' && pass.mode === 'deep')
  assert.equal(deep.topic_title, t1Now.title)
  assert.equal(deep.input, 40000)
  assert.equal(deep.cache_hit, 400000)
  assert.equal(deep.output, 9000)
  assert.ok(Math.abs(deep.tool_cost - 0.115) < 1e-9)
  assert.ok(Math.abs(deep.cost - (tokenCost + 0.115)) < 1e-9)
  assert.equal(deep.summary, 't1 读了 10-Q')
  assert.equal(deep.run.status, 'partial')
  const failed = usage.passes.find(pass => pass.topic_id === 't2' && pass.error)
  assert.match(failed.error, /^http_429/)
  assert.equal(failed.cost, 0)
  assert.ok(state.cost.board_month >= deep.cost - 1e-9, 'the month total includes search fees')

  // Nothing due and no open item: run-now says so and sends nothing.
  write("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z' WHERE board_id = 'acme'")
  write("UPDATE topic_log SET state = 'seen' WHERE board_id = 'acme' AND author = 'human' AND state = 'open'")
  const quiet = deepseek.calls.length
  res = await http('POST', '/run-now')
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'nothing_due')
  assert.equal(deepseek.calls.length, quiet)

  // Research one topic now, due or not; a success clears the error.
  deepseek.reply = () => ({ answer: { summary: 't2 这次成功了', evidence: [], stance: null } })
  res = await http('POST', '/topic/research', { topic: 't2' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.run.ok, true)
  await hooks.settled('acme')
  assert.deepEqual(deepseek.calls.slice(quiet).map(call => call.topic), ['t2'])
  state = (await http('GET', '/state')).body
  assert.equal(state.research.error, null)
  assert.equal(state.last_run.mode, 'manual')
  assert.equal((await http('POST', '/topic/research', { topic: 'nvda-t1' })).status, 404, 'a topic of another board is not found here')

  // An answer without a result block writes nothing and says why.
  deepseek.reply = () => ({ text: '我没法给出结果。' })
  const evidenceCount = read('SELECT COUNT(*) AS n FROM evidence')[0].n
  await http('POST', '/topic/research', { topic: 't2' })
  await hooks.settled('acme')
  assert.equal((await http('GET', '/state')).body.research.error, 'no_json_in_answer')
  assert.equal(read('SELECT COUNT(*) AS n FROM evidence')[0].n, evidenceCount)

  // An answer written without any search is dropped, whatever it claims to have
  // checked, and the topic is tried again later.
  deepseek.reply = () => ({ noTools: true, answer: { summary: '检索了近一年的披露，没有变化', evidence: [], stance: 0.3, rationale: '凭印象' } })
  const assessmentCount = read("SELECT COUNT(*) AS n FROM assessment WHERE topic_id = 't2'")[0].n
  await http('POST', '/topic/research', { topic: 't2' })
  await hooks.settled('acme')
  state = (await http('GET', '/state')).body
  assert.equal(state.research.error, 'no_search')
  assert.ok(state.research.retry_at, 'a topic answered without searching is retried')
  assert.equal(read("SELECT COUNT(*) AS n FROM assessment WHERE topic_id = 't2'")[0].n, assessmentCount, 'no stance from memory')
  assert.equal(read("SELECT error FROM pass WHERE topic_id = 't2' ORDER BY started_at DESC, turn DESC LIMIT 1")[0].error, 'no_search')
  deepseek.reply = () => ({ answer: { summary: '没有新进展', evidence: [], stance: null } })
  console.log('research: ok')
}

// ---------------------------------------------------------------- research helpers
{
  assert.deepEqual(parseAnswer('说明\n```json\n{"summary":"a"}\n```').data, { summary: 'a' })
  assert.deepEqual(parseAnswer('```json\n{"summary":"old"}\n```\n后来\n```json\n{"summary":"new"}\n```').data, { summary: 'new' }, 'the last block wins')
  assert.deepEqual(parseAnswer('没有代码块 {"summary":"bare","stance":null}').data, { summary: 'bare', stance: null })
  assert.equal(parseAnswer('没有结果').ok, false)
  assert.equal(answerProse('说明\n```json\n{"summary":"a"}\n```').trim(), '说明')
  const prompt = researchPrompt({
    today: '2026-11-14', board: { title: 'B' }, mode: 'glance',
    topic: { id: 'x1', title: 'T', thesis: 'th', falsifier: 'f' },
    inbox: [{ log_id: 7, kind: 'note', note: '看看这个' }],
  })
  assert.match(prompt, /议题 x1：T/)
  assert.match(prompt, /\[log 7\] 读者评论/)
  assert.match(prompt, /```json/)
  // Pass times follow the wall clock of the rule's zone, across a DST change.
  const ny = { kind: 'daily', time: '08:30', weekdays: [1], timeZone: 'America/New_York' }
  assert.equal(new Date(latestSlot(ny, Date.parse('2026-10-30T15:00:00Z'))).toISOString(), '2026-10-30T12:30:00.000Z', 'EDT')
  assert.equal(new Date(latestSlot(ny, Date.parse('2026-11-02T15:00:00Z'))).toISOString(), '2026-11-02T13:30:00.000Z', 'EST')
  const sh = { kind: 'weekly', time: '07:45', weekdays: [5], timeZone: 'Asia/Shanghai' }
  // 2026-11-16 is a Monday; the Friday before is 11-13.
  assert.equal(new Date(latestSlot(sh, Date.parse('2026-11-16T00:00:00Z'))).toISOString(), '2026-11-12T23:45:00.000Z')
  assert.equal(new Date(nextSlot(sh, Date.parse('2026-11-16T00:00:00Z'))).toISOString(), '2026-11-19T23:45:00.000Z')
  console.log('research helpers: ok')
}

// ---------------------------------------------------------------- usage
{
  assert.equal(isPeak(Date.parse('2026-11-11T02:00:00Z')), true, 'Wednesday 10:00 Beijing is peak')
  assert.equal(isPeak(Date.parse('2026-11-11T05:00:00Z')), false, '13:00 is the lunch gap')
  assert.equal(isPeak(Date.parse('2026-11-11T09:59:00Z')), true)
  assert.equal(isPeak(Date.parse('2026-11-11T10:00:00Z')), false, '18:00 ends peak')
  assert.equal(isPeak(Date.parse('2026-11-14T02:00:00Z')), false, 'Saturday is off-peak')
  const expected = (10000 * 2 + 20000 * 0.04 + 1000 * 8) / 1e6
  assert.ok(Math.abs(costOf(DEFAULT_PRICES, 'deepseek-flash', 'peak', { input: 10000, cache_hit: 20000, output: 1000 }) - expected) < 1e-12)
  assert.equal(costOf(DEFAULT_PRICES, 'mystery', 'off', { input: 1, cache_hit: 1, output: 1 }), null)

  // Rows from the days when passes ran in dsh sessions still show, without search fees.
  const db = new DatabaseSync(file)
  const at = new Date().toISOString()
  db.prepare("INSERT INTO pass (session_id, turn, board_id, schedule_id, started_at, ended_at, steps, searches, fetches, final) VALUES ('s-old', 1, 'acme', 'sched-old', ?, ?, 12, 3, 1, 1)").run(at, at)
  db.prepare("INSERT INTO pass_tokens (session_id, turn, model, period, input, cache_hit, output) VALUES ('s-old', 1, 'deepseek-flash', 'off', 10000, 20000, 1000)").run()
  db.prepare("INSERT INTO pass (session_id, turn, board_id, schedule_id, started_at, ended_at, steps, searches, fetches, final) VALUES ('s-odd', 1, 'nvda', 'sched-x', ?, ?, 1, 0, 0, 1)").run(at, at)
  db.prepare("INSERT INTO pass_tokens (session_id, turn, model, period, input, cache_hit, output) VALUES ('s-odd', 1, 'mystery-model', 'off', 500, 0, 100)").run()
  db.close()
  const usage = (await http('GET', '/usage')).body
  const old = usage.passes.find(pass => pass.session_id === 's-old')
  assert.equal(old.mode, 'session')
  assert.equal(old.tool_cost, 0, 'search fees of chat passes were never known')
  assert.ok(Math.abs(old.cost - (10000 * 1 + 20000 * 0.02 + 1000 * 4) / 1e6) < 1e-12)
  const odd = usage.passes.find(pass => pass.session_id === 's-odd')
  assert.equal(odd.cost, null, 'an unknown model has no price')
  assert.equal(odd.unpriced_tokens, 600)
  assert.ok(usage.prices.source.startsWith('https://api-docs.deepseek.com/'))
  assert.deepEqual(usage.prices.tools, { search: 0.005, fetch: 0.005 })
  const state = (await http('GET', '/state?board=nvda')).body
  assert.equal(typeof state.cost.month, 'number')
  assert.equal(state.cost.currency, 'CNY')
  const boards = (await http('GET', '/boards')).body
  assert.equal(typeof boards.month_cost, 'number')
  console.log('usage: ok')
}

host.dispose()

// ---------------------------------------------------------------- scheduler
{
  // A clock the test moves. 2026-11-16 is a Monday; 00:00Z is 08:00 in Shanghai.
  let now = Date.parse('2026-11-16T00:00:00Z')
  const own = {}
  const schedFile = join(dir, 'sched', 'trail.db')
  const sched = makeHost()
  apply(sched.ctx, config({ database: schedFile, now: () => now, hooks: own }))
  await settle()
  await importFixture(sched.routes[0], schedFile)
  const write = query => { const db = new DatabaseSync(schedFile); db.exec(query); db.close() }
  const get = path => callRoute(sched.routes[0], 'GET', path)
  const post = (path, body) => callRoute(sched.routes[0], 'POST', path, JSON.stringify(body ?? {}))
  // One due topic, so each pass is one request.
  write("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z'; UPDATE topic SET next_due_at = NULL WHERE id = 't1'; UPDATE board SET time_zone = 'Asia/Shanghai'")
  let res = await post('/schedule', { cadence: 'daily', time: '08:30' })
  assert.equal(res.body.next, '2026-11-16T00:30:00.000Z', 'next pass: today 08:30 Shanghai')
  const start = deepseek.calls.length
  const tick = async () => { own.tick(); await own.settled('acme') }
  await tick()
  assert.equal(deepseek.calls.length, start, 'before 08:30 nothing runs')
  now = Date.parse('2026-11-16T00:31:00Z')
  await tick()
  assert.equal(deepseek.calls.length, start + 1, '08:30 passed: one pass')
  assert.equal(deepseek.calls.at(-1).topic, 't1')
  write("UPDATE topic SET next_due_at = NULL WHERE id = 't1'")
  await tick()
  assert.equal(deepseek.calls.length, start + 1, 'one pass per scheduled time')
  let state = (await get('/state')).body
  assert.equal(state.last_run.mode, 'daily')
  // dsh was closed Tuesday and most of Wednesday: one catch-up pass, not two.
  now = Date.parse('2026-11-18T03:00:00Z')
  await tick()
  await tick()
  assert.equal(deepseek.calls.length, start + 2)
  // Weekly on Fridays: changing the rule on Wednesday does not fire at once.
  res = await post('/schedule', { cadence: 'weekly', weekdays: [5], time: '08:30' })
  assert.equal(res.body.next, '2026-11-20T00:30:00.000Z')
  write("UPDATE topic SET next_due_at = NULL WHERE id = 't1'")
  await tick()
  assert.equal(deepseek.calls.length, start + 2)
  now = Date.parse('2026-11-20T00:30:00Z')
  await tick()
  assert.equal(deepseek.calls.length, start + 3, 'Friday 08:30')
  // A due time that already passed today, set while paused, waits for the next one.
  res = await post('/schedule', { cadence: 'paused' })
  assert.equal(res.body.next, null)
  write("UPDATE topic SET next_due_at = NULL WHERE id = 't1'")
  now = Date.parse('2026-11-27T00:31:00Z')
  await tick()
  assert.equal(deepseek.calls.length, start + 3, 'a paused board does not run')
  res = await post('/schedule', { cadence: 'weekly' })
  await tick()
  assert.equal(deepseek.calls.length, start + 3, 'resuming after today\'s time waits for next week')
  // A scheduled time with nothing due sends nothing and notes when it looked.
  write("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z'")
  now = Date.parse('2026-12-04T00:31:00Z')
  await tick()
  assert.equal(deepseek.calls.length, start + 3)
  const db = new DatabaseSync(schedFile, { readOnly: true })
  assert.ok(db.prepare("SELECT value FROM settings WHERE key = 'idle_at:acme'").get(), 'an idle pass is noted')
  db.close()
  state = (await get('/state')).body
  assert.ok(state.research.idle_at)
  sched.dispose()
  console.log('scheduler: ok')
}

// ---------------------------------------------------------------- adopting the dsh task of v7
{
  const adoptFile = join(dir, 'adopt', 'trail.db')
  // A database from v7: the rule lives in a dsh task the board points at.
  let step = makeHost()
  apply(step.ctx, config({ database: adoptFile, hooks: {} }))
  await settle()
  await importFixture(step.routes[0], adoptFile)
  step.dispose()
  {
    const db = new DatabaseSync(adoptFile)
    db.exec(`
      UPDATE board SET rule_kind = NULL, run_time = NULL, weekdays = NULL, time_zone = NULL, active = 1, last_slot_at = NULL, schedule_id = 'sched-old';
      INSERT INTO settings (key, value) VALUES ('kick_pending_since:acme', 'x'), ('schedule_error:acme', 'x'), ('usage_parser_version', '3');
    `)
    db.close()
  }
  const task = { id: 'sched-old', kind: 'weekly', weekdays: [1, 4], time: '07:45:00.000', timeZone: 'Asia/Shanghai', status: 'paused', title: '循迹巡检 · Acme Robotics (ACME)' }
  step = makeHost([task])
  step.control.failDelete = true
  const adoptHooks = {}
  apply(step.ctx, config({ database: adoptFile, hooks: adoptHooks }))
  await settle()
  const read = () => {
    const db = new DatabaseSync(adoptFile, { readOnly: true })
    const board = db.prepare("SELECT * FROM board WHERE id = 'acme'").get()
    const settings = db.prepare('SELECT key FROM settings').all().map(row => row.key)
    db.close()
    return { board, settings }
  }
  let now = read()
  assert.equal(now.board.rule_kind, 'weekly', 'the rule is copied from the task')
  assert.equal(now.board.run_time, '07:45')
  assert.equal(now.board.weekdays, '[1,4]')
  assert.equal(now.board.time_zone, 'Asia/Shanghai')
  assert.equal(now.board.active, 0, 'a paused task stays paused')
  assert.ok(now.board.last_slot_at, 'the latest time counts as done, so adopting never fires a pass')
  assert.equal(now.board.schedule_id, 'sched-old', 'a delete that failed is kept for the next start')
  {
    const lines = []
    const original = console.warn
    console.warn = (...args) => lines.push(args.join(' '))
    try {
      for (let index = 0; index < 3; index += 1) await adoptHooks.adoptScheduleTasks()
    } finally { console.warn = original }
    assert.equal(lines.length, 0, 'the same failure is not logged again every minute')
  }
  assert.equal(step.tasks.length, 1)
  assert.ok(!now.settings.some(key => /^(kick_pending_since|schedule_error)|^usage_parser_version$/.test(key)), 'old bookkeeping is removed')
  const schedule = (await callRoute(step.routes[0], 'GET', '/schedule')).body
  assert.equal(schedule.cadence, 'paused')
  assert.deepEqual(schedule.weekdays, [1, 4])
  step.dispose()
  // Next start: the rule stays as it is, and the task is deleted.
  step = makeHost([task])
  apply(step.ctx, config({ database: adoptFile, hooks: {} }))
  await settle()
  now = read()
  assert.deepEqual(step.deleted, ['sched-old'])
  assert.equal(now.board.schedule_id, null)
  assert.equal(now.board.run_time, '07:45')
  step.dispose()
  // A task that is already gone is not an error.
  {
    const db = new DatabaseSync(adoptFile)
    db.exec("UPDATE board SET schedule_id = 'sched-gone'")
    db.close()
  }
  step = makeHost([])
  apply(step.ctx, config({ database: adoptFile, hooks: {} }))
  await settle()
  assert.equal(read().board.schedule_id, null)
  step.dispose()
  console.log('adopt dsh task: ok')
}

// ---------------------------------------------------------------- dsh quits during a pass
{
  const cutFile = join(dir, 'cut', 'trail.db')
  let cut = makeHost()
  const own = {}
  apply(cut.ctx, config({ database: cutFile, hooks: own }))
  await settle()
  await importFixture(cut.routes[0], cutFile)
  const release = deepseek.hold()
  const res = await callRoute(cut.routes[0], 'POST', '/topic/research', JSON.stringify({ topic: 't1' }))
  assert.equal(res.body.run.ok, true)
  cut.dispose()
  release()
  await own.settled('acme')
  const runOf = () => {
    const db = new DatabaseSync(cutFile, { readOnly: true })
    const run = db.prepare('SELECT status, summary FROM run ORDER BY id DESC LIMIT 1').get()
    const marker = db.prepare("SELECT value FROM settings WHERE key = 'api_run:acme'").get()
    const passes = db.prepare('SELECT COUNT(*) AS n FROM pass').get().n
    db.close()
    return { run, marker, passes }
  }
  let now = runOf()
  assert.equal(now.run.status, 'open', 'nothing is written after shutdown')
  assert.equal(now.passes, 0)
  assert.ok(now.marker)
  // The next start closes the cut-off run, so the board is free at once.
  cut = makeHost()
  apply(cut.ctx, config({ database: cutFile, hooks: own }))
  await settle()
  now = runOf()
  assert.equal(now.run.status, 'failed')
  assert.match(now.run.summary, /dsh 退出/)
  assert.equal(now.marker, undefined)
  const before = deepseek.calls.length
  await callRoute(cut.routes[0], 'POST', '/topic/research', JSON.stringify({ topic: 't1' }))
  await own.settled('acme')
  assert.equal(deepseek.calls.length, before + 1, 'a new pass starts without waiting for the old run')
  cut.dispose()
  console.log('quit during a pass: ok')
}

// ---------------------------------------------------------------- falsifier alert, retries, waiting asks, retention
{
  let now = Date.parse('2026-11-16T00:00:00Z')
  const own = {}
  const followFile = join(dir, 'follow', 'trail.db')
  let follow = makeHost()
  apply(follow.ctx, config({ database: followFile, now: () => now, hooks: own }))
  await settle()
  await importFixture(follow.routes[0], followFile)
  const sql = (query, ...params) => { const db = new DatabaseSync(followFile); const rows = db.prepare(query).all(...params); db.close(); return rows }
  const call = (method, path, body) => callRoute(follow.routes[0], method, path, body === undefined ? undefined : JSON.stringify(body))
  const research = async topicId => { await call('POST', '/topic/research', { topic: topicId }); await own.settled('acme') }
  const topicNow = async id => (await call('GET', '/state')).body.topics.find(item => item.id === id)
  const tick = async () => { own.tick(); await own.settled('acme') }
  // Only retries may start passes here.
  await call('POST', '/schedule', { cadence: 'paused' })

  // The falsifier met: an alert on the topic and a red dot, until dismissed.
  deepseek.reply = () => ({ answer: { summary: '收入连续两季下滑', evidence: [], stance: -1, rationale: '两季收入同比下滑，命中证伪条件', falsifier_triggered: true } })
  await research('t1')
  let t1 = await topicNow('t1')
  assert.ok(t1.falsified_at)
  assert.equal(t1.falsified_note, '两季收入同比下滑，命中证伪条件')
  assert.equal((await call('GET', '/badge')).body.falsified, 1)
  assert.equal((await call('GET', '/timeline?topic=t1')).body.research[0].falsifier_triggered, true)
  // Later passes refresh the same alert instead of adding another.
  await research('t1')
  assert.equal((await call('GET', '/badge')).body.falsified, 1)
  assert.equal((await call('POST', '/topic/falsified/dismiss', { topic: 't1' })).status, 200)
  assert.equal((await topicNow('t1')).falsified_at, null)
  assert.equal((await call('GET', '/badge')).body.falsified, 0)
  assert.equal((await call('POST', '/topic/falsified/dismiss', { topic: 'nope' })).status, 404)
  // Rewriting the falsifier ends the alert; so does closing the topic.
  await research('t1')
  t1 = await topicNow('t1')
  assert.ok(t1.falsified_at)
  await call('POST', '/topic/edit', { topic: 't1', changes: { falsifier: '收入连续三季下滑' }, base: { falsifier: t1.falsifier } })
  assert.equal((await topicNow('t1')).falsified_at, null, 'a rewritten falsifier clears the alert')
  await research('t1')
  await call('POST', '/topic/edit', { topic: 't1', changes: { status: 'closed' }, base: { status: 'active' } })
  assert.equal((await topicNow('t1')).falsified_at, null, 'a closed topic has no alert')
  await call('POST', '/topic/edit', { topic: 't1', changes: { status: 'active' }, base: { status: 'closed' } })

  // One open AI question per topic: a new one waits until the reader answers.
  const questions = () => sql("SELECT id, body FROM topic_log WHERE topic_id = 't3' AND author = 'agent' AND kind = 'note' ORDER BY id")
  deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null, question: '问题一' } })
  await research('t3')
  deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null, question: '问题二' } })
  await research('t3')
  assert.deepEqual(questions().map(row => row.body), ['问题一'], 'no second question while the first waits')
  await call('POST', '/topic/note', { topic: 't3', body: '先不用', reply_to: questions()[0].id })
  deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null, question: '问题三' } })
  await research('t3')
  assert.deepEqual(questions().map(row => row.body), ['问题一', '问题三'], 'after the reader answers, a new question is asked')

  // Research by hand before the topic is due moves the next check; it does not
  // leave the due time of the last check, which would make the topic due again soon.
  {
    const dueOf = id => sql('SELECT next_due_at, checked_at FROM topic WHERE id = ?', id)[0]
    deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null } })
    await call('POST', '/topic/edit', { topic: 't5', changes: { importance: 'high' }, base: { importance: (await topicNow('t5')).importance } })
    await research('t5')
    const first = dueOf('t5')
    assert.equal(Date.parse(first.next_due_at) - Date.parse(first.checked_at), 12 * 3600000)
    now += 3 * 3600000
    await research('t5')
    const second = dueOf('t5')
    assert.equal(Date.parse(second.next_due_at) - Date.parse(second.checked_at), 12 * 3600000, 'counted from this check')
    assert.ok(second.next_due_at > first.next_due_at)
    // A date the AI chose earlier (an earnings day) still wins over the interval.
    // Record timestamps use the real clock here; only the schedule clock is injected.
    const soon = new Date(Date.now() + 3 * 86400000)
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
    deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null, next_check: day } })
    await call('POST', '/topic/edit', { topic: 't5', changes: { importance: 'medium' }, base: { importance: 'high' } })
    await research('t5')
    const chosen = dueOf('t5').next_due_at
    assert.equal(chosen, new Date(`${day}T00:00:00`).toISOString(), 'the chosen date is earlier than a week, so it wins')
    deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null } })
    await research('t5')
    assert.equal(dueOf('t5').next_due_at, chosen, 'a chosen date survives research by hand')
  }

  // An undecided AI suggestion is not repeated or piled up by later passes.
  const t4 = await topicNow('t4')
  await call('POST', '/topic/edit', { topic: 't4', changes: { falsifier: '读者写的证伪条件' }, base: { falsifier: t4.falsifier } })
  const suggestions = () => sql("SELECT id, state, changes FROM topic_log WHERE topic_id = 't4' AND kind = 'proposal' ORDER BY id")
    .map(row => ({ id: row.id, state: row.state, to: JSON.parse(row.changes).falsifier.to }))
  const propose = value => { deepseek.reply = () => ({ answer: { summary: 's', evidence: [], stance: null, edits: [{ field: 'falsifier', value, reason: '口径变了' }] } }) }
  propose('写法甲')
  await research('t4')
  await research('t4')
  assert.deepEqual(suggestions().map(row => [row.state, row.to]), [['pending', '写法甲']], 'the same suggestion again adds nothing')
  assert.match(deepseek.calls.at(-1).prompt, /还在等读者决定：证伪条件改成「写法甲」/, 'the AI sees what it already suggested')
  assert.equal((await call('GET', '/timeline?topic=t4')).body.research[0].applied.proposed.length, 0)
  propose('写法乙')
  await research('t4')
  assert.deepEqual(suggestions().map(row => [row.state, row.to]), [['pending', '写法乙']], 'a new wording replaces the unanswered one')
  await call('POST', '/topic/note', { topic: 't4', body: '乙的数据从哪来？', reply_to: suggestions()[0].id })
  propose('写法丙')
  await research('t4')
  assert.deepEqual(suggestions().map(row => [row.state, row.to]), [['superseded', '写法乙'], ['pending', '写法丙']], 'one the reader replied to stays in the history')

  // A passing failure is tried again after 5 and 20 minutes, then left for the schedule.
  let before = deepseek.calls.length
  deepseek.reply = () => ({ status: 429 })
  await research('t2')
  let state = (await call('GET', '/state')).body
  assert.match(state.research.error, /^http_429/)
  assert.equal(state.research.retry_at, new Date(now + 5 * 60000).toISOString())
  now += 4 * 60000
  await tick()
  assert.equal(deepseek.calls.length, before + 1, 'not before 5 minutes')
  now += 2 * 60000
  await tick()
  assert.equal(deepseek.calls.length, before + 2, 'first retry')
  assert.equal(deepseek.calls.at(-1).topic, 't2')
  assert.equal((await call('GET', '/state')).body.last_run.mode, 'retry')
  now += 21 * 60000
  await tick()
  assert.equal(deepseek.calls.length, before + 3, 'second retry')
  assert.equal((await call('GET', '/state')).body.research.retry_at, null, 'no third retry')
  now += 3 * 3600000
  await tick()
  assert.equal(deepseek.calls.length, before + 3)
  // A retry that works clears the error.
  await research('t2')
  deepseek.reply = () => ({ answer: { summary: '这次好了', evidence: [], stance: null } })
  now += 6 * 60000
  await tick()
  state = (await call('GET', '/state')).body
  assert.equal(state.research.error, null)
  assert.equal(state.research.retry_at, null)
  // A failure that waiting does not fix is not retried.
  before = deepseek.calls.length
  deepseek.reply = () => ({ status: 401 })
  await research('t2')
  assert.equal((await call('GET', '/state')).body.research.retry_at, null)
  now += 30 * 60000
  await tick()
  assert.equal(deepseek.calls.length, before + 1, 'http_401 waits for the schedule')

  // Each topic keeps the full text of its latest research only.
  deepseek.reply = () => ({ results: ['https://a.example.com/x'], answer: { summary: 'ok', evidence: [], stance: null } })
  for (let index = 0; index < 8; index += 1) await research('t1')
  const kept = () => sql("SELECT COUNT(*) AS total, COUNT(answer) AS answers, COUNT(trace) AS traces FROM pass WHERE topic_id = 't1' AND mode <> 'session'")[0]
  assert.ok(kept().total >= 12)
  assert.equal(kept().answers, 6)
  assert.equal(kept().traces, 6)
  const latestTrace = JSON.parse(sql("SELECT trace FROM pass WHERE topic_id = 't1' ORDER BY started_at DESC LIMIT 1")[0].trace)
  assert.equal(latestTrace.results, undefined, 'search results are not stored')
  assert.equal((await call('GET', '/timeline?topic=t1')).body.research.length, 6)

  // An Ask AI comment cut off by quitting dsh is researched at the next start.
  deepseek.reply = () => ({ answer: { summary: '回答了', evidence: [], stance: null, replies: [] } })
  const release = deepseek.hold()
  await call('POST', '/topic/note', { topic: 't3', body: '这条要 AI 处理', ask_ai: true })
  follow.dispose()
  release()
  await own.settled('acme')
  sql("UPDATE pass SET answer = 'old' WHERE topic_id = 't1' AND answer IS NULL")
  before = deepseek.calls.length
  follow = makeHost()
  apply(follow.ctx, config({ database: followFile, now: () => now, hooks: own }))
  await settle()
  await own.settled('acme')
  assert.equal(deepseek.calls.length, before + 1, 'the waiting comment is picked up at start')
  assert.equal(deepseek.calls.at(-1).topic, 't3')
  assert.match(deepseek.calls.at(-1).prompt, /这条要 AI 处理/)
  assert.equal(sql("SELECT COUNT(*) AS n FROM topic_log WHERE author = 'human' AND state = 'open' AND ask_ai = 1")[0].n, 0)
  assert.equal(kept().answers, 6, 'old full text is trimmed at start too')
  follow.dispose()
  // A restart with nothing waiting sends nothing.
  before = deepseek.calls.length
  follow = makeHost()
  apply(follow.ctx, config({ database: followFile, now: () => now, hooks: own }))
  await settle()
  await own.settled('acme')
  assert.equal(deepseek.calls.length, before)
  follow.dispose()
  deepseek.reply = () => ({ answer: { summary: '没有新进展', evidence: [], stance: null } })
  console.log('falsifier, retries, asks, retention: ok')
}

// ---------------------------------------------------------------- what v8 no longer uses is removed
{
  const oldFile = join(dir, 'leftovers', 'trail.db')
  let step = makeHost()
  apply(step.ctx, config({ database: oldFile, hooks: {} }))
  await settle()
  await importFixture(step.routes[0], oldFile)
  step.dispose()
  {
    const db = new DatabaseSync(oldFile)
    db.exec(`
      CREATE TABLE usage_scan (session_id TEXT PRIMARY KEY, through TEXT);
      ALTER TABLE board ADD COLUMN prompt_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE board ADD COLUMN ticker TEXT;
      ALTER TABLE board ADD COLUMN cik TEXT;
      ALTER TABLE board ADD COLUMN company TEXT;
      ALTER TABLE board ADD COLUMN sic TEXT;
      INSERT INTO settings (key, value) VALUES ('schedule_id', 'sched-legacy'), ('schedule_prompt_version', '7'), ('sec_contact', 'reader@example.com');
      UPDATE board SET schedule_id = NULL;
    `)
    db.close()
  }
  step = makeHost()
  apply(step.ctx, config({ database: oldFile, hooks: {} }))
  await settle()
  const db = new DatabaseSync(oldFile, { readOnly: true })
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'usage_scan'").get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('board') WHERE name IN ('prompt_version', 'ticker', 'cik', 'company', 'sic')").get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'schedule_%' OR key = 'sec_contact'").get().n, 0, 'the SEC contact email is not kept')
  db.close()
  step.dispose()
  console.log('leftovers removed: ok')
}

// ---------------------------------------------------------------- blank start, import and export
{
  const blankFile = join(dir, 'blank', 'trail.db')
  const blank = makeHost()
  const own = {}
  apply(blank.ctx, config({ database: blankFile, hooks: own }))
  await settle()
  const call = (method, path, body) => callRoute(blank.routes[0], method, path, body === undefined ? undefined : JSON.stringify(body))

  // A fresh install has no board and says so everywhere.
  let res = await call('GET', '/boards')
  assert.deepEqual(res.body.boards, [], 'a fresh store starts empty')
  assert.equal(res.body.has_key, true)
  assert.equal((await call('GET', '/state')).status, 404)
  assert.equal((await call('POST', '/topic/add', { title: 'x', thesis: 'y', falsifier: 'z' })).status, 404, 'no topic without a board')
  assert.equal((await call('POST', '/seen')).status, 404)
  assert.equal(blank.tools.get('trail_brief').execute({}).code, 'no_boards')

  // A broken file names every problem and creates nothing.
  res = await call('POST', '/board/import', { markdown: '# Broken\n\n## 只有命题\n散落的一行\n- 命题：某事\n- 重要性：很高\n' })
  assert.equal(res.status, 400)
  assert.deepEqual(res.body.problems.map(problem => problem.code), ['topic_needs_falsifier', 'invalid_importance', 'unlabelled_text'])
  assert.equal((await call('POST', '/board/import', { markdown: '没有标题' })).body.problems[0].code, 'missing_board_title')
  assert.deepEqual((await call('GET', '/boards')).body.boards, [])

  // A dry run previews the board and what one pass of it costs.
  res = await call('POST', '/board/import', { markdown: FIXTURE, dry_run: true })
  assert.equal(res.status, 200)
  assert.equal(res.body.title, 'Acme Robotics (ACME)')
  assert.equal(res.body.topics.length, 10)
  assert.ok(Math.abs(res.body.estimate - 0.5) < 1e-9, 'ten medium topics, about ¥0.05 each')
  assert.deepEqual((await call('GET', '/boards')).body.boards, [], 'a dry run creates nothing')

  // The import: one board on the asked cadence, every topic due, nothing researched yet.
  const before = deepseek.calls.length
  res = await call('POST', '/board/import', { markdown: FIXTURE.replace('- 命题：前十大客户', '- 重要性：高\n- 命题：前十大客户'), cadence: 'weekly', weekdays: [1, 4], time: '07:45' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.board, 'acme')
  assert.equal(res.body.schedule.cadence, 'weekly')
  assert.ok(Math.abs(res.body.estimate - 0.65) < 1e-9)
  const state = (await call('GET', '/state')).body
  assert.equal(state.board.id, 'acme', 'with no board named, the first board answers')
  assert.deepEqual(state.topics.map(topic => topic.id).sort(), Array.from({ length: 10 }, (_, i) => `t${i + 1}`).sort())
  assert.equal(state.stats.due, 10, 'every imported topic is due')
  assert.equal(state.stats.waiting_agent, 0, 'an import asks nothing of the AI')
  assert.equal(state.topics.find(topic => topic.id === 't1').importance, 'high')
  const brief = blank.tools.get('trail_brief').execute({})
  assert.deepEqual(brief.topics.find(topic => topic.id === 't2').human_fields.sort(), ['bear_case', 'bull_case', 'falsifier', 'metric', 'thesis', 'title'], 'imported text is the reader\'s')
  await settle()
  assert.equal(deepseek.calls.length, before, 'importing does not research')

  // Export gives back what was imported; closed topics stay home.
  await call('POST', '/topic/edit', { topic: 't10', changes: { status: 'closed' } })
  res = await call('GET', '/board/export?board=acme')
  assert.equal(res.status, 200)
  const { parseBoardMarkdown } = await import('../board-file.js')
  const exported = parseBoardMarkdown(res.body.markdown)
  const original = parseBoardMarkdown(FIXTURE)
  assert.deepEqual(exported.problems, [])
  assert.equal(exported.title, original.title)
  assert.equal(exported.note, original.note)
  assert.equal(exported.topics.length, 9)
  assert.equal(exported.topics[0].importance, 'high')
  assert.deepEqual(exported.topics.slice(1).map(({ importance, ...rest }) => rest), original.topics.slice(1, 9))
  assert.match((await call('GET', '/board/export?board=acme&lang=en')).body.markdown, /^- Falsifier: /m)
  assert.equal((await call('GET', '/board/export?board=nope')).status, 404)

  // The same file again is a second board; its topic ids carry the board id.
  res = await call('POST', '/board/import', { markdown: res.body.markdown })
  assert.equal(res.body.board, 'acme-2')
  const second = (await call('GET', '/state?board=acme-2')).body
  assert.equal(second.topics.length, 9)
  assert.ok(second.topics.every(topic => topic.id.startsWith('acme-2-t')))
  blank.dispose()
  console.log('blank start, import, export: ok')
}

// ---------------------------------------------------------------- primary material
{
  const srcFile = join(dir, 'sources', 'trail.db')
  const ds = makeDeepSeek()
  const web = makeWeb()
  ds.web = web.fetch
  const src = makeHost()
  const own = {}
  apply(src.ctx, config({ database: srcFile, hooks: own, fetch: ds.fetch, sourceDelayMs: 0 }))
  await settle()
  const call = (method, path, body) => callRoute(src.routes[0], method, path, body === undefined ? undefined : JSON.stringify(body))
  const db = () => new DatabaseSync(srcFile)
  const rows = (query, ...params) => { const d = db(); const out = d.prepare(query).all(...params); d.close(); return out }
  const exec = query => { const d = db(); d.exec(query); d.close() }
  await importFixture(src.routes[0], srcFile)

  // Nothing to set up: the names come from the board title, news is on, and
  // whether the healthcare sources apply is not known before the first gather.
  let boards = (await call('GET', '/boards')).body
  assert.ok(!('sec_contact' in boards))
  assert.deepEqual(boards.boards[0].sources, {
    health: null, search_name: '', search_names: ['Acme Robotics'],
    enabled: { fda: false, trials: false, news: true, papers: false },
  })
  assert.equal((await call('POST', '/board/sources', { sources: { telepathy: true } })).body.error, 'invalid_sources')
  assert.equal((await call('POST', '/board/sources', { sources: { filings: true } })).body.error, 'invalid_sources', 'the SEC sources are gone')
  assert.equal((await call('POST', '/board/sources', { search_name: 'x'.repeat(121) })).body.error, 'search_name_too_long')
  let res = await call('POST', '/board/sources', { sources: { papers: false }, search_name: 'Acme Robotics | Acme Labs' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.sources.enabled.papers, false)
  assert.deepEqual(res.body.sources.search_names, ['Acme Robotics', 'Acme Labs'])
  assert.equal(web.requests.length, 0, 'saving asks no site')
  await call('POST', '/board/sources', { search_name: '' })
  exec("UPDATE board SET sources = NULL WHERE id = 'acme'")

  // One pass over two topics: the healthcare check, one gather, the same material first in both prompts.
  exec("UPDATE topic SET next_due_at = '2999-01-01T00:00:00.000Z' WHERE id NOT IN ('t1', 't2')")
  ds.reply = request => request.topic === 't1'
    ? { answer: { summary: '器械获批支持命题', evidence: [{ title: 'Acme Surgical Arm 510(k)', url: ACME_510K, direction: 1, kind: 'filing', summary: '获批' }], stance: 0.3, rationale: '获批' } }
    : { answer: { summary: '没有新进展', evidence: [], stance: null } }
  res = await call('POST', '/run-now')
  assert.equal(res.status, 200, JSON.stringify(res.body))
  await own.settled('acme')
  assert.equal(rows("SELECT health FROM board WHERE id = 'acme'")[0].health, 1, 'FDA records turn the health sources on')
  assert.ok(web.requests.every(r => r.ua === 'dsh-thesis-trail'), 'no site sees anything but the plugin name')
  assert.deepEqual(ds.calls.map(c => c.topic).sort(), ['t1', 't2'])
  const [p1, p2] = ds.calls.map(c => c.prompt)
  const shared = p1.indexOf('（以上材料对这个标的的所有议题相同')
  assert.ok(shared > 0 && p1.includes('一手材料') && p1.includes('Acme Surgical Arm'))
  assert.equal(p1.slice(0, shared), p2.slice(0, shared), 'topics of one board share the prompt prefix')
  assert.ok(p1.indexOf('一手材料') < p1.indexOf('议题 '), 'material comes before the topic')
  assert.equal(web.requests.filter(r => r.url.includes('news.google.com')).length, 1, 'gathered once for the pass')
  const approval = rows('SELECT * FROM evidence WHERE url = ?', ACME_510K)[0]
  assert.ok(approval, 'a link from the material passes the evidence check without a search hit')
  assert.equal(approval.source, 'FDA')
  const run = rows("SELECT * FROM run WHERE board_id = 'acme' ORDER BY id DESC LIMIT 1")[0]
  const stats = JSON.parse(run.sources)
  assert.deepEqual(stats.counts, { fda: 1, trials: 1, news: 1, papers: 1 })
  const yearAgo = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 365 * 86_400_000))
  assert.equal(stats.since, yearAgo, 'topics never checked ask for a year')
  assert.ok(stats.chars > 300 && stats.links === 4)
  assert.ok(!('text' in stats), 'the material itself is not stored')
  const log = (await call('GET', '/timeline?topic=t1')).body.research[0]
  assert.equal(log.material.counts.fda, 1, 'the research log shows what was gathered')

  // A source that fails is noted; the pass goes on.
  web.fail.add('news')
  ds.reply = () => ({ answer: { summary: '没有新进展', evidence: [], stance: null } })
  await call('POST', '/topic/research', { topic: 't3' })
  await own.settled('acme')
  const failedRun = JSON.parse(rows("SELECT sources FROM run WHERE board_id = 'acme' ORDER BY id DESC LIMIT 1")[0].sources)
  assert.equal(failedRun.errors.news, 'http_500')
  assert.equal(rows("SELECT status FROM run WHERE board_id = 'acme' ORDER BY id DESC LIMIT 1")[0].status, 'ok')
  web.fail.delete('news')
  assert.ok(ds.calls.at(-1).prompt.includes('NCT07000000'))

  // A topic checked on 1 October asks only for the material since then.
  exec("UPDATE topic SET checked_at = '2026-10-01T12:00:00.000Z' WHERE id = 't4'")
  await call('POST', '/topic/research', { topic: 't4' })
  await own.settled('acme')
  assert.equal(JSON.parse(rows("SELECT sources FROM run WHERE board_id = 'acme' ORDER BY id DESC LIMIT 1")[0].sources).since, '2026-10-01')
  assert.ok(ds.calls.at(-1).prompt.includes('NCT07000000') && !ds.calls.at(-1).prompt.includes('K261234'), 'the September approval is outside the window')

  // At most three gathers a day per board; later passes reuse the last one.
  await call('POST', '/topic/research', { topic: 't5' })
  await own.settled('acme')
  assert.equal(web.requests.filter(r => r.url.includes('news.google.com')).length, 3)
  assert.ok(ds.calls.at(-1).prompt.includes('NCT07000000'), 'the reused material still goes into the prompt')

  // New names clear the healthcare check; every source off means no requests.
  res = await call('POST', '/board/sources', { search_name: 'Acme Labs', sources: { fda: false, trials: false, news: false, papers: false } })
  assert.equal(res.body.sources.health, null)
  exec("UPDATE board SET health = 0 WHERE id = 'acme'")
  const before = web.requests.length
  await call('POST', '/topic/research', { topic: 't6' })
  await own.settled('acme')
  assert.equal(web.requests.length, before, 'all sources off: no requests')
  assert.ok(!ds.calls.at(-1).prompt.includes('一手材料'))
  src.dispose()
  console.log('primary material: ok')
}

// ---------------------------------------------------------------- no key
{
  // No key anywhere: no request is sent, and the panel says why.
  const keyless = makeHost()
  const own = {}
  apply(keyless.ctx, { database: join(dir, 'keyless', 'trail.db'), fetch: deepseek.fetch, startDelayMs: 0, hooks: own })
  await settle()
  await importFixture(keyless.routes[0], join(dir, 'keyless', 'trail.db'))
  const before = deepseek.calls.length
  const res = await callRoute(keyless.routes[0], 'POST', '/run-now', '{}')
  assert.equal(res.body.code, 'no_api_key')
  own.requestPass('acme', { reason: 'scheduled' })
  await own.settled('acme')
  assert.equal(deepseek.calls.length, before, 'nothing is sent without a key')
  const state = (await callRoute(keyless.routes[0], 'GET', '/state')).body
  assert.equal(state.research.has_key, false)
  assert.equal(state.research.error, 'no_api_key')
  keyless.dispose()
  console.log('no key: ok')
}

// ---------------------------------------------------------------- key from dsh's credentials service
{
  // The key the reader saved in dsh's Models page is found without any .env.
  const keyed = makeHost()
  const asked = []
  keyed.ctx.get = name => name === 'credentials'
    ? { async resolve(ref) { asked.push(ref); return ref === 'DEEPSEEK_API_KEY' ? { value: 'stored-key', source: 'store' } : undefined } }
    : undefined
  const own = {}
  apply(keyed.ctx, { database: join(dir, 'keyed', 'trail.db'), fetch: deepseek.fetch, startDelayMs: 0, hooks: own })
  await settle()
  await importFixture(keyed.routes[0], join(dir, 'keyed', 'trail.db'))
  const state = (await callRoute(keyed.routes[0], 'GET', '/state')).body
  assert.equal(state.research.has_key, true)
  const before = deepseek.calls.length
  const res = await callRoute(keyed.routes[0], 'POST', '/topic/research', JSON.stringify({ topic: 't1' }))
  assert.equal(res.body.run.ok, true)
  await own.settled('acme')
  assert.equal(deepseek.calls.length, before + 1)
  assert.equal(deepseek.calls.at(-1).headers['x-api-key'], 'stored-key')
  assert.ok(asked.every(ref => ref === 'DEEPSEEK_API_KEY'))
  keyed.dispose()
  console.log('key from credentials: ok')
}

rmSync(dir, { recursive: true, force: true })
assert.equal(existsSync(dir), false)
console.log('OK')
