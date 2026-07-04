#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_ROOT = 'data_local'
const DEFAULT_OUT_DIR = 'data_local/staging/source-coverage'
const DEFAULT_URL = 'http://localhost:3000'
const PAGE_LIMIT = 100
const MAX_JSON_PARSE_BYTES = 50 * 1024 * 1024

const DEFAULT_SCAN_DIRS = [
  'raw',
  'normalized',
  'candidates',
  'deduped',
  'import_ready',
  'payload',
  'staging',
  'handoff',
  'reports',
]

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'media',
  'backups',
  'tmp',
  'archive',
])

function parseArgs(argv) {
  const args = {}

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }

    args[key] = next
    index += 1
  }

  return args
}

function usage() {
  console.log(`Usage:
  node scripts/import/audit-source-coverage-v01.mjs [--root data_local] [--out-dir <dir>] [--url http://localhost:3000] [--no-payload]

Optional environment variables for Payload API comparison:
  PAYLOAD_SEED_EMAIL
  PAYLOAD_SEED_PASSWORD

This is a read-only source coverage audit:
  - Scans local data source folders under data_local.
  - Infers file counts, source hints, stages, extensions, byte sizes, and lightweight record counts.
  - Optionally reads Payload works through the HTTP API when credentials are provided.
  - Compares local source hints with current Payload chosenBaseSource distribution.
  - Writes JSON / summary JSON / Markdown reports to data_local/staging/source-coverage by default.

Safety:
  - No Payload write.
  - No PostgreSQL write.
  - No importer apply.
  - No delete.
  - No data_local output should be committed.
`)
}

function asText(value) {
  return String(value || '').trim()
}

function normalizePathForReport(value) {
  return value.split(path.sep).join('/')
}

function inc(map, key, amount = 1) {
  const normalized = asText(key) || 'missing'
  map[normalized] = (map[normalized] || 0) + amount
}

function addSourceStat(map, source, file) {
  if (!map[source]) {
    map[source] = {
      files: 0,
      bytes: 0,
      inferredRecords: 0,
      inferredRecordFiles: 0,
    }
  }

  map[source].files += 1
  map[source].bytes += file.sizeBytes

  if (Number.isFinite(file.inferredRecordCount)) {
    map[source].inferredRecords += file.inferredRecordCount
    map[source].inferredRecordFiles += 1
  }
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => {
    if (typeof a[1] === 'number' && typeof b[1] === 'number' && b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  }))
}

function sortSourceStats(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => {
    if (b[1].files !== a[1].files) return b[1].files - a[1].files
    return a[0].localeCompare(b[0])
  }))
}

function detectSourceHints(relativePath) {
  const lower = relativePath.toLowerCase()
  const hints = new Set()

  if (lower.includes('mangadex')) hints.add('mangadex')
  if (lower.includes('steam')) hints.add('steam')
  if (lower.includes('yurizukan') || lower.includes('yuri-zukan')) hints.add('yurizukan')
  if (lower.includes('bangumi') || /(^|[/_.-])bgm([/_.-]|$)/u.test(lower)) hints.add('bangumi')
  if (lower.includes('anilist')) hints.add('anilist')
  if (lower.includes('vndb')) hints.add('vndb')
  if (lower.includes('wikidata')) hints.add('wikidata')
  if (lower.includes('wikipedia')) hints.add('wikipedia')
  if (lower.includes('moegirl')) hints.add('moegirl')
  if (lower.includes('ndl')) hints.add('ndl')
  if (lower.includes('xwiki')) hints.add('xwiki')
  if (lower.includes('public-catalog')) hints.add('public-catalog')
  if (lower.includes('merge-groups')) hints.add('merge-groups')
  if (lower.includes('radar')) hints.add('radar')

  return [...hints].sort()
}

function walkFiles(rootDir, scanDirs) {
  const files = []

  for (const dirName of scanDirs) {
    const start = path.join(rootDir, dirName)
    if (!fs.existsSync(start)) continue

    const stack = [start]

    while (stack.length) {
      const current = stack.pop()
      const entries = fs.readdirSync(current, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name)

        if (entry.isDirectory()) {
          if (IGNORED_DIR_NAMES.has(entry.name)) continue
          stack.push(fullPath)
          continue
        }

        if (!entry.isFile()) continue
        files.push(fullPath)
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b))
  return files
}

