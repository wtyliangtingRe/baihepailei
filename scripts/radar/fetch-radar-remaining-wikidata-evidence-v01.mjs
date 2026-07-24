#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const VERSION = 'radar-remaining-1122-phase1-source-expansion-v0.1'
export const EXPECTED_ROWS = 1122
export const EXPECTED_SOURCE_COUNTS = { a: 56, b: 400, m: 65, v: 601 }
export const PROPERTY_BY_SOURCE = { a: 'P8729', b: 'P5732', v: 'P3180' }
const UA = 'Baihepailei-Radar-Closeout/1.0 (+private evidence audit)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }

export function canonical(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = canonical(value[key])
    return item === undefined ? [] : [[key, item]]
  }))
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

function required(args, key) {
  const value = val(args[key])
  if (!value) throw new Error(`Required: --${key}`)
  return path.resolve(value)
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function readJsonl(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`Invalid JSONL ${file}:${index + 1}: ${error.message}`) }
  })
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(canonical(value), null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(canonical(row))).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function compactText(value, max = 600) {
  return val(value).replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').slice(0, max)
}

function normalizeUrl(value) {
  try {
    const url = new URL(val(value))
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function providerFamily(value) {
  try {
    let host = new URL(value).hostname.toLowerCase().replace(/^www\./u, '')
    if (host === 'query.wikidata.org' || host === 'wikidata.org' || host.endsWith('.wikidata.org')) return 'wikidata'
    if (host.endsWith('wikipedia.org')) return 'wikipedia'
    if (['bgm.tv', 'api.bgm.tv', 'bangumi.tv'].includes(host)) return 'bangumi'
    if (['anilist.co', 'graphql.anilist.co'].includes(host)) return 'anilist'
    if (['vndb.org', 'api.vndb.org'].includes(host)) return 'vndb'
    return host
  } catch {
    return ''
  }
}

function qidFromUrl(value) {
  return val(value).match(/\/(Q\d+)$/u)?.[1] || ''
}

function curlExecutable() {
  return process.platform === 'win32' ? 'curl.exe' : 'curl'
}

function curlJson({ url, method = 'GET', headers = [], data = [], proxyUrl = '' }) {
  const args = [
    '--fail-with-body',
    '--silent',
    '--show-error',
    '--location',
    '--max-time', '90',
    '--retry', '5',
    '--retry-delay', '2',
    '--retry-all-errors',
    '--user-agent', UA,
    '--header', 'accept: application/json',
  ]
  if (proxyUrl) args.push('--proxy', proxyUrl)
  for (const header of headers) args.push('--header', header)
  if (method !== 'GET') args.push('--request', method)
  for (const item of data) args.push('--data-urlencode', item)
  args.push(url)
  const result = spawnSync(curlExecutable(), args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`curl failed (${result.status}): ${(result.stderr || result.stdout || '').slice(0, 2000)}`)
  }
  try { return JSON.parse(result.stdout) }
  catch (error) { throw new Error(`Invalid JSON from ${url}: ${error.message}; ${result.stdout.slice(0, 1000)}`) }
}

function validateRows(rows) {
  if (rows.length !== EXPECTED_ROWS) throw new Error(`Expected ${EXPECTED_ROWS} rows, received ${rows.length}`)
  const counts = {}
  const workIds = new Set()
  const keys = new Set()
  for (const wrapper of rows) {
    const source = wrapper?.sourceRow || {}
    const workId = val(wrapper?.workId || source.workId)
    const key = val(wrapper?.publicationKey || source.publicationKey)
    const sourceCode = val(source?.sourceEvidence?.sourceCode)
    counts[sourceCode] = (counts[sourceCode] || 0) + 1
    if (!workId || key !== `work:${workId}`) throw new Error(`Invalid identity: ${workId}/${key}`)
    if (workIds.has(workId)) throw new Error(`Duplicate Work ID: ${workId}`)
    if (keys.has(key)) throw new Error(`Duplicate publication key: ${key}`)
    workIds.add(workId)
    keys.add(key)
  }
  const orderedCounts = Object.fromEntries(Object.entries(counts).sort())
  if (JSON.stringify(orderedCounts) !== JSON.stringify(EXPECTED_SOURCE_COUNTS)) {
    throw new Error(`Source counts mismatch: ${JSON.stringify(orderedCounts)}`)
  }
}

function rowCore(wrapper) {
  const source = wrapper.sourceRow
  const evidence = source.sourceEvidence || {}
  return {
    globalRowIndex: Number(source.globalRowIndex),
    workId: val(source.workId),
    publicationKey: val(source.publicationKey),
    title: val(source.title),
    sourceCode: val(evidence.sourceCode),
    sourceId: val(evidence.sourceId),
    existingProviderFamilies: list(evidence.providerFamilies).map(val).filter(Boolean),
  }
}

function sparqlExact(property, ids, proxyUrl) {
  const quoted = ids.map((id) => JSON.stringify(val(id))).join(' ')
  const query = `SELECT ?item ?externalId WHERE {
  VALUES ?externalId { ${quoted} }
  ?item wdt:${property} ?externalId .
}`
  return curlJson({
    url: 'https://query.wikidata.org/sparql',
    method: 'POST',
    headers: [
      'accept: application/sparql-results+json',
      'content-type: application/x-www-form-urlencoded;charset=UTF-8',
    ],
    data: [`query=${query}`, 'format=json'],
    proxyUrl,
  })?.results?.bindings || []
}

function claimValues(entity, property) {
  return list(entity?.claims?.[property]).flatMap((claim) => {
    const value = claim?.mainsnak?.datavalue?.value
    if (typeof value === 'string') return [value]
    if (value?.id) return [value.id]
    if (value?.time) return [value.time]
    if (typeof value?.amount === 'string') return [value.amount]
    return []
  })
}

function labelFor(entity) {
  for (const language of ['zh-hans', 'zh', 'ja', 'en']) {
    const value = entity?.labels?.[language]?.value
    if (value) return value
  }
  return ''
}

function descriptionFor(entity) {
  for (const language of ['zh-hans', 'zh', 'ja', 'en']) {
    const value = entity?.descriptions?.[language]?.value
    if (value) return value
  }
  return ''
}

function sitelinkUrls(entity) {
  const prefixes = {
    zhwiki: 'https://zh.wikipedia.org/wiki/',
    jawiki: 'https://ja.wikipedia.org/wiki/',
    enwiki: 'https://en.wikipedia.org/wiki/',
  }
  return Object.entries(prefixes).flatMap(([site, prefix]) => {
    const title = entity?.sitelinks?.[site]?.title
    return title ? [`${prefix}${encodeURIComponent(title.replaceAll(' ', '_'))}`] : []
  })
}

function fetchEntityBatch(qids, proxyUrl) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: qids.join('|'),
    props: 'labels|descriptions|claims|sitelinks',
    languages: 'zh-hans|zh|ja|en',
    languagefallback: '1',
    format: 'json',
    formatversion: '2',
  })
  return curlJson({ url: `https://www.wikidata.org/w/api.php?${params}`, proxyUrl })?.entities || {}
}

