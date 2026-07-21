#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { classifyRadarCoverage } from './audit-ai-radar-coverage-v01.mjs'

const VERSION = 'ai-radar-history-inventory-v0.1'
const GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'X'])
const DEFAULT_ARTIFACT_ROOT = 'data_local/staging/ai-radar'
const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/history-inventory-v01'

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

function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['docs', 'rows', 'records', 'items', 'works', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  return [parsed]
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function countBy(values) {
  const counts = {}
  for (const raw of values) {
    const key = val(raw) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function isGrade(value) {
  return GRADES.has(val(value))
}

function relationId(value) {
  if (typeof value === 'number' || typeof value === 'string') return val(value)
  return val(value?.id || value?.value)
}

function workIdOfResearch(row) {
  return relationId(row?.work) || val(row?.workIdSnapshot)
}

function isCurrentResearch(row) {
  return val(row?.recordStatus) !== 'archived'
}

export function classifyResearchProposal(row) {
  const best = val(row?.proposedBestGrade)
  const likely = val(row?.proposedLikelyGrade)
  const worst = val(row?.proposedWorstGrade)
  if (isGrade(best) && isGrade(likely) && isGrade(worst)) return 'bounded_range'
  if (isGrade(likely)) return 'likely_only'
  return 'no_grade_suggestion'
}

function compactResearch(row, work, coverageMode) {
  return {
    researchId: val(row?.id),
    researchKey: val(row?.researchKey),
    programId: val(row?.programId),
    importBatch: val(row?.importBatch),
    batchId: val(row?.batchId),
    researchStatus: val(row?.researchStatus),
    recordShape: val(row?.recordShape),
    lane: val(row?.lane),
    workId: val(work?.id) || workIdOfResearch(row),
    workSiteId: val(work?.siteId || row?.workSiteId),
    title: val(work?.title || row?.title),
    workCoverageMode: coverageMode,
    proposalMode: classifyResearchProposal(row),
    proposedBestGrade: val(row?.proposedBestGrade),
    proposedLikelyGrade: val(row?.proposedLikelyGrade),
    proposedWorstGrade: val(row?.proposedWorstGrade),
    confidencePercent: row?.confidencePercent ?? null,
    sourceCount: list(row?.sources).length,
    unresolvedQuestionCount: list(row?.unresolvedQuestions).length,
    recommendedNextAction: val(row?.recommendedNextAction),
    recommendedNextQueue: val(row?.recommendedNextQueue),
  }
}

function meaningfulRadar(row) {
  return row?.radarAssessment && typeof row.radarAssessment === 'object'
    ? row.radarAssessment
    : row?.existingState?.radarAssessment && typeof row.existingState.radarAssessment === 'object'
      ? row.existingState.radarAssessment
      : {}
}

export function buildHistoryInventory(works, researchRows, options = {}) {
  const workById = new Map()
  const workBySiteId = new Map()
  const coverageByWorkId = new Map()

  for (const work of works) {
    const id = val(work?.id || work?.workId)
    const siteId = val(work?.siteId)
    const coverage = classifyRadarCoverage(work)
    if (id) {
      workById.set(id, work)
      coverageByWorkId.set(id, coverage)
    }
    if (siteId) workBySiteId.set(siteId, work)
  }

  const currentResearch = researchRows.filter(isCurrentResearch)
  const resolvedCurrentResearch = []
  const unresolvedCurrentResearch = []
  const currentResearchByWork = new Map()

  for (const row of currentResearch) {
    const rawWorkId = workIdOfResearch(row)
    const siteId = val(row?.workSiteId)
    const work = workById.get(rawWorkId) || workBySiteId.get(siteId) || null
    if (!work) {
      unresolvedCurrentResearch.push(compactResearch(row, null, 'missing_work'))
      continue
    }
    const workId = val(work?.id || work?.workId)
    const coverage = coverageByWorkId.get(workId) || classifyRadarCoverage(work)
    const compact = compactResearch(row, work, coverage)
    resolvedCurrentResearch.push(compact)
    if (!currentResearchByWork.has(workId)) currentResearchByWork.set(workId, [])
    currentResearchByWork.get(workId).push(compact)
  }

  const formalModes = new Set(['fixed_grade', 'bounded_range'])
  const reusableResearchCandidates = resolvedCurrentResearch.filter((row) => (
    !formalModes.has(row.workCoverageMode)
    && ['bounded_range', 'likely_only'].includes(row.proposalMode)
  ))
  const reusableWorkIds = new Set(reusableResearchCandidates.map((row) => row.workId))
  const anyCurrentResearchWorkIds = new Set(resolvedCurrentResearch.map((row) => row.workId))
  const formalWorkIds = new Set(
    works
      .filter((work) => formalModes.has(classifyRadarCoverage(work)))
      .map((work) => val(work?.id || work?.workId))
      .filter(Boolean),
  )
  const incompleteWorkIds = new Set(
    works
      .filter((work) => classifyRadarCoverage(work) === 'scanned_without_valid_conclusion')
      .map((work) => val(work?.id || work?.workId))
      .filter(Boolean),
  )
  const unscannedWorkIds = new Set(
    works
      .filter((work) => classifyRadarCoverage(work) === 'unscanned')
      .map((work) => val(work?.id || work?.workId))
      .filter(Boolean),
  )

  const duplicateResearchWorks = [...currentResearchByWork.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([workId, rows]) => ({ workId, recordCount: rows.length, researchIds: rows.map((row) => row.researchId) }))

  const worksWithoutFormalOrCurrentResearch = works.filter((work) => {
    const workId = val(work?.id || work?.workId)
    return workId && !formalWorkIds.has(workId) && !anyCurrentResearchWorkIds.has(workId)
  })

  const worksWithoutFormalOrReusableResearch = works.filter((work) => {
    const workId = val(work?.id || work?.workId)
    return workId && !formalWorkIds.has(workId) && !reusableWorkIds.has(workId)
  })

  const scannedWithoutValidConclusion = works
    .filter((work) => classifyRadarCoverage(work) === 'scanned_without_valid_conclusion')
    .map((work) => {
      const radar = meaningfulRadar(work)
      return {
        workId: val(work?.id || work?.workId),
        siteId: val(work?.siteId),
        title: val(work?.title),
        suggestedGrade: val(radar?.suggestedGrade),
        assessedAt: val(radar?.assessedAt),
        assessmentBatch: val(radar?.assessmentBatch),
        policyVersion: val(radar?.policyVersion),
        evidenceStatus: val(radar?.evidenceStatus),
        sourceCount: Number(radar?.sourceCount || 0),
      }
    })

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    sources: options.sources || null,
    works: {
      rowsRead: works.length,
      byCoverageMode: countBy(works.map(classifyRadarCoverage)),
      fixedGradeRows: formalWorkIds.size - works.filter((work) => classifyRadarCoverage(work) === 'bounded_range').length,
      boundedRangeRows: works.filter((work) => classifyRadarCoverage(work) === 'bounded_range').length,
      scannedWithoutValidConclusionRows: incompleteWorkIds.size,
      unscannedRows: unscannedWorkIds.size,
      bySuggestedGrade: countBy(works.map((work) => meaningfulRadar(work)?.suggestedGrade)),
      withAssessedAt: works.filter((work) => val(meaningfulRadar(work)?.assessedAt)).length,
      withAssessmentBatch: works.filter((work) => val(meaningfulRadar(work)?.assessmentBatch)).length,
      withPolicyVersion: works.filter((work) => val(meaningfulRadar(work)?.policyVersion)).length,
    },
    research: {
      rowsRead: researchRows.length,
      currentRows: currentResearch.length,
      archivedRows: researchRows.length - currentResearch.length,
      uniqueResolvedWorks: anyCurrentResearchWorkIds.size,
      unresolvedCurrentRows: unresolvedCurrentResearch.length,
      duplicateCurrentResearchWorks: duplicateResearchWorks.length,
      byRecordStatus: countBy(researchRows.map((row) => row?.recordStatus)),
      byResearchStatus: countBy(currentResearch.map((row) => row?.researchStatus)),
      byRecordShape: countBy(currentResearch.map((row) => row?.recordShape)),
      byProposalMode: countBy(currentResearch.map(classifyResearchProposal)),
      byLikelyGrade: countBy(currentResearch.map((row) => row?.proposedLikelyGrade)),
      withSources: currentResearch.filter((row) => list(row?.sources).length > 0).length,
      withUnresolvedQuestions: currentResearch.filter((row) => list(row?.unresolvedQuestions).length > 0).length,
    },
    overlap: {
      worksWithFormalAiConclusion: formalWorkIds.size,
      formalWorksAlsoHavingCurrentResearch: [...formalWorkIds].filter((id) => anyCurrentResearchWorkIds.has(id)).length,
      nonFormalWorksWithAnyCurrentResearch: [...anyCurrentResearchWorkIds].filter((id) => !formalWorkIds.has(id)).length,
      nonFormalWorksWithReusableResearch: reusableWorkIds.size,
      scannedWithoutConclusionWithReusableResearch: [...incompleteWorkIds].filter((id) => reusableWorkIds.has(id)).length,
      unscannedWithReusableResearch: [...unscannedWorkIds].filter((id) => reusableWorkIds.has(id)).length,
      worksWithoutFormalOrCurrentResearch: worksWithoutFormalOrCurrentResearch.length,
      worksWithoutFormalOrReusableResearch: worksWithoutFormalOrReusableResearch.length,
    },
    safety: {
      payloadRead: options.payloadRead === true,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      modifiesResearchRecords: false,
    },
    interpretation: [
      'Works coverage counts only formal radarAssessment conclusions, not ratingNotice or evidenceStrength.',
      'Research proposals are reusable evidence candidates, not automatic Works ratings.',
      'A likely-only research record needs deterministic conversion to a bounded range or new assessment before publication.',
      'Historical local v0.6 artifacts must be checked separately before any re-assessment or migration plan.',
    ],
  }

  return {
    summary,
    reusableResearchCandidates,
    unresolvedCurrentResearch,
    duplicateResearchWorks,
    scannedWithoutValidConclusion,
    worksWithoutFormalOrCurrentResearch: worksWithoutFormalOrCurrentResearch.map((work) => ({
      workId: val(work?.id || work?.workId),
      siteId: val(work?.siteId),
      title: val(work?.title),
      coverageMode: classifyRadarCoverage(work),
    })),
    worksWithoutFormalOrReusableResearch: worksWithoutFormalOrReusableResearch.map((work) => ({
      workId: val(work?.id || work?.workId),
      siteId: val(work?.siteId),
      title: val(work?.title),
      coverageMode: classifyRadarCoverage(work),
    })),
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 800)}`)
  return body
}

async function login(baseUrl, email, password) {
  const body = await requestJson(`${baseUrl}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  const token = val(body?.token)
  if (!token) throw new Error('Payload login response did not include a token')
  return token
}

async function readCollection(baseUrl, token, slug) {
  const rows = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({ limit: '200', page: String(page), depth: '0', sort: 'id' })
    const body = await requestJson(`${baseUrl}/api/${slug}?${params}`, {
      headers: { authorization: `JWT ${token}` },
    })
    const docs = list(body?.docs)
    rows.push(...docs)
    if (!body?.hasNextPage || docs.length === 0) break
    page += 1
  }
  return rows
}