async function countLines(filePath) {
  return new Promise((resolve, reject) => {
    let lines = 0
    let lastByte = null
    const stream = fs.createReadStream(filePath)

    stream.on('data', (chunk) => {
      for (const byte of chunk) {
        if (byte === 10) lines += 1
      }
      lastByte = chunk[chunk.length - 1]
    })

    stream.on('error', reject)
    stream.on('end', () => {
      if (lastByte !== null && lastByte !== 10) lines += 1
      resolve(lines)
    })
  })
}

function inferJsonRecordCount(value) {
  if (Array.isArray(value)) {
    return { count: value.length, note: 'json_array' }
  }

  if (!value || typeof value !== 'object') {
    return { count: null, note: 'json_non_object' }
  }

  const candidateKeys = [
    'docs',
    'rows',
    'records',
    'works',
    'items',
    'candidates',
    'data',
    'results',
    'subjects',
    'entities',
  ]

  for (const key of candidateKeys) {
    if (Array.isArray(value[key])) {
      return { count: value[key].length, note: `json_key:${key}` }
    }
  }

  return { count: null, note: 'json_no_known_array' }
}

async function inferRecordCount(filePath, extension, sizeBytes) {
  if (extension === '.jsonl' || extension === '.ndjson') {
    const count = await countLines(filePath)
    return { count, note: extension.slice(1) }
  }

  if (extension === '.csv') {
    const lines = await countLines(filePath)
    return { count: Math.max(0, lines - 1), note: 'csv_rows_excluding_header' }
  }

  if (extension === '.json') {
    if (sizeBytes > MAX_JSON_PARSE_BYTES) {
      return { count: null, note: `json_skipped_large>${MAX_JSON_PARSE_BYTES}` }
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      return inferJsonRecordCount(parsed)
    } catch (error) {
      return { count: null, note: `json_parse_failed:${error.message}` }
    }
  }

  return { count: null, note: 'not_counted' }
}

async function scanLocalSources(rootDir, scanDirs) {
  const resolvedRoot = path.resolve(rootDir)
  const discovered = walkFiles(resolvedRoot, scanDirs)
  const files = []

  for (const filePath of discovered) {
    const stat = fs.statSync(filePath)
    const relativePath = normalizePathForReport(path.relative(resolvedRoot, filePath))
    const stage = relativePath.split('/')[0] || 'missing'
    const extension = path.extname(filePath).toLowerCase() || '[none]'
    const sourceHints = detectSourceHints(relativePath)
    const inferred = await inferRecordCount(filePath, extension, stat.size)

    files.push({
      path: relativePath,
      stage,
      extension,
      sizeBytes: stat.size,
      sourceHints,
      inferredRecordCount: inferred.count,
      inferredRecordNote: inferred.note,
    })
  }

  return files
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

  if (!result?.token) {
    throw new Error('Payload login succeeded but did not return a token.')
  }

  return result.token
}

function authHeaders(token) {
  return { Authorization: `JWT ${token}` }
}

async function fetchAllWorks(baseUrl, token) {
  const docs = []
  let page = 1
  let totalPages = 1
  let totalDocs = 0

  while (page <= totalPages) {
    const result = await requestJson(`${baseUrl}/api/works?limit=${PAGE_LIMIT}&page=${page}&depth=0`, {
      headers: authHeaders(token),
    })

    totalPages = Number(result.totalPages || 1)
    totalDocs = Number(result.totalDocs || 0)
    docs.push(...(Array.isArray(result.docs) ? result.docs : []))
    page += 1
  }

  return { totalDocs, docs }
}

function splitListLike(value) {
  return String(value || '')
    .split(/[;|,\n]/u)
    .map(asText)
    .filter(Boolean)
}

function reviewReasons(work) {
  const value = work?.reviewReasons
  const values = Array.isArray(value) ? value : splitListLike(value)
  return [...new Set(values.map(asText).filter(Boolean))].sort()
}

function candidateSourceCount(work) {
  const value = work?.candidateSources ?? work?.sourceCandidates ?? work?.sources

  if (Array.isArray(value)) return value.length
  if (typeof value === 'string') return splitListLike(value).length
  if (value && typeof value === 'object') return Object.keys(value).length

  return asText(work?.chosenBaseSource) ? 1 : 0
}

