// A fake of the public sources for the fictional Acme Robotics, shaped like the
// real responses. `requests` records every URL and User-Agent; `fail` makes a
// source answer with an HTTP error; `longNews` returns thirty very long
// headlines to overflow the material budget; `noHealth` makes FDA and
// ClinicalTrials.gov know nothing of the company.

const NEWS_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Acme Robotics wins Globex supply deal - Example Wire</title><link>https://news.google.com/rss/articles/acme-globex</link><pubDate>Mon, 19 Oct 2026 14:00:00 GMT</pubDate><source url="https://wire.example.com">Example Wire</source></item>
<item><title>Acme Robotics two years ago - Old Paper</title><link>https://news.google.com/rss/articles/acme-old</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><source url="https://old.example.com">Old Paper</source></item>
</channel></rss>`

export const ACME_NEWS = 'https://news.google.com/rss/articles/acme-globex'
export const ACME_510K = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K261234'

export function makeWeb() {
  const web = {
    requests: [],
    fail: new Set(),
    longNews: false,
    noHealth: false,
    async fetch(url, init = {}) {
      const href = String(url)
      web.requests.push({ url: href, ua: init.headers?.['user-agent'] ?? '' })
      const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
      const source = href.includes('api.fda.gov') ? 'fda' : href.includes('clinicaltrials.gov') ? 'trials'
        : href.includes('news.google.com') ? 'news' : href.includes('ncbi.nlm.nih.gov') ? 'papers' : 'other'
      if (web.fail.has(source)) return new Response('down', { status: 500 })
      if (href.startsWith('https://api.fda.gov/device/510k.json')) {
        if (web.noHealth) return new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })
        return json({ results: [{ k_number: 'K261234', device_name: 'Acme Surgical Arm', applicant: 'Acme Robotics, Inc.', decision_date: '20260915', decision_description: 'Substantially Equivalent' }] })
      }
      if (href.startsWith('https://api.fda.gov/device/pma.json')) return new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })
      if (href.startsWith('https://clinicaltrials.gov/api/v2/studies')) {
        const count = web.noHealth ? 0 : 1
        return json({ studies: Array.from({ length: count }, (_, i) => ({ protocolSection: {
          identificationModule: { nctId: `NCT0700000${i}`, briefTitle: 'Robot-Assisted Versus Manual Knee Surgery' },
          statusModule: { overallStatus: 'RECRUITING', lastUpdatePostDateStruct: { date: `2026-10-${String(10 + i).padStart(2, '0')}` } },
          designModule: { studyType: 'INTERVENTIONAL' },
          sponsorCollaboratorsModule: { leadSponsor: { name: 'Acme Robotics' } },
          outcomesModule: { primaryOutcomes: [{ measure: 'Revision rate at 2 years' }] },
        } })) })
      }
      if (href.startsWith('https://news.google.com/rss/search')) {
        if (!web.longNews) return new Response(NEWS_RSS, { status: 200 })
        const items = Array.from({ length: 30 }, (_, i) => `<item><title>Acme story ${i} ${'x'.repeat(1000)}</title><link>https://news.google.com/rss/articles/acme-${i}</link><pubDate>Mon, ${String(i % 28 + 1).padStart(2, '0')} Oct 2026 10:00:00 GMT</pubDate></item>`)
        return new Response(`<rss><channel>${items.join('')}</channel></rss>`, { status: 200 })
      }
      if (href.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')) return json({ esearchresult: { count: '1', idlist: ['111'] } })
      if (href.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi')) {
        return json({ result: { uids: ['111'], 111: { uid: '111', title: 'Robotic arm accuracy in knee replacement', fulljournalname: 'Journal of Robotic Surgery', sortpubdate: '2026/09/30 00:00' } } })
      }
      return new Response('not found', { status: 404 })
    },
  }
  return web
}
