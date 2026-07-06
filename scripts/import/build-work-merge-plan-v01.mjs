#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const PAGE_LIMIT = 200
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')
const DEFAULT_PRIORITY = ['manual', 'yurizukan', 'legacy_xwiki', 'bangumi', 'anilist', 'wikidata', 'vndb', 'mangadex', 'steam', 'other', 'unknown']
const EXTERNAL_ID_FIELDS = ['bangumiSubjectId', 'anilistMediaId', 'vndbId', 'wikidataQid', 'malId', 'officialUrl']
const TITLE_KEY_MIN_LENGTH = 2
const TOO_LARGE_GROUP_SIZE = 30

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function parsePriority(value) {
  const items = val(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return items.length ? [...items, ...DEFAULT_PRIORITY.filter((item) => !items.includes(item))] : DEFAULT_PRIORITY
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

async function login(baseUrl, email, secret) {
  const result = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password: secret }),
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

function normalizeUrl(value) {
  const raw = val(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    url.hash = ''
    url.search = ''
    return `${url.hostname.replace(/^www\./u, '').toLowerCase()}${url.pathname.replace(/\/+$/u, '')}`
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//u, '').replace(/^www\./u, '').replace(/[?#].*$/u, '').replace(/\/+$/u, '')
  }
}

function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3000\s]+/gu, '')
    .replace(/[『』「」《》〈〉【】\[\]()（）{}｛｝]/gu, '')
    .replace(/[!！?？:：;；,，.。・･·'’`｀"“”~〜～_＿\-ー—–]+/gu, '')
}

function localizedTitleValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.title))
    .map(val)
    .filter(Boolean)
}

function aliasValues(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === 'string' ? item : item?.value))
    .map(val)
    .filter(Boolean)
}

function candidateSources(doc) {
  return Array.isArray(doc.candidateSources) ? doc.candidateSources : []
}

function sourceLinks(doc) {
  return Array.isArray(doc.sourceLinks) ? doc.sourceLinks : []
}