async function maybeFetchPayloadSummary(baseUrl, noPayload) {
  const email = process.env.PAYLOAD_SEED_EMAIL
  const password = process.env.PAYLOAD_SEED_PASSWORD

  if (noPayload) {
    return {
      skipped: true,
      reason: '--no-payload was provided',
    }
  }

  if (!email || !password) {
    return {
      skipped: true,
      reason: 'PAYLOAD_SEED_EMAIL or PAYLOAD_SEED_PASSWORD is missing',
    }
  }

  console.error(`[audit] logging in to ${baseUrl} ...`)
  const token = await login(baseUrl, email, password)

  console.error('[audit] fetching works from Payload ...')
  const { totalDocs, docs: allWorks } = await fetchAllWorks(baseUrl, token)
  const publicCatalog = allWorks.filter((work) => asText(work.importBatch).startsWith('public-catalog-import'))

  const byChosenBaseSource = {}
  const byImportBatch = {}
  const byMediaGroup = {}
  const byMediaType = {}
  const byRatingNotice = {}
  const byReviewStatus = {}
  const byRadarStatus = {}
  const byIdentityStatus = {}
  const byDataStatus = {}
  const byCandidateSourceCount = {}

  for (const work of allWorks) {
    inc(byImportBatch, work.importBatch || 'missing')
    inc(byMediaGroup, work.mediaGroup || 'missing')
    inc(byMediaType, work.mediaType || 'missing')
    inc(byReviewStatus, work.reviewStatus || 'missing')
    inc(byRadarStatus, work.radarStatus || 'missing')
    inc(byIdentityStatus, work.identityStatus || 'missing')
    inc(byDataStatus, work.dataStatus || 'missing')
    inc(byCandidateSourceCount, String(candidateSourceCount(work)))
  }

  for (const work of publicCatalog) {
    inc(byChosenBaseSource, work.chosenBaseSource || 'missing')
    inc(byRatingNotice, work.ratingNotice || 'missing')
  }

  return {
    skipped: false,
    baseUrl,
    totalDocs,
    totalWorks: allWorks.length,
    publicCatalog: publicCatalog.length,
    byChosenBaseSource: sortCountObject(byChosenBaseSource),
    byImportBatch: sortCountObject(byImportBatch),
    byMediaGroup: sortCountObject(byMediaGroup),
    byMediaType: sortCountObject(byMediaType),
    byRatingNotice: sortCountObject(byRatingNotice),
    byReviewStatus: sortCountObject(byReviewStatus),
    byRadarStatus: sortCountObject(byRadarStatus),
    byIdentityStatus: sortCountObject(byIdentityStatus),
    byDataStatus: sortCountObject(byDataStatus),
    byCandidateSourceCount: sortCountObject(byCandidateSourceCount),
    worksWithMultipleCandidateSources: allWorks.filter((work) => candidateSourceCount(work) > 1).length,
    worksWithSourceConflictNotes: allWorks.filter((work) => asText(work.sourceConflictNotes)).length,
    worksWithReviewReasons: allWorks.filter((work) => reviewReasons(work).length > 0).length,
    samples: {
      multipleCandidateSources: allWorks
        .filter((work) => candidateSourceCount(work) > 1)
        .slice(0, 20)
        .map((work) => ({
          id: work.id,
          title: work.title,
          siteId: work.siteId,
          candidateSourceCount: candidateSourceCount(work),
          chosenBaseSource: work.chosenBaseSource || '',
          importBatch: work.importBatch || '',
          reviewReasons: reviewReasons(work),
          sourceConflictNotes: work.sourceConflictNotes || '',
        })),
    },
  }
}

function buildLocalSummary(files, rootDir, scanDirs) {
  const byStage = {}
  const byExtension = {}
  const bySourceHint = {}
  let totalBytes = 0
  let inferredRecords = 0
  let inferredRecordFiles = 0

  for (const file of files) {
    totalBytes += file.sizeBytes
    inc(byStage, file.stage)
    inc(byExtension, file.extension)

    if (Number.isFinite(file.inferredRecordCount)) {
      inferredRecords += file.inferredRecordCount
      inferredRecordFiles += 1
    }

    if (file.sourceHints.length) {
      for (const source of file.sourceHints) {
        addSourceStat(bySourceHint, source, file)
      }
    } else {
      addSourceStat(bySourceHint, 'unknown', file)
    }
  }

  return {
    root: rootDir,
    scanDirs,
    files: files.length,
    totalBytes,
    inferredRecords,
    inferredRecordFiles,
    byStage: sortCountObject(byStage),
    byExtension: sortCountObject(byExtension),
    bySourceHint: sortSourceStats(bySourceHint),
  }
}

