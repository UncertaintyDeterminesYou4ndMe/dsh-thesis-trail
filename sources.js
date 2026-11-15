// Primary material for one board, fetched from free public sources before any
// model call: news headlines, and for healthcare companies FDA device decisions,
// clinical trials and papers. Nothing to set up: the names searched come from
// the board title unless the reader gives others.
//
// Nothing here is stored. A pass gathers once per board, hands the same text
// to every topic's prompt (so DeepSeek's prefix cache serves topics after the
// first), and the links count as pages the research saw.
//
// SEC is left out on purpose: it refuses requests that carry no contact email,
// and the reader chose not to have one to fill in.

/** Every source, in the order the material lists them. */
export const SOURCE_KEYS = ['fda', 'trials', 'news', 'papers']
/** Sources that only make sense for healthcare companies. */
export const HEALTH_SOURCES = ['fda', 'trials', 'papers']

/** The longest material handed to a prompt, in characters. */
export const MAX_MATERIAL_CHARS = 16_000
const MAX_NEWS = 20
const MAX_LIST = 15
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT = 'dsh-thesis-trail'

const LEGAL_SUFFIX = /[,.]?\s+(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|ag|se|lp|llc)\.?$/i

/**
 * Search names: the reader's list split on | or , ; otherwise the board title
 * without a trailing "(TICKER)" and legal suffix, so "Tempus AI (TEM)" gives
 * "Tempus AI".
 */
export function searchNamesOf(searchName, title) {
  const listed = String(searchName ?? '').split(/[|,，]/).map(name => name.trim()).filter(Boolean)
  if (listed.length) return listed.slice(0, 3)
  const base = String(title ?? '').replace(/\s*[（(][^）)]*[)）]\s*$/u, '').replace(LEGAL_SUFFIX, '').trim()
  return base ? [base] : []
}

/** Which sources a board uses: its own choices over the defaults. */
export function sourcesOf(board) {
  let chosen = {}
  try { chosen = JSON.parse(board.sources ?? '{}') ?? {} } catch { chosen = {} }
  const health = board.health === 1 || board.health === true
  return Object.fromEntries(SOURCE_KEYS.map(key => [key, typeof chosen[key] === 'boolean' ? chosen[key] : !HEALTH_SOURCES.includes(key) || health]))
}

// ------------------------------------------------------------------ fetching

function client({ fetch: fetchImpl, sleep }) {
  let first = true
  return async function get(url, kind = 'json') {
    if (!first) await sleep()
    first = false
    const response = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: kind === 'json' ? 'application/json' : '*/*' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`http_${response.status}`)
    return kind === 'json' ? response.json() : response.text()
  }
}

const defaultSleep = () => new Promise(resolve => setTimeout(resolve, 250))

/**
 * Whether a company has FDA device records or clinical trials under these
 * names, which turns the healthcare sources on. Null when neither service answered.
 */
export async function detectHealth({ fetch: fetchImpl, names, sleep = defaultSleep }) {
  if (!names.length) return false
  const get = client({ fetch: fetchImpl, sleep })
  let answered = false
  for (const name of names) {
    const fda = await get(`https://api.fda.gov/device/510k.json?search=applicant:${encodeURIComponent(`"${name}"`)}&limit=1`).then(v => { answered = true; return v }, () => null)
    if ((fda?.results?.length ?? 0) > 0) return true
    const trials = await get(`https://clinicaltrials.gov/api/v2/studies?query.spons=${encodeURIComponent(name)}&pageSize=1&fields=NCTId`).then(v => { answered = true; return v }, () => null)
    if ((trials?.studies?.length ?? 0) > 0) return true
  }
  return answered ? false : null
}

// ------------------------------------------------------------------ gathering

/**
 * Gather a board's material since `since` (YYYY-MM-DD). Returns the prompt
 * text, the links in it, a count per source, and an error per failed source.
 * One failed source never stops the others.
 */
