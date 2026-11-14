/**
 * Research for one topic, straight against the DeepSeek API.
 *
 * A pass no longer runs inside a dsh session. The plugin sends one request per
 * topic with only that topic's context, and DeepSeek runs the searches and page
 * reads on its side (`deepseek_web_search`). With thinking on, the model searches,
 * opens pages and looks inside them over several steps ("deep thinking search");
 * with thinking off, it searches once and answers. The answer ends with one JSON
 * block that the plugin validates and writes to the store itself.
 *
 * Everything here is pure or takes `fetch` as an argument, so tests run offline.
 */

export const DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic/v1/messages'
/** The web tools only run on this model. */
export const RESEARCH_MODEL = 'deepseek-flash'
/** How much each importance spends: high reads deeply, the rest search once. */
export const MODE_OF = { high: 'deep', medium: 'search', low: 'glance' }
const MAX_TOKENS = { deep: 16000, search: 6000, glance: 3000 }
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000

// ------------------------------------------------------------------ time

const dateParts = new Map()
function formatter(timeZone) {
  if (!dateParts.has(timeZone)) {
    dateParts.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }))
  }
  return dateParts.get(timeZone)
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ms, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map(part => [part.type, part.value]))
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), mi: Number(parts.minute), s: Number(parts.second) }
}

/** The instant at which a time zone's wall clock shows this date and time. */
export function zonedInstant(y, m, d, h, mi, timeZone) {
  const wall = Date.UTC(y, m - 1, d, h, mi)
  let guess = wall
  // Two rounds settle the offset, including across a daylight-saving change.
  for (let round = 0; round < 2; round += 1) {
    const p = zonedParts(guess, timeZone)
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
    guess += wall - shown
  }
  return guess
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
function isoWeekday(y, m, d) {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 7 : day
}

/**
 * Scheduled instants of a rule around `nowMs`, oldest first: one per matching day
 * from eight days back to eight days ahead. `rule` is { kind: daily|weekly,
 * time: 'HH:mm', weekdays: [1..7], timeZone }.
 */
function slotsAround(rule, nowMs) {
  const [h, mi] = String(rule.time ?? '08:30').split(':').map(Number)
  const today = zonedParts(nowMs, rule.timeZone)
  const days = new Set(rule.kind === 'weekly' ? rule.weekdays ?? [] : [1, 2, 3, 4, 5, 6, 7])
  const slots = []
  for (let offset = -8; offset <= 8; offset += 1) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + offset))
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()
    if (!days.has(isoWeekday(y, m, d))) continue
    slots.push(zonedInstant(y, m, d, h, mi, rule.timeZone))
  }
  return slots
}

/** The latest scheduled instant at or before now, or null. */
export function latestSlot(rule, nowMs) {
  const past = slotsAround(rule, nowMs).filter(slot => slot <= nowMs)
  return past.length ? past[past.length - 1] : null
}

/** The first scheduled instant after now, or null. */
export function nextSlot(rule, nowMs) {
  return slotsAround(rule, nowMs).find(slot => slot > nowMs) ?? null
}

// ------------------------------------------------------------------ prompt

const FIELD_NAMES = { title: '标题', thesis: '命题', falsifier: '证伪条件', bull_case: '多头预期', bear_case: '空头担忧', metric: '观察指标', status: '状态' }
const fieldName = field => FIELD_NAMES[field] ?? field
const clip = (value, limit) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s.length > limit ? `${s.slice(0, limit)}…` : s
}

/** One reader item as the model should read it. */
function readerItem(item) {
  const said = item.note ?? item.body ?? ''
  const changes = Object.entries(item.changes ?? item.proposal?.changes ?? {})
  const changed = changes.map(([field, change]) => `${fieldName(field)}从「${clip(change.from, 200) || '（空）'}」改成「${clip(change.to, 400) || '（空）'}」`).join('；')
  if (item.kind === 'edit' || item.kind === 'create') {
    return `[log ${item.log_id}] 读者直接修改：${changed || '（无字段变化）'}${said ? `。说明：${clip(said, 400)}` : ''}（以读者为准，按需调整判断；有说明时在 replies 里回应）`
  }
  if (item.kind === 'accept') return `[log ${item.log_id}] 读者采纳了你的建议：${changed}`
  if (item.kind === 'reject') return `[log ${item.log_id}] 读者没有采纳你的建议（${changed}）${said ? `，理由：${clip(said, 400)}` : ''}（没有新证据不要再提同样的改法）`
  const where = item.anchor ? `（针对「${fieldName(item.anchor.field)}」里的「${clip(item.anchor.quote, 160)}」）` : ''
  const thread = Array.isArray(item.thread) && item.thread.length
    ? `\n  之前的对话：${item.thread.map(message => `${message.author === 'human' ? '读者' : 'AI'}：${clip(message.body, 300)}`).join(' / ')}`
    : ''
  return `[log ${item.log_id}] ${item.kind === 'reply' ? '读者追问' : '读者评论'}${where}：${clip(said, 800)}${thread}（必须在 replies 里回复）`
}