function searchTitle(title, language, proxyUrl) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: title,
    language,
    uselang: language,
    type: 'item',
    limit: '5',
    format: 'json',
    formatversion: '2',
  })
  return curlJson({ url: `https://www.wikidata.org/w/api.php?${params}`, proxyUrl })?.search || []
}

export function riskResolutionFor(wrapper) {
  const source = wrapper.sourceRow || {}
  const signals = list(source?.sourceEvidence?.riskSignals).map(val).filter(Boolean)
  const grade = val(source?.candidate?.grade)
  if (!wrapper?.closeoutTask?.needsRiskAdjudication) {
    return { status: 'not_required', resolvedWithoutMutation: true, signals, grade }
  }
  if (['D', 'E', 'F'].includes(grade)) {
    return {
      status: 'consistent_with_existing_low_grade_no_mutation',
      resolvedWithoutMutation: true,
      signals,
      grade,
      gradeChanged: false,
      ruleChanged: false,
    }
  }
  return {
    status: 'human_adjudication_required_for_high_or_mid_grade',
    resolvedWithoutMutation: false,
    signals,
    grade,
    gradeChanged: false,
    ruleChanged: false,
  }
}

export function reconstructSummary(wrapper) {
  if (!wrapper?.closeoutTask?.needsHumanReadableSourceSummary) {
    return { required: false, reconstructed: false, proposedSourceSummary: '' }
  }
  const source = wrapper.sourceRow || {}
  const evidence = source.sourceEvidence || {}
  const candidate = source.candidate || {}
  const title = val(evidence.structuredTitle || source.title)
  const summary = compactText(evidence.structuredSummary, 420)
  const tagNames = list(evidence.tags)
    .map((item) => val(typeof item === 'string' ? item : item?.name))
    .filter(Boolean)
    .slice(0, 8)
  const pieces = []
  if (summary) pieces.push(`结构化来源对《${title}》的说明为：${summary}`)
  else pieces.push(`结构化来源已确认作品《${title}》的条目身份，但未提供可用简介`)
  if (tagNames.length) pieces.push(`相关标签或分类包括：${tagNames.join('、')}`)
  pieces.push(`当前继续保留 ${val(candidate.grade)}/${val(candidate.decisiveRuleCode)}；本次仅补写来源摘要，不自动更改等级或规则`)
  return {
    required: true,
    reconstructed: true,
    proposedSourceSummary: pieces.join('。') + '。',
    gradeChanged: false,
    ruleChanged: false,
  }
}

