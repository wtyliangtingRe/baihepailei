#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT_DIR = 'data_local/staging/import'
const PAGE_LIMIT = 200
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')

const SOURCE_PRIORITY = [
  'legacy_xwiki',
  'xwiki',
  'local',
  'manual',
  'bangumi',
  'anilist',
  'yurizukan',
  'unknown',
]

const STATUS_PRIORITY = {
  published: 40,
  review: 30,
  draft: 20,
  archived: 0,
}

const REVIEW_PRIORITY = {
  reviewed: 30,
  disputed: 20,
  pending: 10,
  deprecated: 0,
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function val(value) {
  return String(value ?? '').trim()
}

function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3000\s]+/gu, '')
    .replace(/[‐‑‒–—―ー－-]+/gu, '-')
    .replace(/[~〜～]/gu, '~')
    .replace(/[・･·]/gu, '')
    .replace(/[『』「」《》〈〉【】\[\]()（）{}]/gu, '')
    .replace(/[!！?？.,，。:：;；'"“”‘’]/gu, '')
}

function normalizedTitles(doc) {
  const values = [
    doc.title,
    doc.originalTitle,
    ...(Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((item) => (typeof item === 'string' ? item : item?.title)) : []),
    ...(Array.isArray(doc.aliases) ? doc.aliases.map((item) => (typeof item === 'string' ? item : item?.value)) : []),
  ]

  const out = new Set()
  for (const raw of values) {
    const key = normalizeTitle(raw)
    if (key.length < 2) continue
    if (['unknown', '未定', '未命名', '无题'].includes(key)) continue
    out.add(key)
  }
  return [...out]
}

function displayTitles(doc) {
  const values = [
    doc.title,
    doc.originalTitle,
    ...(Array.isArray(doc.localizedTitles) ? doc.localizedTitles.map((item) => (typeof item === 'string' ? item : item?.title)) : []),
    ...(Array.isArray(doc.aliases) ? doc.aliases.map((item) => (typeof item === 'string' ? item : item?.value)) : []),
  ]
  return [...new Set(values.map(val).filter(Boolean))]
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { raw: text }
  }
  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload, null, 2) : text
    throw new Error(`HTTP ${response.status} ${response.statusText}\n${detail}`)
  }
  return payload
}

async function login(baseUrl, email, password) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!result?.token) throw new Error('Payload login succeeded but did not return a token.')
  return result.token
}