const stanceText = value => value === null || value === undefined ? '还没有评估' : Number(value).toFixed(2)

/**
 * The whole request for one topic. `input` carries what the store knows: the
 * topic, its stance, its evidence, the reader's open items, and the other topics
 * of the board (so one fact can be linked to several).
 */
export function researchPrompt(input) {
  const { today, board, topic, mode, lastChecked, stance, evidence = [], inbox = [], humanFields = [], pending = [], rejected = [], others = [] } = input
  const since = lastChecked ? `上次检查（${lastChecked}）` : '近一年'
  const task = {
    deep: `做一次深入研究：至少核对三个独立来源，优先一手资料（10-K/10-Q/8-K、财报电话会纪要、公司公告、监管文件、学术论文）。`,
    search: `搜索${since}以来的进展，有实质性的新事实才记录。`,
    glance: `只查${since}以来有没有重大事件：财报、指引变化、监管处罚、诉讼、并购、管理层变动、大客户得失。没有就如实写没有，立场填 null。`,
  }[mode]
  const lines = []
  lines.push(`今天是 ${today}。你在长期跟踪「${board.title}」的一个可证伪命题。${task}`)
  lines.push('')
  lines.push(`议题 ${topic.id}：${topic.title}`)
  lines.push(`命题：${topic.thesis}`)
  lines.push(`证伪条件：${topic.falsifier}`)
  lines.push(`多头预期：${topic.bull_case || '（空）'}`)
  lines.push(`空头担忧：${topic.bear_case || '（空）'}`)
  lines.push(`观察指标：${topic.metric || '（空）'}`)
  lines.push(`上次检查：${lastChecked || '从未检查过'}`)
  lines.push(`当前立场：${stanceText(stance?.value)}${stance?.at ? `（${stance.at}）` : ''}${stance?.rationale ? `，理由：${clip(stance.rationale, 500)}` : ''}`)
  if (evidence.length) {
    lines.push('')
    lines.push('已经入库的证据（不要重复记录；同一指标有更新的一期时可以记新的一期）：')
    for (const item of evidence) lines.push(`- ${item.published_at ? String(item.published_at).slice(0, 10) : '日期不明'} ${clip(item.title, 120)} ${item.url}`)
  }
  if (inbox.length) {
    lines.push('')
    lines.push('读者上次之后留下的内容，读者的意见以读者为准：')
    for (const item of inbox) lines.push(readerItem(item))
  }
  if (humanFields.length) {
    lines.push('')
    lines.push(`读者亲手写过这些字段：${humanFields.map(fieldName).join('、')}。你在 edits 里对它们的修改会变成建议，等读者采纳，回复时要说「建议改成……」，不能说「改了」。`)
  }
  if (pending.length) {
    const offered = pending.map(item => Object.entries(item.to ?? {})
      .map(([field, value]) => `${fieldName(field)}改成「${clip(String(value ?? ''), 200)}」`).join('、')).join('；')
    lines.push(`你之前提的这些建议还在等读者决定：${offered}。不要重复提；只有新证据让提法必须变时才在 edits 里给新的写法，新的会替换旧的。`)
  }
  if (rejected.length) {
    lines.push(`被读者拒绝过的修改：${rejected.map(item => `${Object.keys(item.changes ?? {}).map(fieldName).join('、')}${item.reader_note ? `（理由：${clip(item.reader_note, 160)}）` : ''}`).join('；')}。没有新证据不要再提。`)
  }
  if (others.length) {
    lines.push('')
    lines.push('同一标的的其他议题（一条证据也关系到它们时，把 id 填进 also_topics）：')
    for (const other of others) lines.push(`- ${other.id} ${clip(other.title, 80)}`)
  }
  lines.push('')
  lines.push(`做法：
1. 先找反方证据：哪些事实会削弱命题、接近证伪条件。再找支持的事实。
2. 引用财报、指引这类定期数据前，确认它是 ${today} 之前最新的一期，不要把一年前的季报当成最新数据。
3. 逐条对照证伪条件，说明有没有被触发。
4. 立场 stance 在 -1 到 1 之间：-1 确认偏空，0 多空胶着，+1 确认偏多。只有证伪条件或它的反面已被明确满足时才用 ±1；没有新信息时填 null，表示沿用上次的立场。
5. evidence 只放你这次实际搜到或打开过的页面，url 原样照抄，不要凭记忆编写链接。direction：1 支持命题，-1 削弱命题，0 中性。最多 8 条。
6. 回复读者用中文，具体说明查了什么、改了什么。读者要求改写的，在 edits 里给出那个字段的新全文和理由。

先用几段话写研究说明，最后输出一个 JSON 代码块，格式如下（没有的项用空数组或空字符串）：
\`\`\`json
{"summary":"这次查了什么、发现了什么、什么没变，两三句","evidence":[{"title":"","url":"","published_at":"YYYY-MM-DD","direction":0,"kind":"filing|transcript|news|data|paper","summary":"一句话事实","also_topics":[]}],"stance":null,"confidence":0.5,"rationale":"","falsifier_triggered":false,"replies":[{"log_id":0,"body":""}],"edits":[{"field":"thesis|falsifier|bull_case|bear_case|metric","value":"","reason":""}],"question":"需要读者拍板的问题，没有就空","next_check":"有明确的下一个时间点（如财报日）就写 YYYY-MM-DD，否则空"}
\`\`\``)
  return lines.join('\n')
}