export function sourceResolutionFor(wrapper, exactEvidence) {
  if (!wrapper?.closeoutTask?.needsSecondIndependentProvider) {
    return {
      required: false,
      resolved: true,
      method: 'already_sufficient_before_phase1',
      independentProviderCountAfter: Number(wrapper?.closeoutTask?.independentProviderCountBeforeCloseout || 0),
      providerFamiliesAfter: list(wrapper?.sourceRow?.sourceEvidence?.providerFamilies).map(val).filter(Boolean).sort(),
    }
  }
  const current = new Set(list(wrapper?.sourceRow?.sourceEvidence?.providerFamilies).map(val).filter(Boolean))
  if (exactEvidence?.status === 'exact_id_match') current.add('wikidata')
  for (const entity of list(exactEvidence?.entityEvidence)) {
    for (const family of list(entity?.providerFamilies)) current.add(val(family))
  }
  const families = [...current].filter(Boolean).sort()
  return {
    required: true,
    resolved: families.length >= 2 && exactEvidence?.status === 'exact_id_match',
    method: exactEvidence?.status === 'exact_id_match'
      ? 'wikidata_exact_external_identifier'
      : exactEvidence?.status || 'no_exact_evidence',
    independentProviderCountAfter: families.length,
    providerFamiliesAfter: families,
    exactTitleMatchUsed: false,
  }
}