export async function gatherMaterial({ fetch: fetchImpl, board, since, today, sleep = defaultSleep }) {
  const enabled = sourcesOf(board)
  const get = client({ fetch: fetchImpl, sleep })
  const names = searchNamesOf(board.search_name, board.title)
  const sections = []
  const counts = {}
  const errors = {}
  const run = async (key, work) => {
    if (!enabled[key] || names.length === 0) return
    try {
      const section = await work()
      counts[key] = section.count
      if (section.lines.length) sections.push({ key, ...section })
    } catch (error) {
      errors[key] = String(error?.message ?? error).slice(0, 120)
    }
  }

  await run('fda', async () => {
    const day = since.replace(/-/g, '')
    const rows = []
    for (const name of names) {
      const applicant = encodeURIComponent(`"${name}"`)
      const k510 = await get(`https://api.fda.gov/device/510k.json?search=applicant:${applicant}+AND+decision_date:[${day}+TO+29991231]&sort=decision_date:desc&limit=${MAX_LIST}`)
      for (const r of k510?.results ?? []) {
        rows.push({ date: isoDay(r.decision_date), text: `510(k) ${r.k_number} ${r.device_name}（${r.applicant}）：${r.decision_description ?? r.decision_code}`, url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${r.k_number}`, id: r.k_number })
      }
      const pma = await get(`https://api.fda.gov/device/pma.json?search=applicant:${applicant}+AND+decision_date:[${day}+TO+29991231]&sort=decision_date:desc&limit=${MAX_LIST}`)
      for (const r of pma?.results ?? []) {
        const id = `${r.pma_number}${r.supplement_number ?? ''}`
        rows.push({ date: isoDay(r.decision_date), text: `PMA ${id} ${r.trade_name ?? r.generic_name ?? ''}：${r.decision_code}${r.supplement_reason ? `，${r.supplement_reason}` : ''}`, url: `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id=${id}`, id })
      }
    }
    return listSection('FDA 器械审批', rows, 'FDA', MAX_LIST, since)
  })

  await run('trials', async () => {
    const rows = []
    for (const name of names) {
      const data = await get(`https://clinicaltrials.gov/api/v2/studies?query.spons=${encodeURIComponent(name)}&filter.advanced=${encodeURIComponent(`AREA[LastUpdatePostDate]RANGE[${since},MAX]`)}&sort=LastUpdatePostDate:desc&pageSize=${MAX_LIST}&fields=NCTId,BriefTitle,OverallStatus,StudyType,LastUpdatePostDate,LeadSponsorName,PrimaryOutcomeMeasure`)
      for (const study of data?.studies ?? []) {
        const p = study.protocolSection ?? {}
        const nct = p.identificationModule?.nctId
        if (!nct) continue
        const primary = (p.outcomesModule?.primaryOutcomes ?? []).map(o => o.measure).slice(0, 1).join('')
        rows.push({
          date: p.statusModule?.lastUpdatePostDateStruct?.date ?? null,
          text: `${nct} ${p.statusModule?.overallStatus ?? ''} ${p.designModule?.studyType === 'INTERVENTIONAL' ? '干预性' : '观察性'}，发起方 ${p.sponsorCollaboratorsModule?.leadSponsor?.name ?? '?'}：${clip(p.identificationModule?.briefTitle ?? '', 300)}${primary ? `（主要终点：${clip(primary, 120)}）` : ''}`,
          url: `https://clinicaltrials.gov/study/${nct}`, id: nct,
        })
      }
    }
    return listSection('临床试验（ClinicalTrials.gov，按最近更新）', rows, 'ClinicalTrials.gov', MAX_LIST, since)
  })

  await run('news', async () => {
    const query = `${names.map(name => `"${name}"`).join(' OR ')} after:${since}`
    const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, 'text')
    const rows = rssItems(xml).map(item => ({ date: item.date, text: `${item.source ? `${item.source}：` : ''}${item.title}`, url: item.url, id: item.url, title: item.title }))
    return listSection('新闻标题（Google News，只是线索，要引用请打开原文核实）', rows, 'Google News', MAX_NEWS, since)
  })

  await run('papers', async () => {
    const term = `(${names.map(name => `"${name}"[Affiliation]`).join(' OR ')}) AND ("${since.replace(/-/g, '/')}"[PDAT] : "3000"[PDAT])`
    const found = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=${MAX_LIST}&term=${encodeURIComponent(term)}`)
    const ids = found?.esearchresult?.idlist ?? []
    const total = Number(found?.esearchresult?.count ?? 0)
    if (ids.length === 0) return { title: '论文', lines: [], links: [], count: 0 }
    const summary = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`)
    const rows = ids.map(id => summary?.result?.[id]).filter(Boolean).map(paper => ({
      date: String(paper.sortpubdate ?? '').slice(0, 10).replace(/\//g, '-') || null,
      text: `${/^retraction/i.test(paper.title ?? '') ? '【撤稿】' : ''}${paper.fulljournalname ?? paper.source ?? ''}：${paper.title ?? ''}`,
      url: `https://pubmed.ncbi.nlm.nih.gov/${paper.uid}/`, id: paper.uid,
    }))
    const section = listSection(`论文（PubMed，作者单位含公司名，共 ${total} 篇，列最新的）`, rows, 'PubMed', MAX_LIST, since)
    return { ...section, count: total }
  })

  const ordered = SOURCE_KEYS.map(key => sections.find(section => section.key === key)).filter(Boolean)
  const { text, links } = render(ordered, { names, since, today })
  return { text, links, counts, errors, since, names }
}

// ------------------------------------------------------------------ pieces

function isoDay(value) {
  const s = String(value ?? '')
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s.slice(0, 10) || null
}

function clip(value, max) {
  const s = String(value ?? '').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Rows deduplicated by id, newest first, as one section; rows dated before `since` are dropped whatever the service returned. */
function listSection(title, rows, label, max, since) {
  const seen = new Set()
  const unique = rows.filter(row => !(row.date && row.date < since) && !seen.has(row.id) && seen.add(row.id))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
  const shown = unique.slice(0, max)
  return {
    title,
    lines: shown.map(row => `- ${row.date ?? '日期不明'} ${row.text} ${row.url}`),
    links: shown.map(row => ({ url: row.url, title: row.title ?? clip(row.text, 160), date: row.date, label })),
    count: unique.length,
  }
}

function decode(value) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
}

/** Items of an RSS feed. */
export function rssItems(xml) {
  return [...String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const tag = name => decode(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(body)?.[1] ?? '')
    const date = new Date(tag('pubDate'))
    const source = tag('source')
    let title = tag('title')
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3))
    return { title, url: tag('link'), date: Number.isNaN(+date) ? null : date.toISOString().slice(0, 10), source }
  }).filter(item => item.url)
}

