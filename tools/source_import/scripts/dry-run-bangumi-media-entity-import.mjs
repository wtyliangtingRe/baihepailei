#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-package-preview.json')
const DEFAULT_AUDIT_INPUT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-package-preview-audit.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-entity-import-dry-run.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-import-dry-run.md')
const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PAYLOAD_URL = 'http://127.0.0.1:3000'
const REPORT_UTF8_BOM = '\uFEFF'

const EXPECTED_PACKAGE_SOURCE = 'bangumi-media-entity-seed-package-preview'
const EXPECTED_PACKAGE_MODE = 'package-preview-only-no-payload-write'
const EXPECTED_AUDIT_SOURCE = 'bangumi-media-entity-seed-package-preview-audit'
const EXPECTED_AUDIT_MODE = 'audit-only-no-payload-write'
const DRY_RUN_SOURCE = 'bangumi-media-entity-import-dry-run'
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

function asRows(value) {
  return Array.isArray(value) ? value : []
}

function safeCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function collectionEntities(pkg) {
  return [...asRows(pkg?.creators), ...asRows(pkg?.organizations)]
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

function packageAllowsDryRun(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, reason: 'package-not-object' }
  if (cleanText(pkg?.meta?.source) !== EXPECTED_PACKAGE_SOURCE) return { ok: false, reason: 'package-source-invalid' }
  if (cleanText(pkg?.meta?.mode) !== EXPECTED_PACKAGE_MODE) return { ok: false, reason: 'package-mode-invalid' }
  return { ok: true, reason: 'package-valid' }
}

function normalizeExistingDoc(doc, collection) {
  return {
    collection,
    id: cleanText(doc?.id),
    name: cleanText(doc?.name || doc?.title),
    slug: cleanText(doc?.slug),
    status: cleanText(doc?.status),
    updatedAt: cleanText(doc?.updatedAt),
  }
}