function buildExactEvidence(core, qidMatches, entities) {
  const property = PROPERTY_BY_SOURCE[core.sourceCode]
  const entityEvidence = qidMatches.map((qid) => {
    const entity = entities[qid] || {}
    const itemUrl = `https://www.wikidata.org/wiki/${qid}`
    const officialWebsiteURLs = claimValues(entity, 'P856').map(normalizeUrl).filter(Boolean)
    const wikipediaURLs = sitelinkUrls(entity)
    const traceableURLs = [...new Set([itemUrl, ...officialWebsiteURLs, ...wikipediaURLs])]
    return {
      qid,
      itemUrl,
      label: labelFor(entity),
      description: descriptionFor(entity),
      officialWebsiteURLs,
      wikipediaURLs,
      instanceOfQids: claimValues(entity, 'P31'),
      genreQids: claimValues(entity, 'P136'),
      publicationDates: claimValues(entity, 'P577'),
      traceableURLs,
      providerFamilies: [...new Set(traceableURLs.map(providerFamily).filter(Boolean))].sort(),
    }
  })
  const status = qidMatches.length === 0
    ? 'not_found'
    : qidMatches.length === 1
      ? 'exact_id_match'
      : 'ambiguous_exact_id_matches'
  return {
    schemaVersion: 1,
    ...core,
    wikidataProperty: property,
    status,
    exactMatchCount: qidMatches.length,
    qids: qidMatches,
    entityEvidence,
    addsIndependentProvider: status === 'exact_id_match',
    sourceBinding: {
      matchMethod: 'exact_external_identifier',
      property,
      sourceId: core.sourceId,
      titleOnlyMatchingUsed: false,
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      productionApplyAuthorized: false,
    },
  }
}

