// The primary-material module against a fake network. Never reaches a real site.
// Run: npm test
import assert from 'node:assert/strict'
import { detectHealth, gatherMaterial, searchNamesOf, sourcesOf, rssItems, MAX_MATERIAL_CHARS } from '../sources.js'
import { makeWeb, ACME_NEWS, ACME_510K } from './fake-web.mjs'

globalThis.fetch = () => { throw new Error('a test tried to reach the network') }
const sleep = async () => {}

// ---------------------------------------------------------------- small pieces
{
  assert.deepEqual(searchNamesOf('', 'Initech AI (INTC)'), ['Initech AI'], 'the ticker in parentheses is not searched')
  assert.deepEqual(searchNamesOf('', 'Initech AI, Inc.'), ['Initech AI'])
  assert.deepEqual(searchNamesOf('', 'Globex Corporation（GLBX）'), ['Globex'])
  assert.deepEqual(searchNamesOf('Initech AI | Initech Labs', 'Initech AI (INTC)'), ['Initech AI', 'Initech Labs'], 'the reader\'s names win')
  assert.deepEqual(searchNamesOf('', ''), [])
  assert.deepEqual(sourcesOf({}), { fda: false, trials: false, news: true, papers: false }, 'only news until the healthcare check says otherwise')
  assert.deepEqual(sourcesOf({ health: 1 }), { fda: true, trials: true, news: true, papers: true })
  assert.equal(sourcesOf({ health: 1, sources: '{"papers":false}' }).papers, false, 'the reader\'s switch wins')
  assert.equal(sourcesOf({ health: 0, sources: '{"trials":true}' }).trials, true)
  console.log('sources pieces: ok')
}

// ---------------------------------------------------------------- RSS
{
  const items = rssItems('<rss><item><title>A &amp; B - Wire</title><link>https://x.example/a</link><pubDate>Mon, 19 Oct 2026 14:00:00 GMT</pubDate><source url="u">Wire</source></item></rss>')
  assert.deepEqual(items, [{ title: 'A & B', url: 'https://x.example/a', date: '2026-10-19', source: 'Wire' }])
  console.log('rss: ok')
}

// ---------------------------------------------------------------- healthcare check
{
  const web = makeWeb()
  assert.equal(await detectHealth({ fetch: web.fetch, names: ['Acme Robotics'], sleep }), true)
  assert.ok(web.requests.every(r => r.ua === 'dsh-thesis-trail'), 'requests carry only the plugin name')
  const none = makeWeb()
  none.noHealth = true
  assert.equal(await detectHealth({ fetch: none.fetch, names: ['Acme Robotics'], sleep }), false)
  const down = makeWeb()
  down.fail.add('fda')
  down.fail.add('trials')
  assert.equal(await detectHealth({ fetch: down.fetch, names: ['Acme Robotics'], sleep }), null, 'no answer is not a no')
  console.log('healthcare check: ok')
}

// ---------------------------------------------------------------- gathering
const acmeBoard = { title: 'Acme Robotics (ACME)', health: 1 }
{
  const web = makeWeb()
  const m = await gatherMaterial({ fetch: web.fetch, board: acmeBoard, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.deepEqual(m.errors, {})
  assert.deepEqual(m.counts, { fda: 1, trials: 1, news: 1, papers: 1 })
  assert.deepEqual(m.names, ['Acme Robotics'])
  const text = m.text
  assert.ok(text.startsWith('一手材料：循迹在 2026-11-15 直接从公开数据源按「Acme Robotics」检索'), text.slice(0, 80))
  assert.ok(text.includes('510(k) K261234 Acme Surgical Arm'))
  assert.ok(text.includes('NCT07000000 RECRUITING 干预性'))
  assert.ok(text.includes('Example Wire：Acme Robotics wins Globex supply deal'))
  assert.ok(!text.includes('Old Paper'), 'news before the window is left out')
  assert.ok(text.includes('Journal of Robotic Surgery：Robotic arm accuracy'))
  assert.ok(web.requests.every(r => r.ua === 'dsh-thesis-trail'))
  // Every link the prompt shows is allowed as evidence, with a fixed source name.
  const byUrl = new Map(m.links.map(link => [link.url, link]))
  assert.equal(byUrl.get(ACME_NEWS)?.label, 'Google News')
  assert.equal(byUrl.get(ACME_510K)?.label, 'FDA')
  assert.ok(m.links.every(link => text.includes(link.url)), 'no link that the prompt does not show')
  assert.ok([...text.matchAll(/https:\/\/\S+/g)].every(([url]) => byUrl.has(url)), 'every link shown is allowed')
  console.log('gathering: ok')
}

// ---------------------------------------------------------------- failures, switches, window, budget
{
  const failing = makeWeb()
  failing.fail.add('news')
  const partial = await gatherMaterial({ fetch: failing.fetch, board: acmeBoard, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.equal(partial.errors.news, 'http_500')
  assert.ok(partial.text.includes('Acme Surgical Arm'), 'one source down does not stop the others')

  const off = makeWeb()
  const switched = await gatherMaterial({ fetch: off.fetch, board: { ...acmeBoard, sources: '{"news":false}' }, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.ok(!switched.text.includes('Example Wire'), 'a switched-off source is left out')
  assert.ok(!off.requests.some(r => r.url.includes('news.google.com')), 'and not fetched')

  const recent = await gatherMaterial({ fetch: makeWeb().fetch, board: acmeBoard, since: '2026-10-01', today: '2026-11-15', sleep })
  assert.ok(!recent.text.includes('K261234') && !recent.text.includes('Robotic arm accuracy'), 'rows dated before the window are dropped even when a service returns them')
  assert.ok(recent.text.includes('NCT07000000'), 'a trial updated inside the window stays')

  const tech = await gatherMaterial({ fetch: makeWeb().fetch, board: { ...acmeBoard, health: 0 }, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.ok(!tech.text.includes('FDA') && !tech.text.includes('临床试验'), 'no health sources for a company outside healthcare')
  assert.ok(tech.text.includes('Example Wire'), 'news still runs')

  const nameless = await gatherMaterial({ fetch: makeWeb().fetch, board: { title: '' }, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.equal(nameless.text, '', 'nothing to search, nothing gathered')

  const crowded = makeWeb()
  crowded.longNews = true
  const long = await gatherMaterial({ fetch: crowded.fetch, board: acmeBoard, since: '2026-01-01', today: '2026-11-15', sleep })
  assert.ok(long.text.length <= MAX_MATERIAL_CHARS + 400, `material stays near the budget (${long.text.length})`)
  assert.ok(long.text.includes('篇幅所限'), 'what was cut is said')
  assert.ok(long.text.includes('Acme Surgical Arm'), 'FDA comes first and survives')
  assert.ok(long.links.every(link => long.text.includes(link.url)), 'links of cut lines are not allowed')
  console.log('failures, switches, window, budget: ok')
}

console.log('OK')