function listV06SummaryFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  const walk = (dir, depth = 0) => {
    if (depth > 10) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(file, depth + 1)
        continue
      }
      const lower = file.toLowerCase()
      if (!lower.includes('v06') || !lower.endsWith('.json') || !entry.name.toLowerCase().includes('summary')) continue
      if (fs.statSync(file).size > 5 * 1024 * 1024) continue
      files.push(file)
    }
  }
  walk(root)
  return files.sort()
}

function compactArtifactSummary(root, file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
    const source = parsed?.summary && typeof parsed.summary === 'object' ? parsed.summary : parsed
    const numericKeys = [
      'rows', 'rowsRead', 'planRows', 'planRowsRead', 'readyForPayloadPlanning',
      'blockedBeforePayloadPlanning', 'wouldUpdate', 'blocked', 'alreadyCurrent',
      'pendingOriginal', 'alreadyApplied', 'drifted', 'payloadPatchRequests',
    ]
    const counts = {}
    for (const key of numericKeys) {
      if (Number.isFinite(Number(source?.[key]))) counts[key] = Number(source[key])
    }
    return {
      file: path.relative(root, file),
      version: val(source?.version),
      complete: source?.complete ?? null,
      batchId: val(source?.batchId),
      generatedAt: val(source?.generatedAt),
      counts,
    }
  } catch (error) {
    return { file: path.relative(root, file), error: val(error?.message || error) }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args.publish) {
    throw new Error('History inventory is read-only. Execute/apply/write/patch/publish flags are rejected.')
  }

  const baseUrl = val(args.url || process.env.PAYLOAD_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const worksFile = val(args['works-file'])
  const researchFile = val(args['research-file'])
  let works = worksFile ? readRows(worksFile) : null
  let researchRows = researchFile ? readRows(researchFile) : null
  let payloadRead = false

  if (!works || !researchRows) {
    const email = val(args.email || process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL || process.env.SITE_OWNER_EMAIL)
    const password = val(args.password || process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
    if (!email || !password) {
      throw new Error('Payload credentials are required unless both --works-file and --research-file are supplied.')
    }
    const token = await login(baseUrl, email, password)
    if (!works) works = await readCollection(baseUrl, token, 'works')
    if (!researchRows) researchRows = await readCollection(baseUrl, token, 'radar-research-records')
    payloadRead = true
  }

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${process.pid}`
  const outDir = val(args['out-dir']) || path.join(DEFAULT_OUT_ROOT, runId)
  if (fs.existsSync(outDir)) throw new Error(`Output directory already exists: ${outDir}`)

  const inventory = buildHistoryInventory(works, researchRows, {
    payloadRead,
    sources: {
      works: worksFile || baseUrl,
      research: researchFile || baseUrl,
    },
  })

  const artifactRoot = val(args['artifact-root']) || DEFAULT_ARTIFACT_ROOT
  const artifactFiles = args['no-local-artifacts'] ? [] : listV06SummaryFiles(artifactRoot)
  const artifactSummaries = artifactFiles.map((file) => compactArtifactSummary(artifactRoot, file))
  const topLevelArtifacts = artifactSummaries.filter((item) => !/[\\/]batches[\\/]/u.test(item.file))
  inventory.summary.localV06Artifacts = {
    root: artifactRoot,
    rootExists: fs.existsSync(artifactRoot),
    summaryFilesFound: artifactSummaries.length,
    topLevelSummaryFiles: topLevelArtifacts.length,
    topLevelSummaries: topLevelArtifacts.slice(0, 100),
  }

  const outputs = {
    summary: path.join(outDir, 'summary.json'),
    reusableResearchCandidates: path.join(outDir, 'reusable-research-candidates.jsonl'),
    scannedWithoutValidConclusion: path.join(outDir, 'scanned-without-valid-conclusion.jsonl'),
    unresolvedCurrentResearch: path.join(outDir, 'unresolved-current-research.jsonl'),
    duplicateResearchWorks: path.join(outDir, 'duplicate-current-research-works.jsonl'),
    worksWithoutFormalOrCurrentResearch: path.join(outDir, 'works-without-formal-or-current-research.jsonl'),
    worksWithoutFormalOrReusableResearch: path.join(outDir, 'works-without-formal-or-reusable-research.jsonl'),
    localV06ArtifactSummaries: path.join(outDir, 'local-v06-artifact-summaries.json'),
  }
  inventory.summary.outputs = outputs

  writeJson(outputs.summary, inventory.summary)
  writeJsonl(outputs.reusableResearchCandidates, inventory.reusableResearchCandidates)
  writeJsonl(outputs.scannedWithoutValidConclusion, inventory.scannedWithoutValidConclusion)
  writeJsonl(outputs.unresolvedCurrentResearch, inventory.unresolvedCurrentResearch)
  writeJsonl(outputs.duplicateResearchWorks, inventory.duplicateResearchWorks)
  writeJsonl(outputs.worksWithoutFormalOrCurrentResearch, inventory.worksWithoutFormalOrCurrentResearch)
  writeJsonl(outputs.worksWithoutFormalOrReusableResearch, inventory.worksWithoutFormalOrReusableResearch)
  writeJson(outputs.localV06ArtifactSummaries, artifactSummaries)

  console.log(JSON.stringify({ ok: true, summary: inventory.summary }, null, 2))
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
