#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_ROOT = 'data_local'
const DEFAULT_OUT_DIR = 'data_local/staging/source-records'
const DEFAULT_SOURCES = ['bangumi', 'vndb', 'anilist']
const DEFAULT_SCAN_DIRS = [
  'raw',
  'normalized',
  'candidates',
  'deduped',
  'import_ready',
  'payload',
  'staging',
]
const MAX_JSON_PARSE_BYTES = 50 * 1024 * 1024

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  'media',
  'backups',
  'tmp',
  'archive',
])

const SUPPORTED_EXTENSIONS = new Set(['.jsonl', '.ndjson', '.csv', '.json'])

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
  node scripts/import/normalize-source-records-v01.mjs [--root data_local] [--out-dir <dir>] [--sources bangumi,vndb,anilist] [--include-raw-detail] [--max-records <n>]

This is a read-only SourceRecord normalization preview:
  - Reads local data files only.
  - Normalizes likely Bangumi / VNDB / AniList records into a common SourceRecord JSONL shape.
  - Defaults to index, candidate, normalized, deduped, payload, import_ready, and staging files.
  - Skips raw detail files unless --include-raw-detail is provided.
  - Writes JSONL / summary JSON / Markdown reports to data_local/staging/source-records by default.

Safety:
  - No Payload write.
  - No PostgreSQL write.
  - No importer apply.
  - No delete.
  - No data_local output should be committed.