function uniqueStrings(values) {
  const seen = new Set()
  const output = []
  for (const raw of values.flat(Infinity)) {
    const value = val(raw)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function sourceOf(doc) {
  const sources = uniqueStrings([
    doc.chosenBaseSource,
    candidateSources(doc).map((item) => item?.source),
    doc.legacyXWikiPage ? 'legacy_xwiki' : '',
  ]).map((item) => item.toLowerCase())

  if (sources.includes('manual')) return 'manual'
  if (sources.includes('yurizukan')) return 'yurizukan'
  if (sources.includes('legacy_xwiki')) return 'legacy_xwiki'
  if (sources.includes('bangumi')) return 'bangumi'
  if (sources.includes('anilist')) return 'anilist'
  if (sources.includes('wikidata')) return 'wikidata'
  if (sources.includes('vndb')) return 'vndb'
  if (sources.includes('mangadex')) return 'mangadex'
  if (sources.includes('steam')) return 'steam'
  if (sources.includes('other')) return 'other'
  return 'unknown'
}

function sourcePriority(source, priority) {
  const index = priority.indexOf(source)
  return index === -1 ? priority.length : index
}

function titleValues(doc) {
  return uniqueStrings([
    doc.title,
    doc.originalTitle,
    aliasValues(doc.aliases),
    localizedTitleValues(doc.localizedTitles),
  ])
}

function titleKeys(doc) {
  const mediaGroup = val(doc.mediaGroup) || 'unknown'
  const mediaType = val(doc.mediaType) || 'unknown'
  return titleValues(doc)
    .map(normalizeTitle)
    .filter((title) => title.length >= TITLE_KEY_MIN_LENGTH)
    .map((title) => `title:${mediaGroup}:${mediaType}:${title}`)
}

function externalKeys(doc) {
  const keys = []
  const externalIds = doc.externalIds || {}
  for (const field of EXTERNAL_ID_FIELDS) {
    const raw = val(externalIds[field])
    if (!raw) continue
    if (field === 'officialUrl') {
      const url = normalizeUrl(raw)
      if (url) keys.push(`url:official:${url}`)
      continue
    }
    keys.push(`external:${field}:${raw.toLowerCase()}`)
  }

  for (const source of candidateSources(doc)) {
    const sourceName = val(source?.source).toLowerCase() || 'unknown'
    const externalId = val(source?.externalId)
    const url = normalizeUrl(source?.url)
    if (sourceName && externalId) keys.push(`candidate:${sourceName}:${externalId.toLowerCase()}`)
    if (url) keys.push(`url:${sourceName}:${url}`)
  }

  for (const link of sourceLinks(doc)) {
    const url = normalizeUrl(link?.url)
    if (url) keys.push(`url:source-link:${url}`)
  }

  return uniqueStrings(keys)
}

function yearsCompatible(a, b) {
  const years = [a?.firstPublishedLabel, a?.firstPublishedAt, b?.firstPublishedLabel, b?.firstPublishedAt]
    .map((value) => val(value).match(/\d{4}/u)?.[0])
    .filter(Boolean)
  if (years.length < 2) return true
  return new Set(years).size === 1
}

function docCompleteness(doc) {
  let score = 0
  for (const field of ['title', 'originalTitle', 'mediaGroup', 'mediaType', 'format', 'firstPublishedLabel', 'reviewStatus', 'evidenceStrength', 'rank']) {
    if (val(doc[field]) && val(doc[field]) !== 'unknown') score += 1
  }
  if (aliasValues(doc.aliases).length) score += 1
  if (localizedTitleValues(doc.localizedTitles).length) score += 1
  if (candidateSources(doc).length) score += 1
  if (sourceLinks(doc).length) score += 1
  if (doc.hasEvidence) score += 2
  if (doc.status === 'published') score += 2
  if (doc.reviewStatus === 'reviewed') score += 2
  return score
}

class UnionFind {
  constructor() {
    this.parent = new Map()
  }

  ensure(value) {
    if (!this.parent.has(value)) this.parent.set(value, value)
  }

  find(value) {
    this.ensure(value)
    const parent = this.parent.get(value)
    if (parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }

  union(a, b) {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootB, rootA)
  }
}

function addKey(index, key, docId) {
  if (!key) return
  if (!index.has(key)) index.set(key, [])
  index.get(key).push(docId)
}

function indexedKeys(index, docId) {
  const keys = []
  for (const [key, values] of index.entries()) {
    if (values.includes(docId)) keys.push(key)
  }
  return keys
}

function buildGroups(docs, priority) {
  const byId = new Map(docs.map((doc) => [String(doc.id), doc]))
  const uf = new UnionFind()
  const strongIndex = new Map()
  const titleIndex = new Map()

  for (const doc of docs) {
    const docId = String(doc.id)
    uf.ensure(docId)
    for (const key of externalKeys(doc)) addKey(strongIndex, key, docId)
    for (const key of titleKeys(doc)) addKey(titleIndex, key, docId)
  }

  for (const values of strongIndex.values()) {
    if (values.length < 2) continue
    const first = values[0]
    for (const value of values.slice(1)) uf.union(first, value)
  }

  for (const values of titleIndex.values()) {
    if (values.length < 2 || values.length > TOO_LARGE_GROUP_SIZE) continue
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const a = byId.get(values[i])
        const b = byId.get(values[j])
        if (!a || !b) continue
        if (yearsCompatible(a, b)) uf.union(values[i], values[j])
      }
    }
  }

  const buckets = new Map()
  for (const doc of docs) {
    const root = uf.find(String(doc.id))
    if (!buckets.has(root)) buckets.set(root, [])
    buckets.get(root).push(doc)
  }

  const groups = []
  for (const docsInGroup of buckets.values()) {
    if (docsInGroup.length < 2) continue
    const sortedDocs = [...docsInGroup].sort((a, b) => compareMasterCandidate(a, b, priority))
    const master = sortedDocs[0]
    const supplements = sortedDocs.slice(1)
    const allDocIds = docsInGroup.map((doc) => String(doc.id))
    const groupStrongKeys = uniqueStrings(allDocIds.flatMap((id) => indexedKeys(strongIndex, id)))
    const groupTitleKeys = uniqueStrings(allDocIds.flatMap((id) => indexedKeys(titleIndex, id)))
    const sourceCounts = countBy(docsInGroup, (doc) => sourceOf(doc))
    const mediaTypes = countBy(docsInGroup, (doc) => val(doc.mediaType) || 'unknown')
    const mediaGroups = countBy(docsInGroup, (doc) => val(doc.mediaGroup) || 'unknown')
    const confidence = groupStrongKeys.length ? 'strong' : 'title-review'

    groups.push({
      mergeGroupId: `wm-${String(groups.length + 1).padStart(6, '0')}`,
      confidence,
      groupSize: docsInGroup.length,
      needsManualReview: confidence !== 'strong' || docsInGroup.length > TOO_LARGE_GROUP_SIZE || Object.keys(mediaTypes).length > 1,
      reasons: [
        groupStrongKeys.length ? 'shared_external_id_or_url' : 'shared_normalized_title',
        Object.keys(mediaTypes).length > 1 ? 'media_type_mismatch' : '',
        docsInGroup.length > TOO_LARGE_GROUP_SIZE ? 'large_group' : '',
      ].filter(Boolean),
      master: summarizeDoc(master, priority),
      supplements: supplements.map((doc) => summarizeDoc(doc, priority)),
      mergedPreview: mergedPreview(docsInGroup),
      sourceCounts,
      mediaTypes,
      mediaGroups,
      evidenceKeys: {
        strong: groupStrongKeys.slice(0, 80),
        title: groupTitleKeys.slice(0, 80),
      },
    })
  }

  return groups.sort((a, b) => {
    const confidenceSort = a.confidence.localeCompare(b.confidence)
    if (confidenceSort) return confidenceSort
    return b.groupSize - a.groupSize || a.master.title.localeCompare(b.master.title, 'zh-CN')
  })
}