/**
 * The material as prompt text within MAX_MATERIAL_CHARS. When too long, lines
 * are dropped from the end of the lowest sections first (papers, then news,
 * and so on), and only links still shown are returned.
 */
function render(sections, { names, since, today }) {
  if (sections.length === 0) return { text: '', links: [] }
  const head = `一手材料：循迹在 ${today} 直接从公开数据源按「${names.join('」「')}」检索，范围是 ${since} 以来。这些是原始记录和线索，不是结论；名字相近的别家公司也可能混进来，引用前先确认是同一家。`
  const size = () => head.length + sections.reduce((sum, s) => sum + s.title.length + 4 + s.lines.reduce((n, line) => n + line.length + 1, 0), 0)
  const dropped = new Map()
  for (let i = sections.length - 1; i >= 0 && size() > MAX_MATERIAL_CHARS; i -= 1) {
    const section = sections[i]
    while (section.lines.length > 1 && size() > MAX_MATERIAL_CHARS) {
      section.lines.pop()
      dropped.set(section.key, (dropped.get(section.key) ?? 0) + 1)
    }
  }
  const parts = [head]
  const links = []
  for (const section of sections) {
    const more = dropped.get(section.key)
    parts.push('', `## ${section.title}`, ...section.lines, ...more ? [`- （篇幅所限，另有 ${more} 行没有列出）`] : [])
    const text = section.lines.join('\n')
    for (const link of section.links ?? []) if (text.includes(link.url)) links.push(link)
  }
  return { text: parts.join('\n'), links }
}