function buildSourceCoverage(localSummary, payloadSummary) {
  const sources = new Set(Object.keys(localSummary.bySourceHint || {}))

  if (payloadSummary && !payloadSummary.skipped) {
    for (const source of Object.keys(payloadSummary.byChosenBaseSource || {})) {
      sources.add(source)
    }
  }

  return [...sources].sort().map((source) => {
    const local = localSummary.bySourceHint[source] || {
      files: 0,
      bytes: 0,
      inferredRecords: 0,
      inferredRecordFiles: 0,
    }
    const payloadChosenBaseSourceWorks = payloadSummary && !payloadSummary.skipped
      ? Number(payloadSummary.byChosenBaseSource?.[source] || 0)
      : null

    let status = 'local_only_or_auxiliary'

    if (payloadChosenBaseSourceWorks === null) {
      status = 'payload_not_checked'
    } else if (local.files > 0 && payloadChosenBaseSourceWorks > 0) {
      status = 'active_base_source'
    } else if (local.files > 0 && payloadChosenBaseSourceWorks === 0) {
      status = ['wikidata', 'wikipedia', 'moegirl', 'ndl', 'radar', 'merge-groups'].includes(source)
        ? 'local_evidence_or_workflow_artifact'
        : 'local_only_or_not_yet_base_source'
    } else if (local.files === 0 && payloadChosenBaseSourceWorks > 0) {
      status = 'payload_only'
    }

    return {
      source,
      localFiles: local.files,
      localBytes: local.bytes,
      localInferredRecords: local.inferredRecords,
      localInferredRecordFiles: local.inferredRecordFiles,
      payloadChosenBaseSourceWorks,
      status,
    }
  })
}

