#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_INPUT = path.join('data_local', 'payload', 'bangumi-media-work-package-preview.json')
const DEFAULT_AUDIT_INPUT = path.join('data_local', 'reports', 'bangumi-media-work-package-preview-audit.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-work-import-dry-run.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-work-import-dry-run.md')
const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PAYLOAD_URL = 'http://127.0.0.1:3000'
const REPORT_UTF8_BOM = '\uFEFF'

const EXPECTED_PACKAGE_SOURCE = 'bangumi-media-work-package-preview'
const EXPECTED_PACKAGE_MODE = 'package-preview-only-no-payload-write'
const EXPECTED_AUDIT_SOURCE = 'bangumi-media-work-package-preview-audit'
const EXPECTED_AUDIT_MODE = 'audit-only-no-payload-write'
const DRY_RUN_SOURCE = 'bangumi-media-work-import-dry-run'
const DRY_RUN_MODE = 'dry-run-payload-read-no-write'

function parseArgs(argv) {
  const args = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true'
    args.set(key, value)

    if (value !== 'true') index += 1
  }

  return args
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function normalizedKey(value) {
  return cleanText(value).toLowerCase()
}

function asRows(value) {
  return Array.isArray(value) ? value : []
}

function packageAllowsDryRun(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, reason: 'package-not-object' }
  if (cleanText(pkg?.meta?.source) !== EXPECTED_PACKAGE_SOURCE) return { ok: false, reason: 'package-source-invalid' }
  if (cleanText(pkg?.meta?.mode) !== EXPECTED_PACKAGE_MODE) return { ok: false, reason: 'package-mode-invalid' }
  return { ok: true, reason: 'package-valid' }
}

function auditAllowsDryRun(audit, { requireAuditPass = true } = {}) {
  if (!requireAuditPass) return { ok: true, reason: 'audit-check-disabled' }
  if (!audit) return { ok: false, reason: 'audit-missing' }
  if (cleanText(audit.source) !== EXPECTED_AUDIT_SOURCE) return { ok: false, reason: 'audit-source-invalid' }
  if (cleanText(audit.mode) !== EXPECTED_AUDIT_MODE) return { ok: false, reason: 'audit-mode-invalid' }
  if (cleanText(audit.status) !== 'pass') return { ok: false, reason: 'audit-not-pass' }
  if (asRows(audit.errors).length > 0) return { ok: false, reason: 'audit-has-errors' }
  return { ok: true, reason: 'audit-pass' }
}

function normalizeExistingDoc(doc) {
  return {
    collection: 'works',
    id: cleanText(doc?.id),
    title: cleanText(doc?.title || doc?.name),
    slug: cleanText(doc?.slug),
    status: cleanText(doc?.status),
    updatedAt: cleanText(doc?.updatedAt),
  }
}