function authHeaders(token) {
  return token ? { Authorization: `JWT ${token}` } : {}
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0

  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', '0')
    params.set('draft', 'true')

    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`, {
      headers: authHeaders(token),
    })

    docs.push(...(Array.isArray(result?.docs) ? result.docs : []))
    totalPages = Number(result?.totalPages || 1)
    totalDocs = Number(result?.totalDocs || docs.length)
    page += 1
  } while (page <= totalPages)

  return { docs, totalDocs }
}

function candidateSource(doc) {
  const first = Array.isArray(doc.candidateSources) ? doc.candidateSources[0] : null
  const source = val(first?.source || first?.label || doc.originalSource)
  if (source) return source.toLowerCase()
  if (doc.legacyXWikiPage) return 'legacy_xwiki'
  if (doc.externalIds?.bangumiSubjectId) return 'bangumi'
  if (doc.externalIds?.anilistMediaId) return 'anilist'
  return 'unknown'
}

function sourcePriority(source) {
  const index = SOURCE_PRIORITY.indexOf(source)
  return index === -1 ? SOURCE_PRIORITY.length : index
}

function completenessScore(doc) {
  let score = 0
  if (val(doc.title)) score += 5
  if (val(doc.originalTitle)) score += 4
  if (Array.isArray(doc.localizedTitles) && doc.localizedTitles.length) score += Math.min(10, doc.localizedTitles.length * 2)
  if (Array.isArray(doc.aliases) && doc.aliases.length) score += Math.min(8, doc.aliases.length * 2)
  if (doc.externalIds && Object.values(doc.externalIds).some(Boolean)) score += 8
  if (Array.isArray(doc.sourceLinks) && doc.sourceLinks.length) score += Math.min(8, doc.sourceLinks.length * 2)
  if (doc.legacyXWikiPage) score += 10
  if (doc.hasEvidence) score += 10
  if (val(doc.evidenceNote)) score += 3
  score += STATUS_PRIORITY[doc.status] || 0
  score += REVIEW_PRIORITY[doc.reviewStatus] || 0
  return score
}

function sortForKeeper(a, b) {
  const sourceDelta = sourcePriority(candidateSource(a)) - sourcePriority(candidateSource(b))
  if (sourceDelta !== 0) return sourceDelta
  const completenessDelta = completenessScore(b) - completenessScore(a)
  if (completenessDelta !== 0) return completenessDelta
  return val(a.title).localeCompare(val(b.title), 'zh-CN')
}

function externalIdPairs(doc) {
  const out = []
  const ids = doc.externalIds || {}
  for (const [field, value] of Object.entries(ids)) {
    if (!val(value)) continue
    out.push(`${field}:${val(value)}`)
  }
  return out
}

function sourcePairs(doc) {
  const out = []
  for (const item of Array.isArray(doc.candidateSources) ? doc.candidateSources : []) {
    const source = val(item?.source || item?.label)
    const externalId = val(item?.externalId)
    if (source && externalId) out.push(`${source}:${externalId}`)
  }
  return out
}

function compactDoc(doc) {
  return {
    id: val(doc.id),
    title: val(doc.title),
    slug: val(doc.slug),
    siteId: val(doc.siteId),
    source: candidateSource(doc),
    rank: val(doc.rank),
    mediaGroup: val(doc.mediaGroup),
    mediaType: val(doc.mediaType),
    status: val(doc.status),
    reviewStatus: val(doc.reviewStatus),
    evidenceStrength: val(doc.evidenceStrength),
    hasEvidence: Boolean(doc.hasEvidence),
    completenessScore: completenessScore(doc),
    displayTitles: displayTitles(doc).slice(0, 20),
    externalIds: externalIdPairs(doc),
    candidateSources: sourcePairs(doc),
  }
}

function buildTitleBuckets(docs) {
  const buckets = new Map()
  for (const doc of docs) {
    for (const key of normalizedTitles(doc)) {
      const mediaGroup = val(doc.mediaGroup || 'unknown')
      const bucketKey = `${mediaGroup}::${key}`
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, { key, mediaGroup, docs: [] })
      buckets.get(bucketKey).docs.push(doc)
    }
  }
  return [...buckets.values()].filter((bucket) => bucket.docs.length > 1)
}

function uniqueDocs(docs) {
  const seen = new Set()
  const out = []
  for (const doc of docs) {
    const id = val(doc.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(doc)
  }
  return out
}

function groupConfidence(groupDocs, titleKey) {
  const mediaGroups = new Set(groupDocs.map((doc) => val(doc.mediaGroup || 'unknown')))
  const sources = new Set(groupDocs.map(candidateSource))
  const hasCrossSource = sources.size > 1
  const hasExternalIds = groupDocs.some((doc) => externalIdPairs(doc).length > 0 || sourcePairs(doc).length > 0)
  if (mediaGroups.size > 1) return 'low'
  if (titleKey.length <= 3 && !hasCrossSource) return 'low'
  if (hasCrossSource && hasExternalIds) return 'high'
  if (hasCrossSource) return 'medium'
  return 'low'
}

function buildPlanGroup(bucket, index) {
  const docs = uniqueDocs(bucket.docs).sort(sortForKeeper)
  const keeper = docs[0]
  const mergeFrom = docs.slice(1)
  const allTitles = [...new Set(docs.flatMap(displayTitles))]
  const allExternalIds = [...new Set(docs.flatMap(externalIdPairs))]
  const allCandidateSources = [...new Set(docs.flatMap(sourcePairs))]
  const sources = [...new Set(docs.map(candidateSource))]

  return {
    groupId: `work-merge-v01-${String(index + 1).padStart(6, '0')}`,
    matchType: 'title_alias_exact_normalized',
    confidence: groupConfidence(docs, bucket.key),
    titleKey: bucket.key,
    mediaGroup: bucket.mediaGroup,
    sources,
    keeper: compactDoc(keeper),
    mergeFrom: mergeFrom.map(compactDoc),
    mergePatchPreview: {
      titlesToPreserve: allTitles.slice(0, 80),
      externalIdsToPreserve: allExternalIds,
      candidateSourcesToPreserve: allCandidateSources,
      note: 'Read-only merge plan. Higher-priority source remains keeper; lower-priority sources are supplemental candidates.',
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      mergeApplied: false,
      applyAllowed: false,
    },
  }
}

function countBy(items, getKey) {
  const out = {}
  for (const item of items) {
    const key = val(typeof getKey === 'function' ? getKey(item) : item[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, samples) {
  return [
    '# Work Merge Plan v0.1',
    '',
    'Read-only duplicate work merge planning report. No Payload write, no PostgreSQL write, and no merge is performed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- worksRead: ${summary.worksRead}`,
    `- worksTotalDocs: ${summary.worksTotalDocs}`,
    `- candidateGroups: ${summary.candidateGroups}`,
    `- candidateDocs: ${summary.candidateDocs}`,
    '',
    '## Safety',
    '',
    '- Payload read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No merge performed.',
    '',
    '## Confidence',
    '',
    '| Confidence | Count |',
    '|---|---:|',
    ...Object.entries(summary.byConfidence).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Sources',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.byKeeperSource).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const minConfidence = val(args['min-confidence'] || 'low')
  const confidenceOrder = { low: 0, medium: 1, high: 2 }
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]
  if (!email || !password) throw new Error(`Set ${EXPORT_EMAIL_ENV}/${EXPORT_SECRET_ENV} or ${SEED_EMAIL_ENV}/${SEED_SECRET_ENV}.`)

  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token)
  const buckets = buildTitleBuckets(works.docs)
  const groups = buckets
    .map((bucket, index) => buildPlanGroup(bucket, index))
    .filter((group) => (confidenceOrder[group.confidence] || 0) >= (confidenceOrder[minConfidence] || 0))
    .sort((a, b) => {
      const confidenceDelta = (confidenceOrder[b.confidence] || 0) - (confidenceOrder[a.confidence] || 0)
      if (confidenceDelta !== 0) return confidenceDelta
      return b.mergeFrom.length - a.mergeFrom.length || a.titleKey.localeCompare(b.titleKey)
    })

  const candidateDocIds = new Set(groups.flatMap((group) => [group.keeper.id, ...group.mergeFrom.map((doc) => doc.id)]))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'work-merge-plan-v0.1',
    ok: true,
    payloadBaseUrl: baseUrl,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    candidateGroups: groups.length,
    candidateDocs: candidateDocIds.size,
    minConfidence,
    sourcePriority: SOURCE_PRIORITY,
    byConfidence: countBy(groups, 'confidence'),
    byKeeperSource: countBy(groups, (group) => group.keeper.source),
    byMediaGroup: countBy(groups, 'mediaGroup'),
    outputs: {
      groups: path.join(outDir, 'work-merge-plan-v01.groups.jsonl'),
      json: path.join(outDir, 'work-merge-plan-v01.json'),
      summary: path.join(outDir, 'work-merge-plan-v01-summary.json'),
      md: path.join(outDir, 'work-merge-plan-v01.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      mergeApplied: false,
      applyAllowed: false,
    },
  }

  const samples = groups.slice(0, 30)
  const report = { ok: true, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.groups, groups.map((group) => JSON.stringify(group)).join('\n') + (groups.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: true, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