`)
}

function asText(value) {
  return String(value ?? '').trim()
}

function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/gu, ' ')
}

function splitListLike(value) {
  if (Array.isArray(value)) return value.flatMap(splitListLike)

  return String(value ?? '')
    .split(/[;|,\n]/u)
    .map(normalizeWhitespace)
    .filter(Boolean)
}

function unique(values) {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))]
}

function normalizePathForReport(value) {
  return value.split(path.sep).join('/')
}

function inc(map, key, amount = 1) {
  const normalized = asText(key) || 'missing'
  map[normalized] = (map[normalized] || 0) + amount
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  }))
}

function detectSourceHints(relativePath) {
  const lower = relativePath.toLowerCase()
  const hints = new Set()

  if (lower.includes('bangumi') || /(^|[/_.-])bgm([/_.-]|$)/u.test(lower)) hints.add('bangumi')
  if (lower.includes('anilist')) hints.add('anilist')
  if (lower.includes('vndb')) hints.add('vndb')
  if (lower.includes('steam')) hints.add('steam')
  if (lower.includes('mangadex')) hints.add('mangadex')
  if (lower.includes('wikidata')) hints.add('wikidata')
  if (lower.includes('ndl')) hints.add('ndl')
  if (lower.includes('moegirl')) hints.add('moegirl')
  if (lower.includes('yurizukan') || lower.includes('yuri-zukan')) hints.add('yurizukan')

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

  return files.sort((a, b) => a.localeCompare(b))
}

function shouldParseFile({ relativePath, extension, sourceHints, sources, includeRawDetail }) {
  if (!SUPPORTED_EXTENSIONS.has(extension)) return false
  if (!sourceHints.some((source) => sources.includes(source))) return false

  const normalized = relativePath.toLowerCase()
  const stage = relativePath.split('/')[0] || ''

  if (stage !== 'raw') return true
  if (includeRawDetail) return true

  return [
    '/index/',
    'index.',
    'candidate',
    'candidates',
    'review',
    'tagged',
    'payload',
    'import',
    'dedup',
    'manifest',
  ].some((token) => normalized.includes(token))
}

function resolveSourceName(sourceHints, requestedSources, record) {
  const recordSource = normalizeWhitespace(
    record?.sourceName || record?.source || record?.source_name || record?.site || record?.provider
  ).toLowerCase()

  if (requestedSources.includes(recordSource)) return recordSource

  for (const source of requestedSources) {
    if (sourceHints.includes(source)) return source
  }

  return sourceHints[0] || 'unknown'
}

function getPathValue(object, keyPath) {
  if (!object || typeof object !== 'object') return undefined
  const parts = keyPath.split('.')
  let current = object

  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    if (!(part in current)) return undefined
    current = current[part]
  }

  return current
}

function pickValue(record, keys) {
  for (const key of keys) {
    const value = key.includes('.') ? getPathValue(record, key) : record?.[key]
    if (Array.isArray(value) && value.length > 0) return value
    if (value && typeof value === 'object' && Object.keys(value).length > 0) return value
    if (normalizeWhitespace(value)) return value
  }

  return undefined
}

function objectTitle(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''

  return normalizeWhitespace(
    value.userPreferred || value.romaji || value.english || value.native || value.original || value.name || value.title
  )
}

function pickTitle(record, sourceName) {
  const titleObject = pickValue(record, ['title'])
  if (titleObject && typeof titleObject === 'object' && !Array.isArray(titleObject)) {
    const title = objectTitle(titleObject)
    if (title) return title
  }

  const sourceSpecificKeys = {
    bangumi: ['name_cn', 'name', 'title', 'title_cn', 'title_jp', 'originalTitle'],
    anilist: [
      'title.userPreferred',
      'title.romaji',
      'title.english',
      'title.native',
      'title_romaji',
      'title_english',
      'title_native',
      'romaji',
      'english',
      'native',
      'name',
    ],
    vndb: ['title', 'original', 'alttitle', 'name', 'label'],
  }

  return normalizeWhitespace(pickValue(record, [
    ...(sourceSpecificKeys[sourceName] || []),
    'sourceTitle',
    'source_title',
    'displayTitle',
    'display_title',
    'label',
  ]))
}

function pickAliases(record, sourceName, title) {
  const values = []

  const titleObject = pickValue(record, ['title'])
  if (titleObject && typeof titleObject === 'object' && !Array.isArray(titleObject)) {
    values.push(titleObject.userPreferred, titleObject.romaji, titleObject.english, titleObject.native)
  }

  const aliasValue = pickValue(record, [
    'aliases',
    'alias',
    'synonyms',
    'names',
    'alternativeTitles',
    'alternative_titles',
    'altTitles',
    'alt_titles',
    'altname',
  ])

  values.push(...splitListLike(aliasValue))

  if (sourceName === 'bangumi') {
    values.push(record.name, record.name_cn, record.title, record.title_cn)
  }

  if (sourceName === 'anilist') {
    values.push(record.title_romaji, record.title_english, record.title_native, record.romaji, record.english, record.native)
  }

  if (sourceName === 'vndb') {
    values.push(record.original, record.alttitle, record.alt_title)
  }

  return unique(values).filter((value) => value !== title)
}

function pickSourceId(record, sourceName) {
  const sourceSpecificKeys = {
    bangumi: ['bangumiId', 'bgmId', 'subject_id', 'subjectId', 'subjectID', 'id'],
    anilist: ['anilistId', 'mediaId', 'media_id', 'id'],
    vndb: ['vndbId', 'vnid', 'vndb_id', 'id', 'vid'],
  }

  const value = pickValue(record, [
    ...(sourceSpecificKeys[sourceName] || []),
    'sourceId',
    'source_id',
    'externalId',
    'external_id',
  ])

  const text = normalizeWhitespace(value)
  if (!text) return ''

  if (sourceName === 'vndb' && /^\d+$/u.test(text)) return `v${text}`
  return text
}

function pickSourceUrl(record, sourceName, sourceId) {
  const existing = normalizeWhitespace(pickValue(record, [
    'sourceUrl',
    'source_url',
    'url',
    'siteUrl',
    'site_url',
    'link',
    'href',
  ]))

  if (existing) return existing

  if (!sourceId) return ''

  if (sourceName === 'bangumi') return `https://bgm.tv/subject/${sourceId}`
  if (sourceName === 'anilist') {
    return `https://anilist.co/${inferMediaType(record, sourceName) === 'anime' ? 'anime' : 'manga'}/${sourceId}`
  }
  if (sourceName === 'vndb') return `https://vndb.org/${sourceId}`

  return ''
}