function compareMasterCandidate(a, b, priority) {
  const pa = sourcePriority(sourceOf(a), priority)
  const pb = sourcePriority(sourceOf(b), priority)
  if (pa !== pb) return pa - pb
  const ca = docCompleteness(a)
  const cb = docCompleteness(b)
  if (ca !== cb) return cb - ca
  if (a.status !== b.status) {
    if (a.status === 'published') return -1
    if (b.status === 'published') return 1
  }
  return val(a.title).localeCompare(val(b.title), 'zh-CN')
}

function summarizeDoc(doc, priority) {
  const source = sourceOf(doc)
  return {
    id: String(doc.id),
    title: val(doc.title),
    slug: val(doc.slug),
    siteId: val(doc.siteId),
    source,
    sourcePriority: sourcePriority(source, priority),
    chosenBaseSource: val(doc.chosenBaseSource),
    status: val(doc.status),
    reviewStatus: val(doc.reviewStatus),
    evidenceStrength: val(doc.evidenceStrength),
    rank: val(doc.rank),
    mediaGroup: val(doc.mediaGroup),
    mediaType: val(doc.mediaType),
    originalTitle: val(doc.originalTitle),
    titles: titleValues(doc).slice(0, 20),
    externalIds: doc.externalIds || {},
    candidateSources: candidateSources(doc).map((source) => ({
      source: val(source?.source),
      label: val(source?.label),
      externalId: val(source?.externalId),
      url: val(source?.url),
    })).slice(0, 20),
    completeness: docCompleteness(doc),
  }
}

function mergedPreview(docs) {
  return {
    titles: uniqueStrings(docs.flatMap(titleValues)).slice(0, 80),
    candidateSources: uniqueSources(docs.flatMap(candidateSources)).slice(0, 80),
    sourceLinks: uniqueLinks(docs.flatMap(sourceLinks)).slice(0, 80),
    externalIds: mergedExternalIds(docs),
  }
}

