import fs from 'node:fs/promises'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))

const BASE = 'https://www.yurizukan.com'
const START_PATHS = [
  '/',
  '/comic',
  '/novel',
  '/anime',
  '/game',
  '/articles/new',
  '/articles/popular',
  '/articles/new-publications',
]

const outDir = args['out-dir'] || 'data_local/raw/yurizukan'
const candidatesFile = args.out || 'data_local/candidates/yurizukan-works.candidates.jsonl'
const reportFile = args.report || 'data_local/reports/yurizukan-gap-report.md'
const payloadUrl = args['payload-url'] || process.env.PAYLOAD_URL || 'http://127.0.0.1:3000'
const maxDetail = Number(args['max-detail'] || 120)
const delayMs = Number(args['delay-ms'] || 400)

await fs.mkdir(outDir, { recursive: true })
await fs.mkdir(path.dirname(candidatesFile), { recursive: true })
await fs.mkdir(path.dirname(reportFile), { recursive: true })

const seenUrls = new Set()
const detailUrls = new Set()

console.log('Yurizukan probe')
console.log(JSON.stringify({ BASE, START_PATHS, maxDetail, delayMs, payloadUrl }, null, 2))

for (const p of START_PATHS) {
  const url = new URL(p, BASE).toString()
  await crawlListPage(url)
  await sleep(delayMs)
}

const detailList = [...detailUrls].slice(0, maxDetail)
console.log(`Found ${detailUrls.size} detail URL(s); probing ${detailList.length}.`)

const candidates = []
for (const [index, url] of detailList.entries()) {
  if (index === 0 || (index + 1) % 10 === 0 || index + 1 === detailList.length) {
    console.log(`detail progress: ${index + 1}/${detailList.length} ${url}`)
  }

  try {
    const html = await fetchText(url)
    const candidate = extractDetail(url, html)
    if (candidate?.title) {
      candidates.push(finalizeCandidate(candidate))
    }
    await fs.writeFile(path.join(outDir, safeFileName(url) + '.html'), html, 'utf8')
  } catch (err) {
    console.error(`detail failed: ${url}: ${err.message}`)
  }
  await sleep(delayMs)
}

const unique = dedupeBy(candidates, c => c.yurizukanId || c.sourceUrl)
await fs.writeFile(candidatesFile, unique.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8')

const existing = await loadExistingWorks()
const matchReport = matchCandidates(unique, existing)

await fs.writeFile(reportFile, renderReport(unique, matchReport), 'utf8')

console.log(`Wrote candidates -> ${candidatesFile}`)
console.log(`Wrote report -> ${reportFile}`)
console.log(JSON.stringify({
  candidates: unique.length,
  existingWorks: existing.length,
  matchedExact: matchReport.matchedExact.length,
  matchedLoose: matchReport.matchedLoose.length,
  ambiguous: matchReport.ambiguous.length,
  newCandidates: matchReport.newCandidates.length,
}, null, 2))

async function crawlListPage(url) {
  if (seenUrls.has(url)) return
  seenUrls.add(url)

  try {
    const html = await fetchText(url)
    await fs.writeFile(path.join(outDir, safeFileName(url) + '.html'), html, 'utf8')

    for (const link of extractLinks(html)) {
      if (!link.href) continue
      const abs = new URL(link.href, BASE).toString()
      const u = new URL(abs)

      if (u.hostname !== 'www.yurizukan.com') continue

      if (/\/articles\/articleDetail\/\d+/.test(u.pathname)) {
        detailUrls.add(u.toString())
      }

      if (
        detailUrls.size < maxDetail &&
        ['/comic', '/novel', '/anime', '/game', '/articles/new', '/articles/popular', '/articles/new-publications'].includes(u.pathname)
      ) {
        // keep first pass small; no recursive pagination yet
      }
    }
  } catch (err) {
    console.error(`list failed: ${url}: ${err.message}`)
  }
}

async function fetchText(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  let res
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Baihepailei local metadata probe; low-rate; contact: local-dev',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return await res.text()
}

function extractDetail(url, html) {
  const text = htmlToText(html)
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
  const title = cleanTitle(
    firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)?.replace(/\s*\|\s*百合図鑑\s*$/, '')
  )

  const yurizukanId = new URL(url).pathname.match(/articleDetail\/(\d+)/)?.[1] || null

  const compactText = makeCompactText(html)
  const media = extractMedia(compactText)
  const creatorPublisher = extractCreatorPublisher(title, compactText)

  const relationTags = extractKnownSectionTags(compactText, '関係性')
  const peopleTags = extractKnownSectionTags(compactText, '人物')
  const settingTags = extractKnownSectionTags(compactText, '舞台')
  const genreTags = extractKnownSectionTags(compactText, 'ジャンル')
  const otherTags = extractKnownSectionTags(compactText, 'その他')

  const externalLinks = normalizeExternalLinks(extractLinks(html))

  return {
    source: 'yurizukan',
    sourceUrl: url,
    yurizukanId,
    title,
    normalizedTitle: normalizeTitle(title),
    mediaType: mapMedia(media),
    yurizukanMedia: media || null,
    creatorPublisher,
    tags: {
      relation: relationTags,
      people: peopleTags,
      setting: settingTags,
      genre: genreTags,
      other: otherTags,
    },
    externalLinks,
    fetchedAt: new Date().toISOString(),
  }
}