function inferBangumiMediaType(record) {
  const type = normalizeWhitespace(pickValue(record, ['type', 'subjectType', 'subject_type', 'type_id']))
  const platform = normalizeWhitespace(pickValue(record, ['platform', 'mediaType', 'media_type']))
  const category = `${type} ${platform}`.toLowerCase()

  if (type === '1' || category.includes('book') || category.includes('书籍') || category.includes('漫画') || category.includes('novel')) {
    if (category.includes('novel') || category.includes('小说')) return 'novel_or_book'
    return 'book_or_manga'
  }
  if (type === '2' || category.includes('anime') || category.includes('动画')) return 'anime'
  if (type === '3' || category.includes('music') || category.includes('音乐')) return 'music_or_audio'
  if (type === '4' || category.includes('game') || category.includes('游戏')) return 'game'
  if (type === '6' || category.includes('real')) return 'real_person_or_live_action'

  return ''
}

function inferAniListMediaType(record) {
  const type = normalizeWhitespace(pickValue(record, ['type', 'mediaType', 'media_type'])).toUpperCase()
  const format = normalizeWhitespace(pickValue(record, ['format'])).toUpperCase()

  if (type === 'ANIME') return 'anime'
  if (type === 'MANGA') {
    if (format.includes('NOVEL')) return 'novel_or_book'
    return 'manga'
  }

  if (['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'].includes(format)) return 'anime'
  if (['MANGA', 'ONE_SHOT'].includes(format)) return 'manga'
  if (['NOVEL'].includes(format)) return 'novel_or_book'

  return ''
}

function inferMediaType(record, sourceName) {
  const explicit = normalizeWhitespace(pickValue(record, [
    'sourceMediaType',
    'source_media_type',
    'mediaType',
    'media_type',
    'medium',
    'category',
  ])).toLowerCase()

  if (explicit) {
    if (explicit.includes('anime') || explicit.includes('动画')) return 'anime'
    if (explicit.includes('manga') || explicit.includes('comic') || explicit.includes('漫画')) return 'manga'
    if (explicit.includes('novel') || explicit.includes('book') || explicit.includes('小说') || explicit.includes('书籍')) return 'novel_or_book'
    if (explicit.includes('visual') && explicit.includes('novel')) return 'visual_novel'
    if (explicit.includes('game') || explicit.includes('游戏')) return 'game'
  }

  if (sourceName === 'bangumi') return inferBangumiMediaType(record)
  if (sourceName === 'anilist') return inferAniListMediaType(record)
  if (sourceName === 'vndb') return 'visual_novel'

  return ''
}

function pickCreators(record) {
  const values = []

  for (const key of [
    'creators',
    'creator',
    'authors',
    'author',
    'artists',
    'artist',
    'staff',
    'studios',
    'studio',
    'developers',
    'developer',
    'publishers',
    'publisher',
    'brand',
  ]) {
    const value = record?.[key]

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') values.push(item)
        else if (item && typeof item === 'object') values.push(item.name, item.title, item.label)
      }
    } else if (value && typeof value === 'object') {
      values.push(value.name, value.title, value.label)
    } else {
      values.push(...splitListLike(value))
    }
  }

  return unique(values)
}

function pickReleaseDate(record) {
  const dateObject = pickValue(record, ['startDate', 'start_date'])
  if (dateObject && typeof dateObject === 'object' && !Array.isArray(dateObject)) {
    const year = normalizeWhitespace(dateObject.year)
    const month = normalizeWhitespace(dateObject.month).padStart(2, '0')
    const day = normalizeWhitespace(dateObject.day).padStart(2, '0')

    if (year && month !== '00' && day !== '00') return `${year}-${month}-${day}`
    if (year && month !== '00') return `${year}-${month}`
    if (year) return year
  }

  return normalizeWhitespace(pickValue(record, [
    'releaseDate',
    'release_date',
    'released',
    'date',
    'startDate',
    'start_date',
    'airDate',
    'air_date',
    'publishedAt',
    'published_at',
    'year',
  ]))
}