function buildRecommendations(sourceCoverage, payloadSummary) {
  const recommendations = []

  const needsImportPlan = sourceCoverage
    .filter((row) => row.localFiles > 0 && row.payloadChosenBaseSourceWorks === 0)
    .filter((row) => !['local_evidence_or_workflow_artifact'].includes(row.status))
    .map((row) => row.source)

  if (needsImportPlan.length) {
    recommendations.push({
      priority: 'high',
      topic: 'local sources not used as chosenBaseSource',
      sources: needsImportPlan,
      action: 'Normalize these sources into SourceRecord candidates and decide whether they create Works, enrich Works, or remain evidence-only.',
    })
  }

  const activeSources = sourceCoverage
    .filter((row) => row.status === 'active_base_source')
    .map((row) => row.source)

  if (activeSources.length) {
    recommendations.push({
      priority: 'medium',
      topic: 'active base sources',
      sources: activeSources,
      action: 'Keep these sources in the full catalog ingestion baseline and compare candidateSources / identity links before adding more data.',
    })
  }

  if (!payloadSummary || payloadSummary.skipped) {
    recommendations.push({
      priority: 'medium',
      topic: 'payload comparison skipped',
      action: 'Set PAYLOAD_SEED_EMAIL and PAYLOAD_SEED_PASSWORD, then rerun without --no-payload to compare local source coverage with current Works.',
    })
  }

  recommendations.push({
    priority: 'next',
    topic: 'next implementation step',
    action: 'Use this report to design normalize-source-records-v01 and plan-full-catalog-ingestion-v01 before any write path is introduced.',
  })

  return recommendations
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function formatMarkdown(report) {
  const topFiles = [...report.local.files]
    .filter((file) => Number.isFinite(file.inferredRecordCount))
    .sort((a, b) => b.inferredRecordCount - a.inferredRecordCount)
    .slice(0, 30)

  const lines = [
    '# Source Coverage Audit v0.1',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer apply.',
    '- No delete.',
    '- No `data_local` output should be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- localRoot: ${report.local.summary.root}`,
    `- localFiles: ${report.local.summary.files}`,
    `- localBytes: ${report.local.summary.totalBytes} (${formatBytes(report.local.summary.totalBytes)})`,
    `- localInferredRecords: ${report.local.summary.inferredRecords}`,
    `- payloadChecked: ${report.payload.skipped ? 'false' : 'true'}`,
    ...(report.payload.skipped
      ? [`- payloadSkippedReason: ${report.payload.reason}`]
      : [
          `- payloadTotalWorks: ${report.payload.totalWorks}`,
          `- payloadPublicCatalog: ${report.payload.publicCatalog}`,
          `- payloadWorksWithMultipleCandidateSources: ${report.payload.worksWithMultipleCandidateSources}`,
          `- payloadWorksWithSourceConflictNotes: ${report.payload.worksWithSourceConflictNotes}`,
        ]),
    '',
    '## Source coverage',
    '',
    '| Source | Local files | Local inferred records | Payload chosenBaseSource works | Status |',
    '|---|---:|---:|---:|---|',
    ...report.sourceCoverage.map((row) => [
      mdCell(row.source),
      row.localFiles,
      row.localInferredRecords,
      row.payloadChosenBaseSourceWorks === null ? '' : row.payloadChosenBaseSourceWorks,
      mdCell(row.status),
    ].join(' | ')).map((row) => `| ${row} |`),
    '',
    '## Local files by stage',
    '',
    '| Stage | Files |',
    '|---|---:|',
    ...Object.entries(report.local.summary.byStage).map(([stage, count]) => `| ${mdCell(stage)} | ${count} |`),
    '',
    '## Local files by extension',
    '',
    '| Extension | Files |',
    '|---|---:|',
    ...Object.entries(report.local.summary.byExtension).map(([extension, count]) => `| ${mdCell(extension)} | ${count} |`),
    '',
    '## Payload chosenBaseSource distribution',
    '',
    ...(report.payload.skipped
      ? ['- Payload comparison skipped.']
      : [
          '| Source | Works |',
          '|---|---:|',
          ...Object.entries(report.payload.byChosenBaseSource).map(([source, count]) => `| ${mdCell(source)} | ${count} |`),
        ]),
    '',
    '## Top inferred record files',
    '',
    '| File | Stage | Sources | Inferred records | Note |',
    '|---|---|---|---:|---|',
    ...topFiles.map((file) => `| ${mdCell(file.path)} | ${mdCell(file.stage)} | ${mdCell(file.sourceHints.join(', ') || 'unknown')} | ${file.inferredRecordCount} | ${mdCell(file.inferredRecordNote)} |`),
    '',
    '## Recommendations',
    '',
    ...report.recommendations.flatMap((item) => [
      `### ${item.priority}: ${item.topic}`,
      '',
      ...(item.sources ? [`- sources: ${item.sources.join(', ')}`] : []),
      `- action: ${item.action}`,
      '',
    ]),
  ]

  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help || args.h) {
    usage()
    return
  }

  const rootDir = args.root || DEFAULT_ROOT
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR
  const baseUrl = args.url || DEFAULT_URL
  const scanDirs = asText(args['scan-dirs'])
    ? splitListLike(args['scan-dirs'])
    : DEFAULT_SCAN_DIRS

  console.error(`[audit] scanning local sources under ${rootDir} ...`)
  const files = await scanLocalSources(rootDir, scanDirs)
  const localSummary = buildLocalSummary(files, rootDir, scanDirs)

  const payloadSummary = await maybeFetchPayloadSummary(baseUrl, Boolean(args['no-payload']))
  const sourceCoverage = buildSourceCoverage(localSummary, payloadSummary)
  const recommendations = buildRecommendations(sourceCoverage, payloadSummary)

  const report = {
    ok: true,
    summary: {
      generatedAt: new Date().toISOString(),
      localFiles: localSummary.files,
      localBytes: localSummary.totalBytes,
      localInferredRecords: localSummary.inferredRecords,
      payloadChecked: !payloadSummary.skipped,
      sourceCoverageRows: sourceCoverage.length,
      safety: {
        payloadWrite: false,
        postgresqlWrite: false,
        importerApply: false,
        delete: false,
      },
    },
    local: {
      summary: localSummary,
      files,
    },
    payload: payloadSummary,
    sourceCoverage,
    recommendations,
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'source-coverage-v01.json')
  const outSummary = path.join(outDir, 'source-coverage-v01-summary.json')
  const outMd = path.join(outDir, 'source-coverage-v01.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(report.summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  console.log(JSON.stringify({
    ok: report.ok,
    summary: report.summary,
    payload: payloadSummary.skipped
      ? { skipped: true, reason: payloadSummary.reason }
      : {
          skipped: false,
          totalWorks: payloadSummary.totalWorks,
          publicCatalog: payloadSummary.publicCatalog,
          byChosenBaseSource: payloadSummary.byChosenBaseSource,
        },
    outputs: {
      json: outJson,
      summary: outSummary,
      md: outMd,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