function finalizeRows(wrappers, exactByWorkId, titleByWorkId) {
  return wrappers.map((wrapper) => {
    const workId = val(wrapper.workId)
    const exact = exactByWorkId.get(workId) || null
    const source = sourceResolutionFor(wrapper, exact)
    const risk = riskResolutionFor(wrapper)
    const summary = reconstructSummary(wrapper)
    const fresh = wrapper?.closeoutTask?.needsFreshResearch === true
    const manualConflict = wrapper?.closeoutTask?.needsManualConflictDecision === true
    let phase1Status = 'phase1_ready_for_guard_or_assembly_review'
    if (fresh) phase1Status = 'phase1_requires_fresh_research'
    else if (manualConflict) phase1Status = 'phase1_requires_manual_conflict_decision'
    else if (!source.resolved) phase1Status = 'phase1_requires_additional_source'
    else if (!risk.resolvedWithoutMutation) phase1Status = 'phase1_requires_human_risk_adjudication'
    else if (summary.required && !summary.reconstructed) phase1Status = 'phase1_requires_source_summary'
    return canonical({
      schemaVersion: 1,
      campaign: 'radar-remaining-1122-unified-closeout-v0.1',
      workId,
      publicationKey: val(wrapper.publicationKey),
      title: val(wrapper.title),
      primaryLane: val(wrapper?.closeoutTask?.primaryLane),
      phase1Status,
      sourceResolution: source,
      riskResolution: risk,
      sourceSummaryResolution: summary,
      publicationGuardAuditRequired: wrapper?.closeoutTask?.needsPublicationGuardAudit === true,
      freshResearchRequired: fresh,
      manualConflictDecisionRequired: manualConflict,
      exactWikidataEvidence: exact,
      mgv2TitleCandidates: titleByWorkId.get(workId) || null,
      productionApplyAuthorized: false,
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const closeoutDir = required(args, 'closeout-dir')
  const outDir = required(args, 'out-dir')
  const workDir = required(args, 'work-dir')
  const proxyUrl = val(args['proxy-url'])
  const input = path.join(closeoutDir, 'remaining-1122-all.jsonl')
  if (!fs.existsSync(input)) throw new Error(`Missing closeout input: ${input}`)
  const wrappers = readJsonl(input)
  validateRows(wrappers)

  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(workDir, { recursive: true })
  const exactCheckpoint = path.join(workDir, 'exact-match-checkpoint.json')
  const entityCheckpoint = path.join(workDir, 'entity-checkpoint.json')
  const titleCheckpoint = path.join(workDir, 'mgv2-title-checkpoint.json')
  const exactMapObject = readJson(exactCheckpoint, {})
  const entityCache = readJson(entityCheckpoint, {})
  const titleCache = readJson(titleCheckpoint, {})

  const exactWrappers = wrappers.filter((wrapper) => PROPERTY_BY_SOURCE[val(wrapper?.sourceRow?.sourceEvidence?.sourceCode)])
  for (const sourceCode of ['a', 'b', 'v']) {
    const property = PROPERTY_BY_SOURCE[sourceCode]
    const sourceRows = exactWrappers.filter((wrapper) => val(wrapper?.sourceRow?.sourceEvidence?.sourceCode) === sourceCode)
    for (let offset = 0; offset < sourceRows.length; offset += 100) {
      const batch = sourceRows.slice(offset, offset + 100)
      const missing = batch.filter((wrapper) => {
        const sourceId = val(wrapper?.sourceRow?.sourceEvidence?.sourceId)
        return !Object.prototype.hasOwnProperty.call(exactMapObject, `${sourceCode}:${sourceId}`)
      })
      if (missing.length) {
        const bindings = sparqlExact(property, missing.map((wrapper) => wrapper.sourceRow.sourceEvidence.sourceId), proxyUrl)
        const returned = new Map()
        for (const binding of bindings) {
          const externalId = val(binding?.externalId?.value)
          const qid = qidFromUrl(binding?.item?.value)
          if (!externalId || !qid) continue
          const values = returned.get(externalId) || new Set()
          values.add(qid)
          returned.set(externalId, values)
        }
        for (const wrapper of missing) {
          const sourceId = val(wrapper.sourceRow.sourceEvidence.sourceId)
          exactMapObject[`${sourceCode}:${sourceId}`] = [...(returned.get(sourceId) || new Set())].sort()
        }
        writeJson(exactCheckpoint, exactMapObject)
      }
      console.log(`${sourceCode}/${property} ${Math.min(offset + batch.length, sourceRows.length)}/${sourceRows.length}`)
      await sleep(800)
    }
  }

  const allQids = [...new Set(Object.values(exactMapObject).flatMap((items) => list(items)))].sort()
  for (let offset = 0; offset < allQids.length; offset += 50) {
    const batch = allQids.slice(offset, offset + 50)
    const missing = batch.filter((qid) => !entityCache[qid])
    if (missing.length) {
      Object.assign(entityCache, fetchEntityBatch(missing, proxyUrl))
      writeJson(entityCheckpoint, entityCache)
    }
    console.log(`Wikidata entities ${Math.min(offset + batch.length, allQids.length)}/${allQids.length}`)
    await sleep(350)
  }

  const exactEvidence = exactWrappers.map((wrapper) => {
    const core = rowCore(wrapper)
    const qids = list(exactMapObject[`${core.sourceCode}:${core.sourceId}`]).map(val).filter(Boolean).sort()
    return buildExactEvidence(core, qids, entityCache)
  }).sort((a, b) => a.globalRowIndex - b.globalRowIndex)

  const mgv2Wrappers = wrappers.filter((wrapper) => val(wrapper?.sourceRow?.sourceEvidence?.sourceCode) === 'm')
  for (let index = 0; index < mgv2Wrappers.length; index += 1) {
    const wrapper = mgv2Wrappers[index]
    const workId = val(wrapper.workId)
    if (!titleCache[workId]) {
      const searches = {}
      for (const language of ['ja', 'en', 'zh']) {
        try { searches[language] = searchTitle(val(wrapper.title), language, proxyUrl) }
        catch (error) { searches[language] = [{ error: String(error?.message || error) }] }
        await sleep(250)
      }
      titleCache[workId] = {
        schemaVersion: 1,
        ...rowCore(wrapper),
        status: 'title_search_candidates_only',
        titleOnlyMatchingUsed: true,
        exactIdentityEstablished: false,
        searches,
        addsIndependentProvider: false,
        requiresHumanIdentityAdjudication: true,
        safety: {
          payloadRead: false,
          payloadWrite: false,
          postgresqlRead: false,
          postgresqlWrite: false,
          productionApplyAuthorized: false,
        },
      }
      writeJson(titleCheckpoint, titleCache)
    }
    if ((index + 1) % 10 === 0 || index + 1 === mgv2Wrappers.length) {
      console.log(`MGV2 title candidates ${index + 1}/${mgv2Wrappers.length}`)
    }
  }

  const titleEvidence = Object.values(titleCache).sort((a, b) => Number(a.globalRowIndex) - Number(b.globalRowIndex))
  const exactByWorkId = new Map(exactEvidence.map((row) => [val(row.workId), row]))
  const titleByWorkId = new Map(titleEvidence.map((row) => [val(row.workId), row]))
  const phase1Rows = finalizeRows(wrappers, exactByWorkId, titleByWorkId)

  writeJsonl(path.join(outDir, 'wikidata-exact-id-evidence.jsonl'), exactEvidence)
  writeJsonl(path.join(outDir, 'wikidata-mgv2-title-candidates.jsonl'), titleEvidence)
  writeJsonl(path.join(outDir, 'remaining-1122-phase1-resolution.jsonl'), phase1Rows)
  writeJsonl(path.join(outDir, 'phase1-ready-for-guard-or-assembly-review.jsonl'), phase1Rows.filter((row) => row.phase1Status === 'phase1_ready_for_guard_or_assembly_review'))
  writeJsonl(path.join(outDir, 'phase1-additional-source-needed.jsonl'), phase1Rows.filter((row) => row.phase1Status === 'phase1_requires_additional_source'))
  writeJsonl(path.join(outDir, 'phase1-human-risk-or-conflict.jsonl'), phase1Rows.filter((row) => ['phase1_requires_human_risk_adjudication', 'phase1_requires_manual_conflict_decision'].includes(row.phase1Status)))
  writeJsonl(path.join(outDir, 'phase1-fresh-research.jsonl'), phase1Rows.filter((row) => row.phase1Status === 'phase1_requires_fresh_research'))

  const countBy = (getter) => {
    const result = {}
    for (const row of phase1Rows) {
      const key = val(getter(row)) || 'missing'
      result[key] = (result[key] || 0) + 1
    }
    return Object.fromEntries(Object.entries(result).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  }
  const summary = canonical({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    rows: phase1Rows.length,
    uniqueWorkIds: new Set(phase1Rows.map((row) => row.workId)).size,
    uniquePublicationKeys: new Set(phase1Rows.map((row) => row.publicationKey)).size,
    exactIdRows: exactEvidence.length,
    mgv2TitleCandidateRows: titleEvidence.length,
    exactIdByStatus: Object.fromEntries([...new Set(exactEvidence.map((row) => row.status))].sort().map((status) => [status, exactEvidence.filter((row) => row.status === status).length])),
    phase1ByStatus: countBy((row) => row.phase1Status),
    sourceResolvedRows: phase1Rows.filter((row) => row.sourceResolution.resolved).length,
    riskResolvedWithoutMutationRows: phase1Rows.filter((row) => row.riskResolution.resolvedWithoutMutation).length,
    reconstructedSourceSummaryRows: phase1Rows.filter((row) => row.sourceSummaryResolution.reconstructed).length,
    publicationGuardAuditRows: phase1Rows.filter((row) => row.publicationGuardAuditRequired).length,
    titleOnlyMatchesAcceptedAutomatically: false,
    gradeMutationRows: 0,
    ruleMutationRows: 0,
    proxyUsed: Boolean(proxyUrl),
    properties: {
      bangumiSubjectId: 'P5732',
      anilistAnimeId: 'P8729',
      visualNovelDatabaseId: 'P3180',
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlRead: false,
      postgresqlWrite: false,
      productionApplyAuthorized: false,
    },
  })
  writeJson(path.join(outDir, 'phase1-source-expansion-summary.json'), summary)

  const manifest = fs.readdirSync(outDir)
    .filter((name) => name !== 'manifest.json')
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(outDir, name))
      return { file: name, bytes: bytes.length, sha256: sha256(bytes) }
    })
  writeJson(path.join(outDir, 'manifest.json'), manifest)
  console.log(JSON.stringify(summary, null, 2))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