function classifyEligibility(record, sourceName, mediaType, title) {
  if (!title) {
    return {
      eligibleForCatalog: false,
      eligibilityStatus: 'quarantine',
      excludeReason: 'missing_title',
    }
  }

  if (sourceName === 'bangumi' && mediaType === 'real_person_or_live_action') {
    return {
      eligibleForCatalog: false,
      eligibilityStatus: 'not_catalog',
      excludeReason: 'bangumi_real_person_or_live_action',
    }
  }

  if (sourceName === 'bangumi' && mediaType === 'music_or_audio') {
    return {
      eligibleForCatalog: true,
      eligibilityStatus: 'maybe_catalog',
      excludeReason: '',
    }
  }

  if (['anime', 'manga', 'book_or_manga', 'novel_or_book', 'game', 'visual_novel'].includes(mediaType)) {
    return {
      eligibleForCatalog: true,
      eligibilityStatus: 'eligible_for_catalog',
      excludeReason: '',
    }
  }

  if (['bangumi', 'anilist', 'vndb'].includes(sourceName)) {
    return {
      eligibleForCatalog: true,
      eligibilityStatus: 'maybe_catalog',
      excludeReason: '',
    }
  }

  return {
    eligibleForCatalog: false,
    eligibilityStatus: 'evidence_only',
    excludeReason: 'source_not_catalog_primary_target',
  }
}

function normalizeRecord({ record, sourceHints, requestedSources, rawPath, rawRecordIndex, normalizedAt }) {
  const sourceName = resolveSourceName(sourceHints, requestedSources, record)
  const sourceId = pickSourceId(record, sourceName)
  const title = pickTitle(record, sourceName)
  const mediaType = inferMediaType(record, sourceName)
  const aliases = pickAliases(record, sourceName, title)
  const sourceUrl = pickSourceUrl(record, sourceName, sourceId)
  const creators = pickCreators(record)
  const releaseDate = pickReleaseDate(record)
  const eligibility = classifyEligibility(record, sourceName, mediaType, title)

  const sourceRecordKey = sourceId
    ? `${sourceName}:${sourceId}`
    : `${sourceName}:${rawPath}:${rawRecordIndex}`

  return {
    sourceRecordKey,
    sourceName,
    sourceId,
    sourceUrl,
    sourceTitle: title,
    sourceMediaType: mediaType || 'unknown',
    aliases,
    creators,
    releaseDate,
    rawPath,
    rawRecordIndex,
    normalizedAt,
    eligibleForCatalog: eligibility.eligibleForCatalog,
    eligibilityStatus: eligibility.eligibilityStatus,
    excludeReason: eligibility.excludeReason,
    sourceHints,
  }
}

function parseCsvLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
      continue
    }

    current += char
  }

  result.push(current)
  return result
}

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.length > 0)
  if (!lines.length) return []

  const headers = parseCsvLine(lines[0]).map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    const row = {}

    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })

    return row
  })
}

function extractRowsFromJson(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []

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
    'media',
    'entries',
  ]

  for (const key of candidateKeys) {
    if (Array.isArray(value[key])) return value[key]
  }

  if (value.id || value.name || value.title || value.sourceId || value.subject_id) return [value]

  return []
}

async function readJsonlRows(filePath, handleRow) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let index = 0
  let failed = 0

  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue

    try {
      const row = JSON.parse(text)
      await handleRow(row, index)
    } catch {
      failed += 1
    }

    index += 1
  }

  return { rows: index, failed }
}

async function normalizeFile({ filePath, relativePath, extension, sourceHints, requestedSources, normalizedAt, writeRecord, seenKeys, maxRecords }) {
  const stat = fs.statSync(filePath)
  const diagnostics = {
    path: relativePath,
    extension,
    sourceHints,
    parsedRows: 0,
    emittedRecords: 0,
    duplicateRecords: 0,
    failedRows: 0,
    skippedReason: '',
  }

  const emit = async (rawRecord, rawRecordIndex) => {
    if (maxRecords > 0 && seenKeys.emitted >= maxRecords) return

    if (!rawRecord || typeof rawRecord !== 'object') {
      diagnostics.failedRows += 1
      return
    }

    const record = normalizeRecord({
      record: rawRecord,
      sourceHints,
      requestedSources,
      rawPath: relativePath,
      rawRecordIndex,
      normalizedAt,
    })

    diagnostics.parsedRows += 1

    if (!requestedSources.includes(record.sourceName)) return

    if (seenKeys.keys.has(record.sourceRecordKey)) {
      diagnostics.duplicateRecords += 1
      return
    }

    seenKeys.keys.add(record.sourceRecordKey)
    seenKeys.emitted += 1
    diagnostics.emittedRecords += 1
    await writeRecord(record)
  }

  if ((extension === '.jsonl' || extension === '.ndjson')) {
    const result = await readJsonlRows(filePath, emit)
    diagnostics.failedRows += result.failed
    return diagnostics
  }

  if (extension === '.csv') {
    const rows = csvRows(fs.readFileSync(filePath, 'utf8'))
    for (let index = 0; index < rows.length; index += 1) {
      await emit(rows[index], index)
    }
    return diagnostics
  }

  if (extension === '.json') {
    if (stat.size > MAX_JSON_PARSE_BYTES) {
      diagnostics.skippedReason = `json_skipped_large>${MAX_JSON_PARSE_BYTES}`
      return diagnostics
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const rows = extractRowsFromJson(parsed)
      for (let index = 0; index < rows.length; index += 1) {
        await emit(rows[index], index)
      }
    } catch (error) {
      diagnostics.skippedReason = `json_parse_failed:${error.message}`
    }

    return diagnostics
  }

  diagnostics.skippedReason = 'unsupported_extension'
  return diagnostics
}