function uniqueDocs(docs) {
  const seen = new Set()
  const output = []

  for (const doc of asRows(docs)) {
    const normalized = normalizeExistingDoc(doc)
    const key = normalized.id || `${normalized.title.toLowerCase()}|${normalized.slug.toLowerCase()}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }

  return output
}

function analyzeExistingMatches(work, existing, error = '') {
  if (error) {
    return { status: 'query-error', existing: [], exactExisting: [], titleCollisions: [], slugCollisions: [] }
  }

  if (existing.length === 0) {
    return { status: 'would-create', existing: [], exactExisting: [], titleCollisions: [], slugCollisions: [] }
  }

  const titleKey = normalizedKey(work.title)
  const slugKey = normalizedKey(work.slug)
  const exactExisting = existing.filter((doc) => normalizedKey(doc.title) === titleKey && normalizedKey(doc.slug) === slugKey)
  const titleCollisions = existing.filter((doc) => normalizedKey(doc.title) === titleKey && normalizedKey(doc.slug) !== slugKey)
  const slugCollisions = existing.filter((doc) => normalizedKey(doc.slug) === slugKey && normalizedKey(doc.title) !== titleKey)

  if (exactExisting.length === 1) {
    return { status: 'already-exists', existing: exactExisting, exactExisting, titleCollisions, slugCollisions }
  }

  if (exactExisting.length > 1) {
    return { status: 'ambiguous-existing', existing: exactExisting, exactExisting, titleCollisions, slugCollisions }
  }

  if (slugCollisions.length > 0) {
    return { status: 'ambiguous-existing', existing: slugCollisions, exactExisting, titleCollisions, slugCollisions }
  }

  return { status: 'would-create', existing: [], exactExisting, titleCollisions, slugCollisions }
}

async function defaultLookupWork(work, { url = DEFAULT_PAYLOAD_URL, token = '' } = {}) {
  const baseUrl = String(url || DEFAULT_PAYLOAD_URL).replace(/\/+$/u, '')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const title = cleanText(work.title)
  const slug = cleanText(work.slug)
  const docs = []

  async function queryBy(field, value) {
    if (!value) return []
    const query = new URLSearchParams()
    query.set('limit', '10')
    query.set('depth', '0')
    query.set(`where[${field}][equals]`, value)
    const response = await fetch(`${baseUrl}/api/works?${query.toString()}`, { headers })
    if (!response.ok) throw new Error(`Payload query failed for works.${field}: ${response.status} ${response.statusText}`)
    const body = await response.json()
    return asRows(body?.docs)
  }

  docs.push(...await queryBy('title', title))
  docs.push(...await queryBy('slug', slug))

  return uniqueDocs(docs)
}

function workSummary(work) {
  return {
    collection: 'works',
    kind: cleanText(work.kind),
    title: cleanText(work.title),
    slug: cleanText(work.slug),
    originalSlug: cleanText(work.originalSlug),
    slugCollisionResolved: Boolean(work.slugCollisionResolved),
    bangumiSubjectId: cleanText(work.bangumiSubjectId),
    mediaGroup: cleanText(work.mediaGroup),
    mediaType: cleanText(work.mediaType),
    importAction: cleanText(work.importAction),
    creatorCreditHintsTotal: asRows(work.creatorCreditHints).length,
    organizationCreditHintsTotal: asRows(work.organizationCreditHints).length,
    evidenceTotal: asRows(work.evidence).length,
  }
}

export async function buildBangumiMediaWorkImportDryRun(pkg, audit = null, {
  generatedAt = new Date().toISOString(),
  requireAuditPass = true,
  url = DEFAULT_PAYLOAD_URL,
  token = '',
  lookupWork = defaultLookupWork,
} = {}) {
  const packageCheck = packageAllowsDryRun(pkg)
  const auditCheck = auditAllowsDryRun(audit, { requireAuditPass })
  const works = asRows(pkg?.works)
  const canQuery = packageCheck.ok && auditCheck.ok
  const results = []
  const skippedWorks = []

  for (const work of works) {
    const summary = workSummary(work)

    if (!canQuery) {
      skippedWorks.push({ ...summary, reason: packageCheck.ok ? auditCheck.reason : packageCheck.reason })
      continue
    }

    let existing = []
    let error = ''

    try {
      existing = await lookupWork(work, { url, token })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }

    const analysis = analyzeExistingMatches(work, existing, error)
    const status = analysis.status

    results.push({
      ...summary,
      mode: DRY_RUN_MODE,
      status,
      plannedOperation: status === 'would-create' ? 'create' : 'none',
      existing: analysis.existing,
      exactExisting: analysis.exactExisting,
      titleCollisions: analysis.titleCollisions,
      slugCollisions: analysis.slugCollisions,
      error,
      safety: {
        payloadRead: true,
        payloadWrite: false,
        databaseWrite: false,
        workImport: false,
        entityImport: false,
        worksPatch: false,
        coverUpload: false,
      },
    })
  }

  const allRows = [...results, ...skippedWorks]
  const countsByStatus = Object.fromEntries(['would-create', 'already-exists', 'ambiguous-existing', 'query-error'].map((status) => [status, results.filter((row) => row.status === status).length]))
  const rowsWithTitleCollisions = results.filter((row) => asRows(row.titleCollisions).length > 0)
  const rowsWithSlugCollisions = results.filter((row) => asRows(row.slugCollisions).length > 0)

  return {
    meta: {
      source: DRY_RUN_SOURCE,
      mode: DRY_RUN_MODE,
      generatedAt,
      url: cleanText(url),
      input: {
        source: cleanText(pkg?.meta?.source),
        mode: cleanText(pkg?.meta?.mode),
        generatedAt: cleanText(pkg?.meta?.generatedAt),
        auditSource: cleanText(audit?.source),
        auditMode: cleanText(audit?.mode),
        auditStatus: cleanText(audit?.status),
      },
      checks: {
        requireAuditPass: Boolean(requireAuditPass),
        packageCheck: packageCheck.reason,
        auditCheck: auditCheck.reason,
      },
      safety: {
        payloadRead: canQuery,
        payloadWrite: false,
        databaseWrite: false,
        workImport: false,
        entityImport: false,
        worksPatch: false,
        coverUpload: false,
      },
      stats: {
        packageWorksTotal: works.length,
        resultsTotal: results.length,
        skippedWorksTotal: skippedWorks.length,
        wouldCreateTotal: countsByStatus['would-create'],
        alreadyExistsTotal: countsByStatus['already-exists'],
        ambiguousExistingTotal: countsByStatus['ambiguous-existing'],
        queryErrorsTotal: countsByStatus['query-error'],
        titleCollisionRowsTotal: rowsWithTitleCollisions.length,
        titleCollisionDocsTotal: rowsWithTitleCollisions.reduce((sum, row) => sum + asRows(row.titleCollisions).length, 0),
        slugCollisionRowsTotal: rowsWithSlugCollisions.length,
        slugCollisionDocsTotal: rowsWithSlugCollisions.reduce((sum, row) => sum + asRows(row.slugCollisions).length, 0),
        mediaGroupCounts: Object.fromEntries([...new Set(allRows.map((row) => row.mediaGroup).filter(Boolean))].sort().map((group) => [group, allRows.filter((row) => row.mediaGroup === group).length])),
        mediaTypeCounts: Object.fromEntries([...new Set(allRows.map((row) => row.mediaType).filter(Boolean))].sort().map((type) => [type, allRows.filter((row) => row.mediaType === type).length])),
      },
    },
    results,
    skippedWorks,
  }
}

function reportRow(row) {
  const existing = asRows(row.existing).map((item) => item.title || item.slug || item.id).filter(Boolean).join('；')
  const titleCollisionNote = asRows(row.titleCollisions).length > 0 ? `titleCollisions=${asRows(row.titleCollisions).length}` : ''
  const slugCollisionNote = asRows(row.slugCollisions).length > 0 ? `slugCollisions=${asRows(row.slugCollisions).length}` : ''
  const note = [row.reason, row.error, titleCollisionNote, slugCollisionNote].filter(Boolean).join('；')
  return `| ${row.title} | ${row.slug} | ${row.bangumiSubjectId} | ${row.mediaGroup}/${row.mediaType} | ${row.status || 'skipped'} | ${row.plannedOperation || 'none'} | ${existing} | ${note} |`
}

export function createBangumiMediaWorkImportDryRunReport(dryRun, { inputPath = '', auditPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = dryRun?.meta || {}
  const stats = meta.stats || {}
  const results = asRows(dryRun?.results).slice(0, topLimit)
  const skipped = asRows(dryRun?.skippedWorks).slice(0, topLimit)
  const lines = [
    '# Bangumi media work import dry-run',
    '',
    '## Summary',
    '',
    `- source: ${meta.source || ''}`,
    `- mode: ${meta.mode || ''}`,
    `- generatedAt: ${meta.generatedAt || ''}`,
    `- url: ${meta.url || ''}`,
    inputPath ? `- input: ${inputPath}` : '',
    auditPath ? `- audit: ${auditPath}` : '',
    `- packageCheck: ${meta.checks?.packageCheck || ''}`,
    `- auditCheck: ${meta.checks?.auditCheck || ''}`,
    `- packageWorksTotal: ${stats.packageWorksTotal}`,
    `- resultsTotal: ${stats.resultsTotal}`,
    `- skippedWorksTotal: ${stats.skippedWorksTotal}`,
    `- wouldCreateTotal: ${stats.wouldCreateTotal}`,
    `- alreadyExistsTotal: ${stats.alreadyExistsTotal}`,
    `- ambiguousExistingTotal: ${stats.ambiguousExistingTotal}`,
    `- queryErrorsTotal: ${stats.queryErrorsTotal}`,
    `- titleCollisionRowsTotal: ${stats.titleCollisionRowsTotal}`,
    `- slugCollisionRowsTotal: ${stats.slugCollisionRowsTotal || 0}`,
    '',
    '## Safety',
    '',
    '- Dry-run only.',
    '- Payload read/query only.',
    '- No Payload create/update/delete.',
    '- No database writes.',
    '- No work import.',
    '- No entity import.',
    '- No works patch.',
    '- No cover upload.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Results',
    '',
    '| Title | Slug | Bangumi | Media | Status | Planned operation | Existing | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(reportRow),
    '',
    '## Skipped works',
    '',
  ].filter((line) => line !== '')

  if (skipped.length === 0) lines.push('- none')
  else {
    lines.push('| Title | Slug | Bangumi | Media | Status | Planned operation | Existing | Note |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const row of skipped) lines.push(reportRow(row))
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in') || DEFAULT_PACKAGE_INPUT
  const auditInput = args.get('audit') || DEFAULT_AUDIT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)
  const url = args.get('url') || DEFAULT_PAYLOAD_URL
  const token = args.get('token') || process.env.PAYLOAD_TOKEN || ''
  const requireAuditPass = args.get('require-audit-pass') !== 'false'

  const pkg = await readJson(input)
  const audit = requireAuditPass ? await readJson(auditInput) : null
  const dryRun = await buildBangumiMediaWorkImportDryRun(pkg, audit, { requireAuditPass, url, token })

  await writeJson(output, dryRun)
  await writeText(report, createBangumiMediaWorkImportDryRunReport(dryRun, { inputPath: input, auditPath: auditInput, topLimit }))

  console.log(`Wrote Bangumi media work import dry-run -> ${output}`)
  console.log(`Wrote Bangumi media work import dry-run report -> ${report}`)
  console.log(`Dry-run: would-create=${dryRun.meta.stats.wouldCreateTotal}; already-exists=${dryRun.meta.stats.alreadyExistsTotal}; ambiguous=${dryRun.meta.stats.ambiguousExistingTotal}; query-errors=${dryRun.meta.stats.queryErrorsTotal}; skipped=${dryRun.meta.stats.skippedWorksTotal}; title-collisions=${dryRun.meta.stats.titleCollisionRowsTotal}`)

  if (dryRun.meta.stats.queryErrorsTotal > 0 || dryRun.meta.stats.skippedWorksTotal > 0 || dryRun.meta.stats.ambiguousExistingTotal > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