function uniqueDocs(docs, collection) {
  const seen = new Set()
  const output = []

  for (const doc of asRows(docs)) {
    const normalized = normalizeExistingDoc(doc, collection)
    const key = normalized.id || `${normalized.name.toLowerCase()}|${normalized.slug.toLowerCase()}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }

  return output
}

function resultStatus(existing, error = '') {
  if (error) return 'query-error'
  if (existing.length === 0) return 'would-create'
  if (existing.length === 1) return 'already-exists'
  return 'ambiguous-existing'
}

async function defaultLookupEntity(entity, { url = DEFAULT_PAYLOAD_URL, token = '' } = {}) {
  const baseUrl = String(url || DEFAULT_PAYLOAD_URL).replace(/\/+$/u, '')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const collection = cleanText(entity.collection)
  const name = cleanText(entity.name)
  const slug = cleanText(entity.slug)
  const docs = []

  async function queryBy(field, value) {
    if (!value) return []
    const query = new URLSearchParams()
    query.set('limit', '10')
    query.set('depth', '0')
    query.set(`where[${field}][equals]`, value)
    const response = await fetch(`${baseUrl}/api/${collection}?${query.toString()}`, { headers })
    if (!response.ok) throw new Error(`Payload query failed for ${collection}.${field}: ${response.status} ${response.statusText}`)
    const body = await response.json()
    return asRows(body?.docs)
  }

  docs.push(...await queryBy('name', name))
  docs.push(...await queryBy('slug', slug))

  return uniqueDocs(docs, collection)
}

function entitySummary(entity) {
  return {
    collection: cleanText(entity.collection),
    kind: cleanText(entity.kind),
    name: cleanText(entity.name),
    slug: cleanText(entity.slug),
    importAction: cleanText(entity.importAction),
    roles: asRows(entity.roles).map(cleanText).filter(Boolean),
    originalRoles: asRows(entity.originalRoles).map(cleanText).filter(Boolean),
    sourceWorksTotal: asRows(entity.sourceWorks).length,
    evidenceTotal: asRows(entity.evidence).length,
  }
}

export async function buildBangumiMediaEntityImportDryRun(pkg, audit = null, {
  generatedAt = new Date().toISOString(),
  requireAuditPass = true,
  url = DEFAULT_PAYLOAD_URL,
  lookupEntity = defaultLookupEntity,
  token = '',
} = {}) {
  const auditCheck = auditAllowsDryRun(audit, { requireAuditPass })
  const packageCheck = packageAllowsDryRun(pkg)
  const entities = collectionEntities(pkg)
  const canQuery = auditCheck.ok && packageCheck.ok
  const results = []
  const skippedEntities = []

  for (const entity of entities) {
    const summary = entitySummary(entity)

    if (!canQuery) {
      skippedEntities.push({ ...summary, reason: auditCheck.ok ? packageCheck.reason : auditCheck.reason })
      continue
    }

    let existing = []
    let error = ''

    try {
      existing = await lookupEntity(entity, { url, token })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }

    const status = resultStatus(existing, error)
    results.push({
      ...summary,
      mode: DRY_RUN_MODE,
      status,
      plannedOperation: status === 'would-create' ? 'create' : 'none',
      existing,
      error,
      safety: {
        payloadRead: true,
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
    })
  }

  const allRows = [...results, ...skippedEntities]
  const countsByStatus = Object.fromEntries(['would-create', 'already-exists', 'ambiguous-existing', 'query-error'].map((status) => [status, results.filter((row) => row.status === status).length]))

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
        auditCheck: auditCheck.reason,
        packageCheck: packageCheck.reason,
      },
      safety: {
        payloadRead: canQuery,
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        packageCreatorsTotal: asRows(pkg?.creators).length,
        packageOrganizationsTotal: asRows(pkg?.organizations).length,
        packageEntitiesTotal: entities.length,
        resultsTotal: results.length,
        skippedEntitiesTotal: skippedEntities.length,
        wouldCreateTotal: countsByStatus['would-create'],
        alreadyExistsTotal: countsByStatus['already-exists'],
        ambiguousExistingTotal: countsByStatus['ambiguous-existing'],
        queryErrorsTotal: countsByStatus['query-error'],
        creatorResultsTotal: allRows.filter((row) => row.collection === 'creators').length,
        organizationResultsTotal: allRows.filter((row) => row.collection === 'organizations').length,
        packageEvidenceTotal: entities.reduce((sum, entity) => sum + safeCount(asRows(entity.evidence).length), 0),
      },
    },
    results,
    skippedEntities,
  }
}

function reportRow(row) {
  const existing = asRows(row.existing).map((item) => item.name || item.slug || item.id).filter(Boolean).join('；')
  return `| ${row.collection} | ${row.name} | ${row.slug} | ${row.status || 'skipped'} | ${row.plannedOperation || 'none'} | ${existing} | ${row.reason || row.error || ''} |`
}

export function createBangumiMediaEntityImportDryRunReport(dryRun, { inputPath = '', auditPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = dryRun?.meta || {}
  const stats = meta.stats || {}
  const results = asRows(dryRun?.results).slice(0, topLimit)
  const skipped = asRows(dryRun?.skippedEntities).slice(0, topLimit)
  const lines = [
    '# Bangumi media entity import dry-run',
    '',
    '## Summary',
    '',
    `- source: ${meta.source || ''}`,
    `- mode: ${meta.mode || ''}`,
    `- generatedAt: ${meta.generatedAt || ''}`,
    `- url: ${meta.url || ''}`,
    inputPath ? `- input: ${inputPath}` : '',
    auditPath ? `- audit: ${auditPath}` : '',
    `- auditCheck: ${meta.checks?.auditCheck || ''}`,
    `- packageCheck: ${meta.checks?.packageCheck || ''}`,
    `- packageEntitiesTotal: ${stats.packageEntitiesTotal}`,
    `- resultsTotal: ${stats.resultsTotal}`,
    `- skippedEntitiesTotal: ${stats.skippedEntitiesTotal}`,
    `- wouldCreateTotal: ${stats.wouldCreateTotal}`,
    `- alreadyExistsTotal: ${stats.alreadyExistsTotal}`,
    `- ambiguousExistingTotal: ${stats.ambiguousExistingTotal}`,
    `- queryErrorsTotal: ${stats.queryErrorsTotal}`,
    '',
    '## Safety',
    '',
    '- Dry-run only.',
    '- Payload read/query only.',
    '- No Payload create/update/delete.',
    '- No database writes.',
    '- No entity import.',
    '- No works patch.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Results',
    '',
    '| Collection | Name | Slug | Status | Planned operation | Existing | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(reportRow),
    '',
    '## Skipped entities',
    '',
  ].filter((line) => line !== '')

  if (skipped.length === 0) lines.push('- none')
  else {
    lines.push('| Collection | Name | Slug | Status | Planned operation | Existing | Note |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
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
  const dryRun = await buildBangumiMediaEntityImportDryRun(pkg, audit, { requireAuditPass, url, token })

  await writeJson(output, dryRun)
  await writeText(report, createBangumiMediaEntityImportDryRunReport(dryRun, { inputPath: input, auditPath: auditInput, topLimit }))

  console.log(`Wrote Bangumi media entity import dry-run -> ${output}`)
  console.log(`Wrote Bangumi media entity import dry-run report -> ${report}`)
  console.log(`Dry-run: would-create=${dryRun.meta.stats.wouldCreateTotal}; already-exists=${dryRun.meta.stats.alreadyExistsTotal}; ambiguous=${dryRun.meta.stats.ambiguousExistingTotal}; query-errors=${dryRun.meta.stats.queryErrorsTotal}; skipped=${dryRun.meta.stats.skippedEntitiesTotal}`)

  if (dryRun.meta.stats.queryErrorsTotal > 0 || dryRun.meta.stats.skippedEntitiesTotal > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