function buildSummary(records, fileDiagnostics, options) {
  const bySource = {}
  const byEligibilityStatus = {}
  const bySourceAndEligibility = {}
  const byMediaType = {}
  const bySourceAndMediaType = {}
  const byRawStage = {}
  const byExcludeReason = {}

  for (const record of records) {
    inc(bySource, record.sourceName)
    inc(byEligibilityStatus, record.eligibilityStatus)
    inc(bySourceAndEligibility, `${record.sourceName}:${record.eligibilityStatus}`)
    inc(byMediaType, record.sourceMediaType)
    inc(bySourceAndMediaType, `${record.sourceName}:${record.sourceMediaType}`)
    inc(byRawStage, record.rawPath.split('/')[0] || 'missing')
    if (record.excludeReason) inc(byExcludeReason, record.excludeReason)
  }

  return {
    generatedAt: new Date().toISOString(),
    options,
    filesConsidered: fileDiagnostics.length,
    filesParsed: fileDiagnostics.filter((file) => file.parsedRows > 0 || file.emittedRecords > 0).length,
    filesSkipped: fileDiagnostics.filter((file) => file.skippedReason).length,
    parsedRows: fileDiagnostics.reduce((sum, file) => sum + file.parsedRows, 0),
    emittedRecords: records.length,
    duplicateRecords: fileDiagnostics.reduce((sum, file) => sum + file.duplicateRecords, 0),
    failedRows: fileDiagnostics.reduce((sum, file) => sum + file.failedRows, 0),
    bySource: sortCountObject(bySource),
    byEligibilityStatus: sortCountObject(byEligibilityStatus),
    bySourceAndEligibility: sortCountObject(bySourceAndEligibility),
    byMediaType: sortCountObject(byMediaType),
    bySourceAndMediaType: sortCountObject(bySourceAndMediaType),
    byRawStage: sortCountObject(byRawStage),
    byExcludeReason: sortCountObject(byExcludeReason),
    safety: {
      payloadWrite: false,
      postgresqlWrite: false,
      importerApply: false,
      delete: false,
    },
  }
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function formatCountTable(title, entries) {
  return [
    `## ${title}`,
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(entries).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function formatMarkdown(report) {
  const topFiles = [...report.fileDiagnostics]
    .filter((file) => file.emittedRecords > 0)
    .sort((a, b) => b.emittedRecords - a.emittedRecords)
    .slice(0, 30)

  const sampleRecords = report.samples.records.slice(0, 20)

  const lines = [
    '# SourceRecord Normalization Preview v0.1',
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
    `- sources: ${report.summary.options.sources.join(', ')}`,
    `- includeRawDetail: ${report.summary.options.includeRawDetail}`,
    `- filesConsidered: ${report.summary.filesConsidered}`,
    `- filesParsed: ${report.summary.filesParsed}`,
    `- filesSkipped: ${report.summary.filesSkipped}`,
    `- parsedRows: ${report.summary.parsedRows}`,
    `- emittedRecords: ${report.summary.emittedRecords}`,
    `- duplicateRecords: ${report.summary.duplicateRecords}`,
    `- failedRows: ${report.summary.failedRows}`,
    '',
    ...formatCountTable('By source', report.summary.bySource),
    ...formatCountTable('By eligibility status', report.summary.byEligibilityStatus),
    ...formatCountTable('By media type', report.summary.byMediaType),
    ...formatCountTable('By source and eligibility', report.summary.bySourceAndEligibility),
    '## Top source files',
    '',
    '| File | Sources | Parsed rows | Emitted records | Duplicates | Skipped reason |',
    '|---|---|---:|---:|---:|---|',
    ...topFiles.map((file) => `| ${mdCell(file.path)} | ${mdCell(file.sourceHints.join(', '))} | ${file.parsedRows} | ${file.emittedRecords} | ${file.duplicateRecords} | ${mdCell(file.skippedReason)} |`),
    '',
    '## Sample records',
    '',
    '```json',
    JSON.stringify(sampleRecords, null, 2),
    '```',
    '',
    '## Next step',
    '',
    '- Review `eligibilityStatus` distribution before any Payload write path exists.',
    '- Use this JSONL as input for a future `plan-full-catalog-ingestion-v01` dry-run.',
    '- Do not commit generated files under `data_local`.',
    '',
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
  const sources = asText(args.sources)
    ? splitListLike(args.sources).map((source) => source.toLowerCase())
    : DEFAULT_SOURCES
  const scanDirs = asText(args['scan-dirs'])
    ? splitListLike(args['scan-dirs'])
    : DEFAULT_SCAN_DIRS
  const includeRawDetail = Boolean(args['include-raw-detail'])
  const maxRecords = Number(args['max-records'] || 0)
  const normalizedAt = new Date().toISOString()

  const resolvedRoot = path.resolve(rootDir)
  const allFiles = walkFiles(resolvedRoot, scanDirs)
  const candidateFiles = []

  for (const filePath of allFiles) {
    const relativePath = normalizePathForReport(path.relative(resolvedRoot, filePath))
    const extension = path.extname(filePath).toLowerCase() || '[none]'
    const sourceHints = detectSourceHints(relativePath)

    if (!shouldParseFile({ relativePath, extension, sourceHints, sources, includeRawDetail })) continue

    candidateFiles.push({ filePath, relativePath, extension, sourceHints })
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, 'source-records-v01.jsonl')
  const outJson = path.join(outDir, 'source-records-v01.json')
  const outSummary = path.join(outDir, 'source-records-v01-summary.json')
  const outMd = path.join(outDir, 'source-records-v01.md')
  const outStream = fs.createWriteStream(outJsonl, { encoding: 'utf8' })

  const records = []
  const fileDiagnostics = []
  const seenKeys = { keys: new Set(), emitted: 0 }

  console.error(`[normalize] root: ${rootDir}`)
  console.error(`[normalize] sources: ${sources.join(', ')}`)
  console.error(`[normalize] candidate files: ${candidateFiles.length}`)

  const writeRecord = async (record) => {
    records.push(record)
    outStream.write(`${JSON.stringify(record)}\n`)
  }

  for (const file of candidateFiles) {
    if (maxRecords > 0 && seenKeys.emitted >= maxRecords) break

    const diagnostics = await normalizeFile({
      filePath: file.filePath,
      relativePath: file.relativePath,
      extension: file.extension,
      sourceHints: file.sourceHints,
      requestedSources: sources,
      normalizedAt,
      writeRecord,
      seenKeys,
      maxRecords,
    })

    fileDiagnostics.push(diagnostics)
  }

  await new Promise((resolve) => outStream.end(resolve))

  const options = {
    root: rootDir,
    outDir,
    sources,
    scanDirs,
    includeRawDetail,
    maxRecords,
  }

  const summary = buildSummary(records, fileDiagnostics, options)
  const report = {
    ok: true,
    summary,
    fileDiagnostics,
    samples: {
      records: records.slice(0, 50),
    },
    outputs: {
      jsonl: normalizePathForReport(outJsonl),
      json: normalizePathForReport(outJson),
      summary: normalizePathForReport(outSummary),
      md: normalizePathForReport(outMd),
    },
  }

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  console.log(JSON.stringify({
    ok: report.ok,
    summary: report.summary,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
