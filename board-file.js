// A board as a Markdown file: the definition one reader hands to another.
//
//   # Acme Robotics (ACME)
//
//   Why the board exists (optional, any number of lines).
//
//   ## Topic title
//   - 重要性：中
//   - 命题：…
//   - 证伪条件：…
//   - 多头预期：…
//   - 空头担忧：…
//   - 观察指标：…
//
// Only the definition travels: no research, evidence, comments or history.
// Chinese and English labels both parse; a field may run over several lines.

const FIELDS = [
  { key: 'importance', zh: '重要性', en: 'Importance' },
  { key: 'thesis', zh: '命题', en: 'Thesis' },
  { key: 'falsifier', zh: '证伪条件', en: 'Falsifier' },
  { key: 'bull_case', zh: '多头预期', en: 'Bull case' },
  { key: 'bear_case', zh: '空头担忧', en: 'Bear case' },
  { key: 'metric', zh: '观察指标', en: 'Metric' },
]

const IMPORTANCE_WORDS = {
  high: ['高', 'high'],
  medium: ['中', 'medium'],
  low: ['低', 'low'],
}

const LABELS = new Map(FIELDS.flatMap(field => [[field.zh, field.key], [field.en.toLowerCase(), field.key]]))
const FIELD_LINE = new RegExp(`^(?:[-*+]\\s+)?(?:\\*\\*)?(${FIELDS.flatMap(field => [field.zh, field.en]).join('|')})(?:\\*\\*)?\\s*[:：]\\s*(.*)$`, 'i')

/** The longest file the panel accepts: far above any real board. */
export const MAX_BOARD_FILE = 200_000
/** The most topics one file may carry. */
export const MAX_IMPORT_TOPICS = 100

/** One board and its topics as Markdown. */
export function boardToMarkdown(board, topics, lang = 'zh') {
  const zh = lang !== 'en'
  const lines = [`# ${oneLine(board.title)}`, '']
  if (board.note) lines.push(String(board.note).trim(), '')
  for (const topic of topics) {
    lines.push(`## ${oneLine(topic.title)}`)
    for (const field of FIELDS) {
      const value = field.key === 'importance' ? importanceWord(topic.importance, zh) : topic[field.key]
      if (value === null || value === undefined || String(value).trim() === '') continue
      const [first, ...rest] = String(value).trim().split('\n')
      lines.push(`- ${zh ? field.zh : field.en}${zh ? '：' : ': '}${first}`)
      for (const line of rest) lines.push(`  ${line}`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Read a board file. Returns { title, note, topics, problems }: every topic as
 * written, and one problem per thing that keeps the file from importing.
 */
export function parseBoardMarkdown(source) {
  const problems = []
  const raw = typeof source === 'string' ? source : ''
  if (raw.length > MAX_BOARD_FILE) return { title: '', note: '', topics: [], problems: [{ code: 'file_too_long' }] }
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  let title = ''
  const noteLines = []
  const topics = []
  let topic = null
  let field = null
  for (const line of lines) {
    const heading = /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading && heading[1] === '#' && title === '' && topic === null) {
      title = heading[2].trim()
      continue
    }
    if (heading && heading[1] === '##') {
      topic = { title: heading[2].trim(), lines: [] }
      topics.push(topic)
      field = null
      continue
    }
    if (topic === null) {
      if (title !== '') noteLines.push(line)
      continue
    }
    const labelled = FIELD_LINE.exec(line)
    if (labelled) {
      field = LABELS.get(labelled[1]) ?? LABELS.get(labelled[1].toLowerCase())
      topic[field] = labelled[2].trim()
      continue
    }
    // A line under a field continues it; text before any field is kept so the
    // reader hears that it was not read, rather than losing it quietly.
    if (field) topic[field] = `${topic[field]}\n${line.trim()}`
    else if (line.trim() !== '') topic.lines.push(line.trim())
  }
  if (title === '') problems.push({ code: 'missing_board_title' })
  if (topics.length === 0) problems.push({ code: 'no_topics' })
  if (topics.length > MAX_IMPORT_TOPICS) problems.push({ code: 'too_many_topics', limit: MAX_IMPORT_TOPICS })
  const seen = new Set()
  const cleaned = topics.map((item, index) => {
    const out = { title: item.title }
    for (const { key } of FIELDS) {
      if (item[key] === undefined) continue
      const value = item[key].replace(/\n+$/, '').trim()
      if (value !== '') out[key] = value
    }
    const at = { topic: index + 1, title: item.title }
    if (out.title === '') problems.push({ code: 'topic_needs_title', ...at })
    if (!out.thesis) problems.push({ code: 'topic_needs_thesis', ...at })
    if (!out.falsifier) problems.push({ code: 'topic_needs_falsifier', ...at })
    if (out.importance !== undefined) {
      const importance = importanceOf(out.importance)
      if (importance === null) problems.push({ code: 'invalid_importance', value: out.importance, ...at })
      else out.importance = importance
    }
    if (item.lines.length > 0) problems.push({ code: 'unlabelled_text', text: item.lines[0].slice(0, 60), ...at })
    if (out.title !== '' && seen.has(out.title)) problems.push({ code: 'duplicate_topic_title', ...at })
    seen.add(out.title)
    return out
  })
  return { title, note: noteLines.join('\n').trim(), topics: cleaned, problems }
}

/** high/medium/low from a word in either language, or null. */
function importanceOf(value) {
  const word = String(value).trim().toLowerCase()
  for (const [key, words] of Object.entries(IMPORTANCE_WORDS)) if (words.includes(word)) return key
  return null
}

function importanceWord(importance, zh) {
  const words = IMPORTANCE_WORDS[importance] ?? IMPORTANCE_WORDS.medium
  return zh ? words[0] : words[1]
}

/** Headings hold one line. */
function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