function finalizeCandidate(candidate) {
  const cleanArray = arr => [...new Set((arr || []).map(x => cleanDisplayText(x)).filter(Boolean))]

  return {
    ...candidate,
    title: cleanDisplayText(candidate.title),
    creatorPublisher: candidate.creatorPublisher ? cleanDisplayText(candidate.creatorPublisher) : candidate.creatorPublisher,
    tags: {
      relation: cleanArray(candidate.tags?.relation),
      people: cleanArray(candidate.tags?.people),
      setting: cleanArray(candidate.tags?.setting),
      genre: cleanArray(candidate.tags?.genre),
      other: cleanArray(candidate.tags?.other),
    },
    externalLinks: (candidate.externalLinks || []).map(link => ({
      ...link,
      text: cleanDisplayText(link.text),
    })),
  }
}

function cleanDisplayText(s) {
  return String(s || '')
    .replace(/[\u00a0\u2000-\u200b\u202f\u3000]/g, ' ')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤Ａ-Ｚａ-ｚ０-９])\s+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤Ａ-Ｚａ-ｚ０-９])/gu, '$1$2')
    .replace(/\s+([）】』」!?！？。．、，])/g, '$1')
    .replace(/([（【『「])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractLinks(html) {
  const links = []
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = re.exec(html))) {
    const href = decodeHtml(m[1])
    const text = cleanText(m[2])
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue
    links.push({ href, text })
  }
  return links
}

