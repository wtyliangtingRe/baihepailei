#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'work-duplicates-cross-language-audit-v0.1'
const DEFAULT_OUT_DIR = 'data_local/staging/work-duplicates-cross-language'
const PAGE_LIMIT = 200
const MAX_TOKEN_FREQUENCY = 12
const MIN_SCORE = 6
const ENV_FILES = ['.env.local', '.env']
const STOPWORDS = new Set([
  'about', 'after', 'again', 'anime', 'another', 'before', 'black', 'blue', 'chronicles',
  'episode', 'first', 'flower', 'game', 'girl', 'girls', 'heart', 'hero', 'light', 'little',
  'love', 'manga', 'novel', 'official', 'online', 'project', 'red', 'season', 'second',
  'special', 'story', 'sweet', 'white', 'world', 'yuri',
])

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function loadDotenv() {
  for (const file of ENV_FILES) {
    const full = path.resolve(process.cwd(), file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u)
      if (!match || process.env[match[1]]) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[match[1]] = value
    }
  }
}

function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, ' ')
    .trim()
}

function normalizeTitle(value) {
  return cleanLine(value)
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[\-‐‑‒–—―~〜～・:：;；,，.。!！?？'"“”‘’「」『』【】\[\]（）()<>＜＞]/gu, '')
}

function searchLines(value) {
  return val(value).split(/[\r\n|]+/u).map(cleanLine).filter(Boolean)
}

function usefulTitleLine(line) {
  if (!line || line.length > 120) return false
  if (/^https?:\/\//iu.test(line)) return false
  if (/^(bangumi|anilist|vndb|steam|wikidata|yurizukan|mal)(:|$)/iu.test(line)) return false
  if (/^[a-z]+[A-Za-z]*Id:\s*\w+/u.test(line)) return false
  if (/^\d+$/u.test(line)) return false
  return true
}

function titleValues(work) {
  const localized = list(work.localizedTitles).map((item) => typeof item === 'string' ? item : item?.title)
  const aliases = list(work.aliases).map((item) => typeof item === 'string' ? item : item?.value)
  const raw = [
    work.title,
    work.originalTitle,
    ...localized,
    ...aliases,
    ...searchLines(work.searchText).filter(usefulTitleLine),
  ]
  const seen = new Set()
  const output = []
  for (const item of raw) {
    const value = cleanLine(item)
    const key = normalizeTitle(value)
    if (!value || key.length < 2 || seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function latinTokens(work) {
  const tokens = new Set()
  for (const title of titleValues(work)) {
    for (const match of title.normalize('NFKC').matchAll(/[A-Za-z][A-Za-z0-9]{4,}/gu)) {
      const token = match[0].toLowerCase()
      if (token.length < 6 || STOPWORDS.has(token) || /^\d+$/u.test(token)) continue
      tokens.add(token)
    }
  }
  return [...tokens]
}

function hasCJK(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(cleanLine(value))
}

function isLatinOnly(value) {
  const text = cleanLine(value)
  return /[A-Za-z]/u.test(text) && !hasCJK(text)
}

function sourceFamily(work) {
  const explicit = val(work.chosenBaseSource || work.originalSource).toLowerCase()
  if (explicit) return explicit
  const ids = work.externalIds || {}
  if (val(ids.bangumiSubjectId)) return 'bangumi'
  if (val(ids.anilistMediaId)) return 'anilist'
  if (val(ids.vndbId)) return 'vndb'
  if (val(ids.wikidataQid)) return 'wikidata'
  if (val(ids.officialUrl)) return 'official'
  return 'unknown'
}

function sourceKeys(work) {
  const keys = []
  for (const [name, raw] of Object.entries(work.externalIds || {})) {
    const value = val(raw)
    if (value) keys.push(`${name}:${value}`)
  }
  for (const item of list(work.sourceLinks)) {
    const url = val(item?.url).replace(/\/+$/u, '')
    if (url) keys.push(`url:${url.toLowerCase()}`)
  }
  return [...new Set(keys)]
}

function yearOf(work) {
  const candidates = [work.firstPublishedLabel, work.firstPublishedAt]
  for (const raw of candidates) {
    const match = val(raw).match(/(?:^|\D)((?:18|19|20|21)\d{2})(?:\D|$)/u)
    if (match) return Number(match[1])
  }
  return null
}

function mediaCompatible(a, b) {
  const groupA = val(a.mediaGroup || 'unknown')
  const groupB = val(b.mediaGroup || 'unknown')
  if (groupA === 'unknown' || groupB === 'unknown' || groupA !== groupB) return false
  const typeA = val(a.mediaType || 'unknown')
  const typeB = val(b.mediaType || 'unknown')
  return typeA === typeB || typeA === 'unknown' || typeB === 'unknown'
}

function formatCompatible(a, b) {
  const formatA = val(a.format || 'unknown')
  const formatB = val(b.format || 'unknown')
  return formatA === formatB || formatA === 'unknown' || formatB === 'unknown'
}

function dateCompatibility(a, b) {
  const yearA = yearOf(a)
  const yearB = yearOf(b)
  if (yearA && yearB && Math.abs(yearA - yearB) > 1) return { compatible: false, score: 0, label: `${yearA} vs ${yearB}` }
  if (yearA && yearB) return { compatible: true, score: yearA === yearB ? 3 : 2, label: `${yearA} / ${yearB}` }
  return { compatible: true, score: 1, label: yearA || yearB ? String(yearA || yearB) : 'unknown' }
}

function alreadyMerged(work) {
  if (work.reviewStatus === 'deprecated') return true
  return /mergedIntoWorkId:\s*\d+/iu.test([work.searchText, work.evidenceNote, work.sourceConflictNotes].map(val).join('\n'))
}

function pairScore(a, b, sharedTokens, tokenFrequency) {
  const reasons = []
  const blockers = []
  let score = 0

  if (!mediaCompatible(a, b)) blockers.push('media_mismatch_or_unknown_group')
  if (!formatCompatible(a, b)) blockers.push('format_conflict')
  const date = dateCompatibility(a, b)
  if (!date.compatible) blockers.push(`date_conflict:${date.label}`)
  else {
    score += date.score
    reasons.push(`date_compatible:${date.label}`)
  }

  const familyA = sourceFamily(a)
  const familyB = sourceFamily(b)
  if (familyA !== familyB && familyA !== 'unknown' && familyB !== 'unknown') {
    score += 2
    reasons.push(`cross_source:${familyA}/${familyB}`)
  } else {
    blockers.push('not_confirmed_cross_source')
  }

  const mixedScriptDirection = (hasCJK(a.title) && isLatinOnly(b.title)) || (hasCJK(b.title) && isLatinOnly(a.title))
  if (mixedScriptDirection) {
    score += 2
    reasons.push('cjk_latin_title_pair')
  }

  for (const token of sharedTokens) {
    const frequency = tokenFrequency.get(token) || 0
    if (frequency > MAX_TOKEN_FREQUENCY) continue
    score += frequency <= 3 ? 3 : frequency <= 6 ? 2 : 1
    reasons.push(`shared_rare_latin_token:${token}:${frequency}`)
  }

  const normalizedA = new Set(titleValues(a).map(normalizeTitle))
  const exactAlias = titleValues(b).map(normalizeTitle).find((key) => normalizedA.has(key))
  if (exactAlias) {
    score += 4
    reasons.push(`exact_normalized_alias:${exactAlias}`)
  }

  const sourceOverlap = sourceKeys(a).filter((key) => sourceKeys(b).includes(key))
  if (sourceOverlap.length) {
    score += 5
    reasons.push(`shared_source_key:${sourceOverlap.slice(0, 3).join(',')}`)
  }

  if (alreadyMerged(a) || alreadyMerged(b)) blockers.push('already_merged_or_deprecated')
  return { score, reasons: [...new Set(reasons)], blockers: [...new Set(blockers)], date }
}

function compactWork(work) {
  return {
    id: work.id,
    title: val(work.title),
    originalTitle: val(work.originalTitle),
    titles: titleValues(work).slice(0, 30),
    sourceFamily: sourceFamily(work),
    sourceKeys: sourceKeys(work).slice(0, 30),
    mediaGroup: val(work.mediaGroup || 'unknown'),
    mediaType: val(work.mediaType || 'unknown'),
    format: val(work.format || 'unknown'),
    year: yearOf(work),
    status: val(work.status),
    reviewStatus: val(work.reviewStatus),
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 1000)}`)
  return payload
}

async function login(baseUrl) {
  const email = process.env.PAYLOAD_EXPORT_EMAIL || process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_EXPORT_PASSWORD || process.env.PAYLOAD_SEED_PASSWORD
  if (!email || !password) throw new Error('Missing Payload login env vars')
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login did not return a token')
  return result.token
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  do {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT), page: String(page), depth: '0', draft: 'true',
    })
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, {
      headers: { Authorization: `JWT ${token}` },
    })
    docs.push(...list(result?.docs))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)
  return docs
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function markdown(summary, rows) {
  const lines = [
    '# Cross-language Work Duplicate Audit v0.1', '',
    'Read-only review candidates. No Payload write, no PostgreSQL write, no merge and no deletion.', '',
    '## Summary', '',
    `- generatedAt: ${summary.generatedAt}`,
    `- worksRead: ${summary.worksRead}`,
    `- distinctLatinTokens: ${summary.distinctLatinTokens}`,
    `- candidatePairs: ${summary.candidatePairs}`, '',
    '## Candidates', '',
  ]
  for (const row of rows.slice(0, 300)) {
    lines.push(`### ${row.left.title} ↔ ${row.right.title}`)
    lines.push('')
    lines.push(`- pairKey: ${row.pairKey}`)
    lines.push(`- score: ${row.score}`)
    lines.push(`- sharedTokens: ${row.sharedTokens.join(', ')}`)
    lines.push(`- reasons: ${row.reasons.join('; ')}`)
    lines.push(`- left: #${row.left.id} ${row.left.sourceFamily} ${row.left.mediaGroup}/${row.left.mediaType} ${row.left.year || 'unknown'}`)
    lines.push(`- right: #${row.right.id} ${row.right.sourceFamily} ${row.right.mediaGroup}/${row.right.mediaType} ${row.right.year || 'unknown'}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  loadDotenv()
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = val(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const outDir = val(args['out-dir'] || DEFAULT_OUT_DIR)
  const focus = val(args.focus).toLowerCase()
  const token = await login(baseUrl)
  const works = await fetchAllWorks(baseUrl, token)

  const tokenToWorks = new Map()
  for (const work of works) {
    for (const tokenValue of latinTokens(work)) {
      if (!tokenToWorks.has(tokenValue)) tokenToWorks.set(tokenValue, [])
      tokenToWorks.get(tokenValue).push(work)
    }
  }

  const tokenFrequency = new Map([...tokenToWorks.entries()].map(([key, docs]) => [key, new Set(docs.map((doc) => String(doc.id))).size]))
  const pairTokens = new Map()
  for (const [tokenValue, docs] of tokenToWorks) {
    const unique = [...new Map(docs.map((doc) => [String(doc.id), doc])).values()]
    const frequency = unique.length
    if (frequency < 2 || frequency > MAX_TOKEN_FREQUENCY) continue
    for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
        const left = unique[leftIndex]
        const right = unique[rightIndex]
        const ids = [String(left.id), String(right.id)].sort((a, b) => Number(a) - Number(b))
        const pairKey = ids.join(':')
        if (!pairTokens.has(pairKey)) pairTokens.set(pairKey, { left, right, tokens: new Set() })
        pairTokens.get(pairKey).tokens.add(tokenValue)
      }
    }
  }

  const rows = []
  for (const [pairKey, pair] of pairTokens) {
    const sharedTokens = [...pair.tokens].sort()
    const assessment = pairScore(pair.left, pair.right, sharedTokens, tokenFrequency)
    if (assessment.blockers.length || assessment.score < MIN_SCORE) continue
    const row = {
      pairKey,
      kind: 'cross_language_rare_latin_token_review',
      confidence: 'review',
      score: assessment.score,
      sharedTokens,
      reasons: assessment.reasons,
      blockers: [],
      left: compactWork(pair.left),
      right: compactWork(pair.right),
      safety: {
        payloadRead: true,
        payloadWrite: false,
        directPostgresqlWrite: false,
        mergeApplied: false,
        deleteApplied: false,
        automaticApplyAllowed: false,
        ownerAdminConfirmationRequired: true,
      },
    }
    if (focus && !JSON.stringify(row).toLowerCase().includes(focus)) continue
    rows.push(row)
  }

  rows.sort((a, b) => b.score - a.score || a.pairKey.localeCompare(b.pairKey))
  const outputs = {
    rows: path.join(outDir, 'cross-language-duplicate-candidates-v01.jsonl'),
    summary: path.join(outDir, 'cross-language-duplicate-summary-v01.json'),
    report: path.join(outDir, 'cross-language-duplicate-report-v01.md'),
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    payloadBaseUrl: baseUrl,
    worksRead: works.length,
    distinctLatinTokens: tokenToWorks.size,
    candidatePairs: rows.length,
    focus: focus || null,
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      mergeApplied: false,
      deleteApplied: false,
      auditOnly: true,
    },
  }
  writeJsonl(outputs.rows, rows)
  writeJson(outputs.summary, summary)
  fs.mkdirSync(path.dirname(outputs.report), { recursive: true })
  fs.writeFileSync(outputs.report, markdown(summary, rows), 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  for (const row of rows.slice(0, 30)) {
    console.log(JSON.stringify({ pairKey: row.pairKey, score: row.score, sharedTokens: row.sharedTokens, left: row.left.title, right: row.right.title }))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