function uniqueSources(values) {
  const seen = new Set()
  const output = []
  for (const item of values) {
    const source = val(item?.source)
    const externalId = val(item?.externalId)
    const url = val(item?.url)
    const key = `${source.toLowerCase()}|${externalId.toLowerCase()}|${normalizeUrl(url)}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push({
      source,
      label: val(item?.label),
      externalId,
      url,
      note: val(item?.note),
    })
  }
  return output
}

function uniqueLinks(values) {
  const seen = new Set()
  const output = []
  for (const item of values) {
    const url = val(item?.url)
    const key = normalizeUrl(url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push({ label: val(item?.label), url })
  }
  return output
}

function mergedExternalIds(docs) {
  const out = {}
  for (const field of EXTERNAL_ID_FIELDS) {
    const values = uniqueStrings(docs.map((doc) => doc.externalIds?.[field]))
    if (!values.length) continue
    out[field] = values.length === 1 ? values[0] : { conflict: true, values }
  }
  return out
}

function countBy(values, getKey) {
  const out = {}
  for (const value of values) {
    const key = val(getKey(value)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, groups) {
  const samples = groups.slice(0, 60).map((group) => ({
    mergeGroupId: group.mergeGroupId,
    confidence: group.confidence,
    groupSize: group.groupSize,
    needsManualReview: group.needsManualReview,
    reasons: group.reasons,
    master: {
      title: group.master.title,
      slug: group.master.slug,
      siteId: group.master.siteId,
      source: group.master.source,
    },
    supplements: group.supplements.map((item) => ({ title: item.title, slug: item.slug, siteId: item.siteId, source: item.source })),
  }))

  return [
    '# Work Merge Plan v0.1',
    '',
    'Read-only candidate grouping for possible same-work records. This report does not modify Payload or PostgreSQL.',
    '',
    '## Safety',
    '',
    `- Payload read: ${summary.safety.payloadRead}`,
    `- Payload write: ${summary.safety.payloadWrite}`,
    `- PostgreSQL write: ${summary.safety.postgresqlWrite}`,
    `- Merge apply action: ${summary.safety.mergeApplyAction}`,
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- payloadBaseUrl: ${summary.payloadBaseUrl}`,
    `- worksRead: ${summary.worksRead}`,
    `- workGroups: ${summary.workGroups}`,
    `- docsInGroups: ${summary.docsInGroups}`,
    `- strongGroups: ${summary.strongGroups}`,
    `- titleReviewGroups: ${summary.titleReviewGroups}`,
    `- manualReviewGroups: ${summary.manualReviewGroups}`,
    `- priority: ${summary.priority.join(' > ')}`,
    '',
    '## Source Counts In Groups',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.sourceCountsInGroups).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
    '## Notes',
    '',
    '- The master row is selected by source priority first, then data completeness.',
    '- Lower-priority rows are treated as supplemental sources for a later apply step.',
    '- Title-only matches are marked for manual review before any future write step.',
    '- This report is not evidence assessment and does not change review status.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const priority = parsePriority(args.priority)
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const secret = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]

  let token = null
  if (email && secret) token = await login(baseUrl, email, secret)

  const works = await fetchAllWorks(baseUrl, token)
  const groups = buildGroups(works.docs, priority)
  const docsInGroups = new Set(groups.flatMap((group) => [group.master.id, ...group.supplements.map((item) => item.id)]))
  const docsInGroupRows = [...docsInGroups].map((id) => works.docs.find((doc) => String(doc.id) === id)).filter(Boolean)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'work-merge-plan-v0.1',
    ok: true,
    payloadBaseUrl: baseUrl,
    priority,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    workGroups: groups.length,
    docsInGroups: docsInGroups.size,
    strongGroups: groups.filter((group) => group.confidence === 'strong').length,
    titleReviewGroups: groups.filter((group) => group.confidence === 'title-review').length,
    manualReviewGroups: groups.filter((group) => group.needsManualReview).length,
    sourceCountsInGroups: countBy(docsInGroupRows, sourceOf),
    mediaTypeCountsInGroups: countBy(docsInGroupRows, (doc) => val(doc.mediaType) || 'unknown'),
    outputs: {
      groups: path.join(outDir, 'work-merge-plan-v01.groups.jsonl'),
      summary: path.join(outDir, 'work-merge-plan-v01-summary.json'),
      json: path.join(outDir, 'work-merge-plan-v01.json'),
      md: path.join(outDir, 'work-merge-plan-v01.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: true,
      payloadWrite: false,
      postgresqlWrite: false,
      mergeApplyAction: false,
      applyAllowed: false,
    },
  }

  const report = { ok: true, summary, samples: groups.slice(0, 80) }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.groups, groups.map((group) => JSON.stringify(group)).join('\n') + (groups.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, groups), 'utf8')

  console.log(JSON.stringify({ ok: true, summary, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
