#!/usr/bin/env node
import fs from 'node:fs'
import readline from 'node:readline'

const VERSION = 'wikidata-work-integration-audit-v0.1'
const PAGE_LIMIT = 200
const DEFAULT_INPUT = 'data_local/raw/wikidata/index/wikidata-work-review.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-work-integration'
const EXPORT_EMAIL_ENV = 'PAYLOAD_EXPORT_EMAIL'
const EXPORT_SECRET_ENV = ['PAYLOAD_EXPORT', 'PASSWORD'].join('_')
const SEED_EMAIL_ENV = 'PAYLOAD_SEED_EMAIL'
const SEED_SECRET_ENV = ['PAYLOAD_SEED', 'PASSWORD'].join('_')
const SOURCE_PRIORITY_NOTE = 'Source priority: Yurizukan > Bangumi > MangaDex > NDL > Steam > Wikidata > AniList'

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
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ')
}

function compactLine(value) {
  return val(value).replace(/[\r\n\t]+/gu, ' ').replace(/\s+/gu, ' ')
}

function normalizeUrl(value) {
  return val(value).replace(/\/+$/u, '')
}

function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function maybeJson(value) {
  const text = val(value)
  if (!text || !/^[\[{]/u.test(text)) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function collectTextDeep(value, out = []) {
  if (value === undefined || value === null) return out
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const parsed = typeof value === 'string' ? maybeJson(value) : null
    if (parsed !== null) return collectTextDeep(parsed, out)
    const text = compactLine(value)
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextDeep(item, out)
    return out
  }
  if (typeof value === 'object') {
    for (const key of ['title', 'name', 'value', 'text', 'label', 'native', 'romaji', 'english', 'chinese', 'japanese', 'zh', 'ja', 'en']) {
      if (key in value) collectTextDeep(value[key], out)
    }
  }
  return out
}

function collectLabelMap(value) {
  const out = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string') out.push(entry)
    else if (entry && typeof entry === 'object') out.push(entry.value || entry.text || entry.label)
  }
  return out.map(compactLine).filter(Boolean)
}

function isUsefulTitle(value) {
  const text = compactLine(value)
  if (!text) return false
  if (/^https?:\/\//iu.test(text)) return false
  if (/^Q\d+$/iu.test(text)) return false
  if (/^\d+$/u.test(text)) return false
  if (/^(unknown|null|undefined)$/iu.test(text)) return false
  return true
}

async function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }
  return { rows, read, failed }
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
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

async function fetchAllWorks(baseUrl, token, depth = 1) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0
  do {
    const params = new URLSearchParams()
    params.set('limit', String(PAGE_LIMIT))
    params.set('page', String(page))
    params.set('depth', String(depth))
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

function qidOf(row) {
  const values = [
    row?.wikidataQid,
    row?.qid,
    row?.id,
    row?.entityId,
    row?.entity?.id,
    row?.wikidata?.id,
    row?.claims?.wikidataQid,
  ]
  for (const item of values) {
    const text = val(item).toUpperCase()
    const match = text.match(/^Q\d+$/u) || text.match(/wikidata\.org\/wiki\/(Q\d+)/iu)
    if (match) return match[1] || match[0]
  }
  return ''
}

function wikidataUrl(qid) {
  return qid ? `https://www.wikidata.org/wiki/${qid}` : ''
}

function externalIdsOf(doc) {
  const ids = doc?.externalIds
  if (!ids || Array.isArray(ids) || typeof ids !== 'object') return {}
  return Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, val(value)]).filter(([, value]) => value))
}

function aliasRows(doc) {
  return (Array.isArray(doc?.aliases) ? doc.aliases : [])
    .map((item) => val(typeof item === 'string' ? item : item?.value || item?.title || item?.name))
    .filter(Boolean)
}

function localizedTitleRows(doc) {
  return (Array.isArray(doc?.localizedTitles) ? doc.localizedTitles : [])
    .map((item) => val(typeof item === 'string' ? item : item?.title || item?.value || item?.text || item?.name))
    .filter(Boolean)
}

function splitLooseList(value) {
  const text = compactLine(value)
  if (!text) return []
  return text
    .split(/\s+[\/／]\s+|[|；;]+/u)
    .map((item) => compactLine(item))
    .filter(isUsefulTitle)
}

