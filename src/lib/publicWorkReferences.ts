import type { PublicWorkRecord } from './publicRelease'

export type WorkReference = { number: number; url: string; title: string; purpose: string; usages: string[]; tier?: string }

export function referencePurpose(value: string): string {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase()
    if (host === 'store.steampowered.com' && /^\/app\/\d+(?:\/|$)/.test(url.pathname)) return '购买 / 游玩 · Steam'
    if (host.endsWith('.itch.io') && /^\/[^/]+/.test(url.pathname)) return '游玩 / 获取 · itch.io'
    if ((host === 'www.dlsite.com' || host === 'dlsite.com') && /\/product_id\//.test(url.pathname)) return '购买 / 获取 · DLsite'
    if (['www.kadokawa.co.jp', 'data.ichijinsha.co.jp', 'www.shueisha.co.jp'].includes(host)) return '出版方资料 / 获取信息'
    return '资料来源'
  } catch { return '资料来源' }
}

export function collectWorkReferences(work: PublicWorkRecord): WorkReference[] {
  const references = new Map<string, WorkReference>()
  function add(value: string | undefined, title: string, usage: string) {
    const url = value?.trim()
    if (!url) return
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return
    } catch { return }
    const previous = references.get(url)
    if (previous) {
      if (usage && !previous.usages.includes(usage)) previous.usages.push(usage)
    } else {
      references.set(url, { number: references.size + 1, url, title: title.trim() || '作品资料',
        purpose: referencePurpose(url), usages: usage ? [usage] : [] })
    }
  }
  for (const source of work.sources) {
    add(source.url, source.title, '')
    const reference = references.get(source.url.trim())
    if (reference && source.tier) reference.tier = source.tier
  }
  add(work.rating.evidenceUrl, '评级依据页面', '评级依据')
  add(work.summary?.sourceUrl, '简介来源', '作品介绍')
  for (const credit of [...work.creators, ...work.organizations]) {
    for (const url of [credit.sourceUrl, ...(credit.sourceUrls || [])]) add(url, `${credit.name} · 署名依据`, `${credit.name}（${credit.role}）`)
  }
  return [...references.values()]
}