async function loadExistingWorks() {
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (!email || !password) {
    console.warn('PAYLOAD_SEED_EMAIL / PAYLOAD_SEED_PASSWORD not set; skip DB matching.')
    return []
  }

  const login = await fetch(`${payloadUrl}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!login.ok) {
    console.warn(`Payload login failed: ${login.status} ${login.statusText}; skip DB matching.`)
    return []
  }

  const token = (await login.json()).token
  const all = []
  let page = 1

  while (true) {
    const url = `${payloadUrl}/api/works?limit=200&page=${page}&depth=0&draft=true`
    const res = await fetch(url, { headers: { Authorization: `JWT ${token}` } })
    if (!res.ok) throw new Error(`works fetch failed: ${res.status} ${res.statusText}`)
    const json = await res.json()
    all.push(...(json.docs || []))
    if (!json.hasNextPage) break
    page += 1
  }

  return all.map(w => ({
    id: w.id,
    title: w.title || '',
    originalTitle: w.originalTitle || w.original_title || '',
    mediaType: w.mediaType || w.media_type || '',
    slug: w.slug || '',
    siteId: w.siteId || w.site_id || '',
    bangumiSubjectId: w.externalIds?.bangumiSubjectId || w.external_ids_bangumi_subject_id || '',
    normalizedTitle: normalizeTitle(w.title || ''),
    normalizedOriginalTitle: normalizeTitle(w.originalTitle || w.original_title || ''),
  }))
}

function matchCandidates(candidates, existing) {
  const byExactTitle = new Map()
  const byNormTitle = new Map()

  for (const w of existing) {
    addMap(byExactTitle, w.title, w)
    addMap(byNormTitle, w.normalizedTitle, w)
    if (w.originalTitle) addMap(byExactTitle, w.originalTitle, w)
    if (w.normalizedOriginalTitle) addMap(byNormTitle, w.normalizedOriginalTitle, w)
  }

  const matchedExact = []
  const matchedLoose = []
  const ambiguous = []
  const newCandidates = []

  for (const c of candidates) {
    const exact = byExactTitle.get(c.title) || []
    const loose = byNormTitle.get(c.normalizedTitle) || []

    if (exact.length === 1) {
      matchedExact.push({ candidate: c, work: exact[0] })
    } else if (exact.length > 1) {
      ambiguous.push({ candidate: c, matches: exact, reason: 'exactTitleMultiple' })
    } else if (loose.length === 1) {
      matchedLoose.push({ candidate: c, work: loose[0] })
    } else if (loose.length > 1) {
      ambiguous.push({ candidate: c, matches: loose, reason: 'looseTitleMultiple' })
    } else {
      newCandidates.push(c)
    }
  }

  return { matchedExact, matchedLoose, ambiguous, newCandidates }
}

function renderReport(candidates, r) {
  const mediaCounts = groupCount(candidates, c => c.mediaType || 'unknown')
  const tagCounts = groupCount(candidates.flatMap(c => Object.values(c.tags || {}).flat()), x => x)

  return [
    '# Yurizukan gap report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `- candidates: ${candidates.length}`,
    `- matchedExact: ${r.matchedExact.length}`,
    `- matchedLoose: ${r.matchedLoose.length}`,
    `- ambiguous: ${r.ambiguous.length}`,
    `- newCandidates: ${r.newCandidates.length}`,
    '',
    '## Media counts',
    '',
    table(['mediaType', 'count'], [...mediaCounts.entries()].sort((a, b) => b[1] - a[1])),
    '',
    '## Top tags',
    '',
    table(['tag', 'count'], [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)),
    '',
    '## New candidates sample',
    '',
    table(['mediaType', 'title', 'sourceUrl'], r.newCandidates.slice(0, 80).map(c => [c.mediaType, c.title, c.sourceUrl])),
    '',
    '## Ambiguous sample',
    '',
    table(['title', 'reason', 'matches'], r.ambiguous.slice(0, 50).map(x => [
      x.candidate.title,
      x.reason,
      x.matches.map(m => `${m.id}:${m.title}:${m.mediaType}`).join('<br>'),
    ])),
    '',
  ].join('\n')
}

function table(headers, rows) {
  const body = rows.map(r => Array.isArray(r) ? r : [r[0], r[1]])
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map(r => `| ${r.map(v => String(v ?? '').replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n')
}

function groupCount(items, fn) {
  const m = new Map()
  for (const item of items) {
    const k = fn(item)
    if (!k) continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

function addMap(map, key, value) {
  if (!key || !value) return
  const arr = map.get(key) || []
  if (!arr.some(x => String(x.id) === String(value.id))) {
    arr.push(value)
  }
  map.set(key, arr)
}

function pickAfter(lines, marker, candidates) {
  const i = lines.findIndex(l => l === marker)
  if (i < 0) return null
  for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
    if (candidates.includes(lines[j])) return lines[j]
  }
  return null
}

function pickSection(lines, marker) {
  const stop = new Set(['関係性', '人物', '舞台', 'ジャンル', 'その他', '媒体', '出版形式', '気になる', '履修済み', '好き!', 'リンク切れを報告'])
  const i = lines.findIndex(l => l === marker)
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length; j++) {
    if (stop.has(lines[j])) break
    if (out.length >= 20) break
    if (!/^\d+$/.test(lines[j])) out.push(lines[j])
  }
  return out
}

function mapMedia(media) {
  if (media === '漫画') return 'manga'
  if (media === '小説') return 'novel'
  if (media === 'アニメ') return 'anime'
  if (media === 'ゲーム') return 'game'
  return 'unknown'
}

function normalizeTitle(s) {
  return stripVolumeSuffix(toHalfWidthForCompare(cleanTitle(s)))
    .replace(/^gl\s+/i, '')
    .replace(/^new!\s+/i, '')
    .replace(/[・·]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function cleanTitle(s) {
  return collapseJapaneseSpacing(cleanText(s || '')
    .replace(/\s*\|\s*百合図鑑\s*$/, '')
    .replace(/^GL\s+/, '')
    .replace(/^New!\s+/, '')
    .trim())
}

function htmlToText(html) {
  return collapseJapaneseSpacing(decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h1|h2|h3|li|dt|dd|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n'))
}

function cleanText(s) {
  return collapseJapaneseSpacing(decodeHtml(String(s || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim())
}

const SECTION_MARKERS = ['関係性', '人物', '舞台', 'ジャンル', 'その他', '媒体', '出版形式', '気になる', '履修済み', '好き!', 'Amazonで試し読み', 'DMMで試し読み']

const TAG_LEXICON = {
  関係性: [
    'GL', '同級生', '幼馴染', 'おねロリ', '先輩×後輩', '年の差', '先生×生徒',
    'スール・擬似姉妹', '実姉妹', '義理姉妹', '家族・親戚', '三角関係',
    '依存', '主従', '身分差', 'バディ', 'ライバル・敵', '不仲',
    '片想い', '両片想い', '立場逆転', '推し', '元カノ'
  ],
  人物: [
    '小学生', '中学生', '高校生', '大学生・専門学生', '社会人', '先生',
    '優等生', '地味子', 'ギャル', 'お嬢様', 'ヤンキー', 'ツンデレ',
    'イケメン女子', 'アイドル・芸能人', 'ケモ耳', 'アラフォー以上'
  ],
  舞台: [
    'クラス', '生徒会', '部活', '同棲・同居', '異世界'
  ],
  ジャンル: [
    'ピュア', 'ほのぼの', 'コメディ', '青春', '切ない', 'シリアス',
    'ファンタジー', '戦闘', 'えっち'
  ],
  その他: [
    '性的描写', '男性出演', '男性とキス以上', '百合がメインじゃない',
    '商業', '完結', 'オムニバス', '一巻完結', 'ライトノベル', '短編集'
  ]
}

function getSectionMarkers() {
  return ['関係性', '人物', '舞台', 'ジャンル', 'その他', '媒体', '出版形式', '気になる', '履修済み', '好き!', 'Amazonで試し読み', 'DMMで試し読み']
}

function getTagLexicon() {
  return {
    関係性: [
      'GL', '同級生', '幼馴染', 'おねロリ', '先輩×後輩', '年の差', '先生×生徒',
      'スール・擬似姉妹', '実姉妹', '義理姉妹', '家族・親戚', '三角関係',
      '依存', '主従', '身分差', 'バディ', 'ライバル・敵', '不仲',
      '片想い', '両片想い', '立場逆転', '推し', '元カノ'
    ],
    人物: [
      '小学生', '中学生', '高校生', '大学生・専門学生', '社会人', '先生',
      '優等生', '地味子', 'ギャル', 'お嬢様', 'ヤンキー', 'ツンデレ',
      'イケメン女子', 'アイドル・芸能人', 'ケモ耳', 'アラフォー以上'
    ],
    舞台: [
      'クラス', '生徒会', '部活', '同棲・同居', '異世界'
    ],
    ジャンル: [
      'ピュア', 'ほのぼの', 'コメディ', '青春', '切ない', 'シリアス',
      'ファンタジー', '戦闘', 'えっち'
    ],
    その他: [
      '性的描写', '男性出演', '男性とキス以上', '百合がメインじゃない',
      '商業', '完結', 'オムニバス', '一巻完結', 'ライトノベル', '短編集'
    ]
  }
}

function makeCompactText(html) {
  return collapseJapaneseSpacing(htmlToText(html))
    .replace(/\s+/g, '')
    .replace(/クラ\s*ス/g, 'クラス')
    .replace(/ライト\s*ノベル/g, 'ライトノベル')
}

function extractMedia(compactText) {
  const m = compactText.match(/媒体(漫画|小説|アニメ|ゲーム)/)
  return m ? m[1] : null
}

function extractCreatorPublisher(title, compactText) {
  const clean = normalizeTitle(title)
  const candidates = ['小学館', '芳文社', 'KADOKAWA', '一迅社', '講談社', '集英社', '白泉社', '秋田書店', '双葉社', 'スクウェア・エニックス', 'キルタイムコミュニケーション']
  return candidates.find(x => compactText.includes(x)) || null
}

function extractKnownSectionTags(compactText, marker) {
  const section = sectionText(compactText, marker)
  if (!section) return []

  const lexicon = getTagLexicon()[marker] || []
  const hits = []

  for (const tag of lexicon) {
    if (section.includes(tag)) hits.push(tag)
  }

  return hits
}

function sectionText(compactText, marker) {
  const start = compactText.indexOf(marker)
  if (start < 0) return ''

  let end = compactText.length
  for (const stop of getSectionMarkers()) {
    if (stop === marker) continue
    const pos = compactText.indexOf(stop, start + marker.length)
    if (pos >= 0 && pos < end) end = pos
  }

  return compactText.slice(start + marker.length, end)
}

function normalizeExternalLinks(links) {
  const seen = new Set()
  const out = []
  const hostCount = new Map()

  for (const a of links || []) {
    let url
    try {
      url = new URL(a.href, BASE).toString()
    } catch {
      continue
    }

    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')

    if (host === 'yurizukan.com') continue
    if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') continue

    const normalizedUrl = stripAffiliateNoise(u)
    const key = normalizedUrl.toString()
    if (seen.has(key)) continue

    const currentHostCount = hostCount.get(host) || 0
    const isCommerce = host.includes('amazon.') || host === 'al.dmm.com' || host === 'book.dmm.com'

    if (isCommerce && currentHostCount >= 2) continue
    if (!isCommerce && currentHostCount >= 3) continue

    seen.add(key)
    hostCount.set(host, currentHostCount + 1)

    const text = cleanText(a.text)
    out.push({ text, url: key })

    if (out.length >= 8) break
  }

  return out
}

function stripAffiliateNoise(u) {
  const x = new URL(u.toString())

  for (const key of [...x.searchParams.keys()]) {
    if (['tag', 'linkCode', 'linkId', 'language', 'ref_', 'af_id', 'ch', 'ch_id', 'dmmref', 'i3_ref', 'i3_ord'].includes(key)) {
      x.searchParams.delete(key)
    }
  }

  return x
}

function toHalfWidthForCompare(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[！!]/g, '!')
    .replace(/[？?]/g, '?')
    .replace(/[：:]/g, ':')
    .replace(/[〜～]/g, '~')
    .replace(/[（）]/g, m => m === '（' ? '(' : ')')
    .trim()
}

function stripVolumeSuffix(s) {
  let x = String(s || '').trim()

  const patterns = [
    /\s*(?:第)?\d+巻$/i,
    /\s*\(\d+\)$/i,
    /\s*\[\d+\]$/i,
    /\s*:\s*\d+$/i,
    /\s*(?:vol\.?|volume)\s*\d+$/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const p of patterns) {
      const y = x.replace(p, '').trim()
      if (y !== x && y.length >= 2) {
        x = y
        changed = true
      }
    }
  }

  return x
}

function collapseJapaneseSpacing(s) {
  return String(s || '')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤])\s+([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〤])/gu, '$1$2')
    .replace(/\s+([）】』」!?！？。．、，])/g, '$1')
    .replace(/([（【『「])\s+/g, '$1')
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function firstMatch(s, re) {
  const m = s.match(re)
  return m ? cleanText(m[1]) : null
}

function dedupeBy(items, fn) {
  const m = new Map()
  for (const item of items) {
    const k = fn(item)
    if (!m.has(k)) m.set(k, item)
  }
  return [...m.values()]
}

function safeFileName(url) {
  return new URL(url).pathname.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'home'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    }
  }
  return out
}