function searchTextRows(doc) {
  return splitLooseList(String(doc?.searchText || '').replace(/[\r\n]+/gu, '|'))
}

function searchableWorkNames(doc) {
  return uniqueBy([
    doc?.title,
    doc?.originalTitle,
    ...aliasRows(doc),
    ...localizedTitleRows(doc),
    ...searchTextRows(doc),
  ].map(compactLine).filter(Boolean), normalizeText)
}

function sourceLinkRows(doc) {
  return (Array.isArray(doc?.sourceLinks) ? doc.sourceLinks : [])
    .map((item) => ({ label: val(typeof item === 'string' ? '' : item?.label), url: normalizeUrl(typeof item === 'string' ? item : item?.url) }))
    .filter((item) => item.url)
}

function candidateSourceRows(doc) {
  return (Array.isArray(doc?.candidateSources) ? doc.candidateSources : [])
    .map((item) => ({
      source: val(item?.source),
      label: val(item?.label),
      externalId: val(item?.externalId),
      url: normalizeUrl(item?.url),
      note: val(item?.note),
    }))
    .filter((item) => item.source || item.externalId || item.url)
}

function sourceOf(doc) {
  const ids = externalIdsOf(doc)
  if (ids.bangumiSubjectId) return 'bangumi'
  if (ids.wikidataQid) return 'wikidata'
  const sources = candidateSourceRows(doc).map((item) => val(item.source || item.label).toLowerCase()).filter(Boolean)
  if (sources.includes('bangumi')) return 'bangumi'
  if (sources.includes('wikidata')) return 'wikidata'
  if (sources[0]) return sources[0]
  return val(doc?.originalSource || doc?.source || 'unknown').toLowerCase() || 'unknown'
}

function workYearLabels(work) {
  return uniqueBy([
    val(work?.firstPublishedLabel).match(/\d{4}/u)?.[0] || '',
    val(work?.firstPublishedAt).match(/\d{4}/u)?.[0] || '',
  ].filter(Boolean), (item) => item)
}

function incomingYears(row) {
  return uniqueBy([
    row?.year,
    row?.publicationYear,
    row?.inceptionYear,
    row?.firstPublishedYear,
    row?.date,
    row?.publicationDate,
    row?.firstPublishedAt,
    row?.claims?.publicationDate,
    row?.claims?.inception,
    ...collectTextDeep(row?.years),
    ...collectTextDeep(row?.dates),
  ].map((item) => val(item).match(/\d{4}/u)?.[0] || '').filter(Boolean), (item) => item)
}