// ------------------------------------------------------------------ request

/**
 * Send one research request and read the stream to its end. Returns the answer
 * text, what the service searched and opened (`trace`), the billed usage, and
 * an error string when the request or the generation failed.
 */
export async function runResearch({ fetch: fetchImpl = globalThis.fetch, apiKey, prompt, mode, signal }) {
  const startedAt = Date.now()
  const trace = { queries: [], pages: [], results: [], cites: [] }
  const result = { startedAt, endedAt: startedAt, text: '', trace, usage: {}, steps: 0, error: null }
  if (!apiKey) return { ...result, error: 'no_api_key' }
  const body = {
    model: RESEARCH_MODEL,
    max_tokens: MAX_TOKENS[mode] ?? 6000,
    thinking: { type: mode === 'deep' ? 'enabled' : 'disabled' },
    tools: [{ type: 'deepseek_web_search', name: 'deepseek_web_search' }],
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetchImpl(DEEPSEEK_MESSAGES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    return { ...result, endedAt: Date.now(), error: `request_failed: ${String(error?.message ?? error)}` }
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { ...result, endedAt: Date.now(), error: `http_${response.status}: ${detail.slice(0, 300)}` }
  }
  const blocks = []
  const decoder = new TextDecoder()
  let buffer = ''
  const handle = event => {
    if (event.type === 'message_start') result.usage = { ...event.message?.usage }
    else if (event.type === 'content_block_start') {
      const block = { ...event.content_block, text: event.content_block?.text ?? '' }
      blocks[event.index] = block
      if (block.type === 'server_tool_use') {
        result.steps += 1
        const input = block.input ?? {}
        if (input.action === 'search' && Array.isArray(input.queries)) trace.queries.push(...input.queries)
        else if (input.url) trace.pages.push({ action: input.action, url: input.url, ...input.pattern ? { pattern: input.pattern } : {} })
      } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item?.url) trace.results.push({ url: item.url, title: item.title ?? null, page_age: item.page_age ?? null, site: item.site_name ?? null })
        }
      } else if (block.type === 'web_fetch_tool_result' && block.content?.url) {
        trace.results.push({ url: block.content.url, title: block.content.content?.title ?? null, page_age: block.content.published_at ?? null, site: null, opened: true })
      }
    } else if (event.type === 'content_block_delta') {
      const block = blocks[event.index]
      if (!block) return
      if (event.delta?.type === 'text_delta') block.text += event.delta.text
      else if (event.delta?.type === 'citations_delta' && event.delta.citation?.url) trace.cites.push(event.delta.citation.url)
    } else if (event.type === 'message_delta') {
      result.usage = { ...result.usage, ...event.usage }
      result.stopReason = event.delta?.stop_reason ?? null
    } else if (event.type === 'error') {
      result.error = `generation_failed: ${event.error?.message ?? 'unknown'}`
      if (event.usage) result.usage = { ...result.usage, ...event.usage }
    }
  }
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        const data = raw.split('\n').find(line => line.startsWith('data:'))
        if (!data) continue
        try { handle(JSON.parse(data.slice(5).trim())) } catch { /* a malformed frame is skipped */ }
      }
    }
  } catch (error) {
    result.error ??= `stream_failed: ${String(error?.message ?? error)}`
  }
  result.text = blocks.filter(block => block?.type === 'text').map(block => block.text).join('')
  result.endedAt = Date.now()
  if (!result.error && result.stopReason === 'refusal') result.error = 'refused'
  return result
}

/** Billed search and fetch counts of one request. */
export function toolCounts(usage = {}) {
  const tools = usage.server_tool_use ?? {}
  return {
    searches: Number(tools.tool_search ?? 0) + Number(tools.tool_image_search ?? 0),
    fetches: Number(tools.tool_fetch ?? 0),
  }
}

// ------------------------------------------------------------------ answer

/** The last ```json block of the answer, parsed; or the last top-level object. */
export function parseAnswer(text) {
  const source = String(text ?? '')
  const fenced = [...source.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map(match => match[1])
  const candidates = fenced.reverse()
  const brace = source.lastIndexOf('{"summary"')
  if (brace >= 0) candidates.push(source.slice(brace, source.lastIndexOf('}') + 1))
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate)
      if (data && typeof data === 'object' && !Array.isArray(data)) return { ok: true, data }
    } catch { /* try the next candidate */ }
  }
  return { ok: false, error: 'no_json_in_answer' }
}

/** The answer's prose, without the JSON block, for the research log. */
export function answerProse(text) {
  return String(text ?? '').replace(/```(?:json)?\s*\n[\s\S]*?```/g, '').trim()
}