function officialUrlOf(row) {
  const values = [
    row?.officialUrl,
    row?.officialWebsite,
    row?.website,
    row?.urlOfficial,
    row?.claims?.officialWebsite,
    row?.claims?.P856,
  ]
  for (const item of values.flatMap((value) => collectTextDeep(value))) {
    const text = normalizeUrl(item)
    if (/^https?:\/\//iu.test(text)) return text
  }
  return ''
}

function bangumiSubjectIdOf(row) {
  const values = [row?.bangumiSubjectId, row?.bangumiId, row?.source?.bangumiSubjectId, row?.source?.bangumiId, row?.claims?.bangumiSubjectId]
  for (const item of values) {
    const text = val(item)
    if (/^\d+$/u.test(text)) return text
  }
  return ''
}

function titlesForRow(row) {
  return uniqueBy([
    row?.query,
    row?.sourceTitle,
    row?.sourceTitleCn,
    row?.title,
    row?.name,
    row?.label,
    row?.labels?.zh?.value,
    row?.labels?.ja?.value,
    row?.labels?.en?.value,
    ...collectLabelMap(row?.labels),
    ...collectLabelMap(row?.sitelinks),
    ...collectTextDeep(row?.aliases),
    ...collectTextDeep(row?.altLabels),
    ...collectTextDeep(row?.titles),
    ...collectTextDeep(row?.names),
  ].map(compactLine).filter(isUsefulTitle), normalizeText)
}

function adultAdvisories(row) {
  const haystack = [
    row?.contentRating,
    row?.rating,
    row?.ageRating,
    row?.isAdult ? 'isAdult' : '',
    row?.adult ? 'adult' : '',
    row?.nsfw ? 'nsfw' : '',
    ...collectTextDeep(row?.tags),
    ...collectTextDeep(row?.genres),
    ...collectTextDeep(row?.claims),
  ].map((item) => val(item).toLowerCase()).join('\n')
  const out = []
  if (/suggestive|暗示性|擦边/u.test(haystack)) out.push('suggestive')
  if (/erotica|adult|成人向|nsfw|isadult/u.test(haystack)) out.push('erotica')
  if (/pornographic|pornography|色情|18禁|r-?18/u.test(haystack)) out.push('pornographic')
  if (/doujinshi|同人志|同人本/u.test(haystack)) out.push('doujinshi_or_extra')
  return uniqueBy(out, (item) => item)
}

function buildWorkIndexes(works) {
  const byWikidataQid = new Map()
  const byBangumiId = new Map()
  const titleIndex = new Map()
  const byId = new Map()

  for (const work of works) {
    const id = val(work?.id)
    if (id) byId.set(id, work)
    const ids = externalIdsOf(work)
    if (ids.wikidataQid && !byWikidataQid.has(ids.wikidataQid.toUpperCase())) byWikidataQid.set(ids.wikidataQid.toUpperCase(), work)
    if (ids.bangumiSubjectId && !byBangumiId.has(ids.bangumiSubjectId)) byBangumiId.set(ids.bangumiSubjectId, work)
    for (const name of searchableWorkNames(work)) {
      const key = normalizeText(name)
      if (!key) continue
      if (!titleIndex.has(key)) titleIndex.set(key, [])
      titleIndex.get(key).push(work)
    }
  }

  return { byId, byWikidataQid, byBangumiId, titleIndex }
}

function candidatesFromTitles(titles, indexes) {
  const candidateMap = new Map()
  const matchedTitles = []
  for (const title of titles) {
    const matches = indexes.titleIndex.get(normalizeText(title)) || []
    for (const work of matches) {
      candidateMap.set(val(work.id), work)
      matchedTitles.push(title)
    }
  }
  return { candidates: [...candidateMap.values()], matchedTitles: uniqueBy(matchedTitles, normalizeText) }
}

function matchRow(row, indexes) {
  const qid = qidOf(row)
  const bangumiSubjectId = bangumiSubjectIdOf(row)
  if (qid && indexes.byWikidataQid.has(qid)) return { status: 'matched_by_wikidata_qid', work: indexes.byWikidataQid.get(qid), candidates: [], matchedTitles: [] }
  if (bangumiSubjectId && indexes.byBangumiId.has(bangumiSubjectId)) return { status: 'matched_by_bangumi_id', work: indexes.byBangumiId.get(bangumiSubjectId), candidates: [], matchedTitles: [] }

  const titles = titlesForRow(row)
  const titleMatch = candidatesFromTitles(titles, indexes)
  if (titleMatch.candidates.length === 1) {
    const work = titleMatch.candidates[0]
    const source = sourceOf(work)
    return {
      status: source === 'bangumi' ? 'matched_by_title_with_bangumi_source' : 'matched_by_title_without_bangumi_source',
      work,
      candidates: titleMatch.candidates,
      matchedTitles: titleMatch.matchedTitles,
    }
  }
  if (titleMatch.candidates.length > 1) return { status: 'title_multi_match', work: null, candidates: titleMatch.candidates, matchedTitles: titleMatch.matchedTitles }
  return { status: 'no_match', work: null, candidates: [], matchedTitles: [] }
}

function differenceNormalized(incoming, existing) {
  const existingKeys = new Set(existing.map(normalizeText).filter(Boolean))
  return incoming.filter((item) => !existingKeys.has(normalizeText(item)))
}

function sourceLinkAdditionsFor(row, work, qid) {
  const beforeLinks = work ? sourceLinkRows(work) : []
  const url = wikidataUrl(qid)
  if (!url) return []
  const item = { label: 'Wikidata', url }
  return beforeLinks.some((existing) => normalizeUrl(existing.url) === normalizeUrl(item.url)) ? [] : [item]
}

function candidateSourceAdditionsFor(row, work, qid) {
  const beforeSources = work ? candidateSourceRows(work) : []
  const url = wikidataUrl(qid)
  if (!qid && !url) return []
  const item = {
    source: 'wikidata',
    label: 'Wikidata',
    externalId: qid,
    url,
    note: ['Wikidata work integration audit', SOURCE_PRIORITY_NOTE].join('; '),
  }
  const key = [item.source, item.externalId, normalizeUrl(item.url)].join('|')
  return beforeSources.some((existing) => [val(existing.source), val(existing.externalId), normalizeUrl(existing.url)].join('|') === key) ? [] : [item]
}

function buildPlan(row, indexes) {
  const qid = qidOf(row)
  const titles = titlesForRow(row)
  const match = matchRow(row, indexes)
  const work = match.work
  const warnings = []
  const blockers = []
  const notes = []
  const advisories = adultAdvisories(row)

  if (!qid) blockers.push('missing_wikidata_qid')
  if (match.status === 'title_multi_match') blockers.push('title_multi_match')
  if (match.status === 'no_match') blockers.push('no_existing_work_match')
  if (match.status === 'matched_by_title_without_bangumi_source') blockers.push('matched_work_without_bangumi_source_review_required')
  if (advisories.length) warnings.push('content_advisory_present')

  const existingNames = work ? searchableWorkNames(work) : []
  const searchTextAdditions = work ? differenceNormalized(titles, existingNames) : titles
  if (searchTextAdditions.length) warnings.push('has_search_text_additions')

  const ids = work ? externalIdsOf(work) : {}
  const externalIds = {}
  if (qid && work && !ids.wikidataQid) externalIds.wikidataQid = qid
  else if (qid && ids.wikidataQid && ids.wikidataQid.toUpperCase() !== qid) blockers.push('existing_wikidata_qid_conflict')

  const officialUrl = officialUrlOf(row)
  if (officialUrl && work && !ids.officialUrl) externalIds.officialUrl = officialUrl
  else if (officialUrl && ids.officialUrl && normalizeUrl(ids.officialUrl) !== normalizeUrl(officialUrl)) warnings.push('official_url_diff_or_missing')

  const sourceLinks = work ? sourceLinkAdditionsFor(row, work, qid) : []
  const candidateSources = work ? candidateSourceAdditionsFor(row, work, qid) : []
  if (sourceLinks.length || candidateSources.length) warnings.push('has_source_metadata_additions')

  const incomingYearLabels = incomingYears(row)
  const existingYears = work ? workYearLabels(work) : []
  const sharedYear = incomingYearLabels.some((year) => existingYears.includes(year))
  const yearDiff = incomingYearLabels.length && existingYears.length && !sharedYear ? incomingYearLabels : []
  if (yearDiff.length) blockers.push('year_diff_requires_manual_review')
  if (incomingYearLabels.length && existingYears.length && sharedYear) notes.push('same_year_date_difference_merge_compatible_keep_existing_date')

  const changedFields = []
  if (searchTextAdditions.length) changedFields.push('searchText')
  if (Object.keys(externalIds).length) changedFields.push('externalIds')
  if (sourceLinks.length) changedFields.push('sourceLinks')
  if (candidateSources.length) changedFields.push('candidateSources')
  if (!changedFields.length && !blockers.length) warnings.push('no_new_information_detected')

  let action = 'defer'
  if (work && (match.status === 'matched_by_wikidata_qid' || match.status === 'matched_by_bangumi_id')) action = 'enrich_existing_work'
  else if (work && match.status === 'matched_by_title_with_bangumi_source') action = 'enrich_title_matched_bangumi_work'
  else if (!work && qid) action = 'defer_wikidata_candidate_without_work_match'

  return {
    key: qid || `row:${normalizeText(titles[0] || '')}`,
    qid,
    wikidataUrl: wikidataUrl(qid),
    action,
    matchStatus: match.status,
    planStatus: blockers.length ? 'blocked_or_review_required' : 'ready_for_apply_review',
    confidence: match.status === 'matched_by_wikidata_qid' || match.status === 'matched_by_bangumi_id' ? 'high' : match.status === 'matched_by_title_with_bangumi_source' ? 'medium' : 'review',
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    notes: [...new Set(notes)],
    changedFields,
    contentAdvisories: advisories,
    titleCandidates: titles,
    matchedTitles: match.matchedTitles,
    matchedCandidates: match.candidates.map((item) => ({ id: val(item.id), title: val(item.title), slug: val(item.slug), source: sourceOf(item), wikidataQid: externalIdsOf(item).wikidataQid || '', bangumiSubjectId: externalIdsOf(item).bangumiSubjectId || '' })),
    work: work ? {
      id: val(work.id),
      title: val(work.title),
      slug: val(work.slug),
      source: sourceOf(work),
      bangumiSubjectId: ids.bangumiSubjectId || '',
      wikidataQid: ids.wikidataQid || '',
    } : null,
    fieldAdditions: {
      searchTextAdditions,
      externalIds,
      sourceLinks,
      candidateSources,
    },
    diffReport: {
      incomingYears: incomingYearLabels,
      existingYears,
      differingIncomingYears: yearDiff,
      yearRule: 'If extracted four-digit year matches, merge-compatible; keep existing firstPublished fields unchanged.',
    },
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      proposedWritableFieldsForFuturePass: ['searchText', 'externalIds.wikidataQid', 'externalIds.officialUrl', 'sourceLinks', 'candidateSources'],
      doesNotWriteDateFields: true,
      sameYearDateDiffDoesNotBlock: true,
      differentYearRequiresManualReview: true,
    },
  }
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/u, '')
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const limit = Number(args.limit || 0)
  const email = process.env[EXPORT_EMAIL_ENV] || process.env[SEED_EMAIL_ENV]
  const password = process.env[EXPORT_SECRET_ENV] || process.env[SEED_SECRET_ENV]
  if (!email || !password) throw new Error('Missing Payload login env vars')

  const source = await readJsonl(input)
  const rawRows = limit > 0 ? source.rows.slice(0, limit) : source.rows
  const token = await login(baseUrl, email, password)
  const works = await fetchAllWorks(baseUrl, token, 1)
  const indexes = buildWorkIndexes(works.docs)
  const plans = rawRows.map((row) => buildPlan(row, indexes))

  const ready = plans.filter((row) => row.planStatus === 'ready_for_apply_review')
  const blocked = plans.filter((row) => row.planStatus !== 'ready_for_apply_review')
  fs.mkdirSync(outDir, { recursive: true })

  const outputs = {
    rows: `${outDir}/wikidata-work-integration-v01.rows.jsonl`,
    ready: `${outDir}/wikidata-work-integration-v01-ready.jsonl`,
    blocked: `${outDir}/wikidata-work-integration-v01-blocked.jsonl`,
    sample: `${outDir}/wikidata-work-integration-v01-sample.jsonl`,
    summary: `${outDir}/wikidata-work-integration-v01-summary.json`,
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    payloadBaseUrl: baseUrl,
    rawRowsRead: source.read,
    rawRowsFailed: source.failed,
    rowsProcessed: rawRows.length,
    worksRead: works.docs.length,
    worksTotalDocs: works.totalDocs,
    readyRows: ready.length,
    blockedRows: blocked.length,
    byPlanStatus: countBy(plans, 'planStatus'),
    byAction: countBy(plans, 'action'),
    byMatchStatus: countBy(plans, 'matchStatus'),
    byConfidence: countBy(plans, 'confidence'),
    byChangedField: countBy(plans.flatMap((row) => row.changedFields), (item) => item),
    byBlocker: countBy(plans.flatMap((row) => row.blockers), (item) => item),
    byWarning: countBy(plans.flatMap((row) => row.warnings), (item) => item),
    byNote: countBy(plans.flatMap((row) => row.notes), (item) => item),
    byContentAdvisory: countBy(plans.flatMap((row) => row.contentAdvisories), (item) => item),
    outputs,
    safety: {
      payloadRead: true,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      proposedWritableFieldsForFuturePass: ['searchText', 'externalIds.wikidataQid', 'externalIds.officialUrl', 'sourceLinks', 'candidateSources'],
      doesNotWriteDateFields: true,
      sameYearDateDiffDoesNotBlock: true,
      differentYearRequiresManualReview: true,
      sourcePriority: SOURCE_PRIORITY_NOTE,
    },
    nextStep: 'Review ready/blocked rows. Do not apply from this audit directly; create a guarded apply dry-run only after sampling ready rows.',
  }

  writeJsonl(outputs.rows, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.blocked, blocked)
  writeJsonl(outputs.sample, [...ready.slice(0, 20), ...blocked.slice(0, 20)])
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: source.failed === 0, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
