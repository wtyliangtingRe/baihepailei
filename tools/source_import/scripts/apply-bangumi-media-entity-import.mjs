#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-package-preview.json')
const DEFAULT_DRY_RUN_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-import-dry-run.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-entity-import-apply.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-import-apply.md')
const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PAYLOAD_URL = 'http://127.0.0.1:3000'
const CONFIRM_TOKEN = 'APPLY_BANGUMI_MEDIA_ENTITIES'
const REPORT_UTF8_BOM = '\uFEFF'

const PACKAGE_SOURCE = 'bangumi-media-entity-seed-package-preview'
const PACKAGE_MODE = 'package-preview-only-no-payload-write'
const DRY_RUN_SOURCE = 'bangumi-media-entity-import-dry-run'
const DRY_RUN_MODE = 'dry-run-payload-read-no-write'
const APPLY_SOURCE = 'bangumi-media-entity-import-apply'
const APPLY_MODE_DRY = 'guarded-apply-preview-no-payload-write'
const APPLY_MODE_WRITE = 'apply-guarded-payload-write'

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

function rowsByKey(rows) {
  const map = new Map()
  for (const row of asRows(rows)) {
    const key = [row.collection, row.name, row.slug].map((value) => cleanText(value).toLowerCase()).join('|')
    if (key) map.set(key, row)
  }
  return map
}

function entityKey(entity) {
  return [entity.collection, entity.name, entity.slug].map((value) => cleanText(value).toLowerCase()).join('|')
}

function packageCheck(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, reason: 'package-not-object' }
  if (cleanText(pkg?.meta?.source) !== PACKAGE_SOURCE) return { ok: false, reason: 'package-source-invalid' }
  if (cleanText(pkg?.meta?.mode) !== PACKAGE_MODE) return { ok: false, reason: 'package-mode-invalid' }
  return { ok: true, reason: 'package-valid' }
}

function dryRunCheck(dryRun) {
  if (!dryRun || typeof dryRun !== 'object' || Array.isArray(dryRun)) return { ok: false, reason: 'dry-run-not-object' }
  if (cleanText(dryRun?.meta?.source) !== DRY_RUN_SOURCE) return { ok: false, reason: 'dry-run-source-invalid' }
  if (cleanText(dryRun?.meta?.mode) !== DRY_RUN_MODE) return { ok: false, reason: 'dry-run-mode-invalid' }
  if (Number(dryRun?.meta?.stats?.queryErrorsTotal || 0) > 0) return { ok: false, reason: 'dry-run-has-query-errors' }
  if (Number(dryRun?.meta?.stats?.skippedEntitiesTotal || 0) > 0) return { ok: false, reason: 'dry-run-has-skipped-entities' }
  if (Number(dryRun?.meta?.stats?.ambiguousExistingTotal || 0) > 0) return { ok: false, reason: 'dry-run-has-ambiguous-existing' }
  return { ok: true, reason: 'dry-run-valid' }
}

function applyGuard({ apply, confirm }) {
  if (!apply) return { ok: false, reason: 'apply-flag-missing' }
  if (confirm !== CONFIRM_TOKEN) return { ok: false, reason: 'confirm-token-invalid' }
  return { ok: true, reason: 'apply-confirmed' }
}

function packageEntities(pkg) {
  return [...asRows(pkg?.creators), ...asRows(pkg?.organizations)]
}

function importPayloadForEntity(entity) {
  return {
    name: cleanText(entity.name),
    slug: cleanText(entity.slug),
    status: cleanText(entity.status || 'draft') || 'draft',
  }
}

function normalizeCreatedDoc(doc, entity) {
  return {
    collection: cleanText(entity.collection),
    id: cleanText(doc?.doc?.id || doc?.id),
    name: cleanText(doc?.doc?.name || doc?.name || entity.name),
    slug: cleanText(doc?.doc?.slug || doc?.slug || entity.slug),
    status: cleanText(doc?.doc?.status || doc?.status || entity.status),
  }
}

async function defaultCreateEntity(entity, { url = DEFAULT_PAYLOAD_URL, token = '' } = {}) {
  const baseUrl = String(url || DEFAULT_PAYLOAD_URL).replace(/\/+$/u, '')
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const collection = cleanText(entity.collection)
  const response = await fetch(`${baseUrl}/api/${collection}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(importPayloadForEntity(entity)),
  })
  const bodyText = await response.text()
  let body = null
  try {
    body = bodyText ? JSON.parse(bodyText) : null
  } catch {
    body = { raw: bodyText }
  }
  if (!response.ok) {
    const message = cleanText(body?.message || body?.errors?.[0]?.message || bodyText || `${response.status} ${response.statusText}`)
    throw new Error(`Payload create failed for ${collection}/${entity.name}: ${response.status} ${message}`)
  }
  return normalizeCreatedDoc(body, entity)
}

function skipResult(entity, dryRunRow, reason) {
  return {
    collection: cleanText(entity.collection),
    name: cleanText(entity.name),
    slug: cleanText(entity.slug),
    dryRunStatus: cleanText(dryRunRow?.status),
    operation: 'skipped',
    reason,
  }
}

export async function applyBangumiMediaEntityImport(pkg, dryRun, {
  generatedAt = new Date().toISOString(),
  apply = false,
  confirm = '',
  limit = 0,
  url = DEFAULT_PAYLOAD_URL,
  token = '',
  createEntity = defaultCreateEntity,
} = {}) {
  const pkgCheck = packageCheck(pkg)
  const dryCheck = dryRunCheck(dryRun)
  const guard = applyGuard({ apply, confirm })
  const entities = packageEntities(pkg)
  const dryRunIndex = rowsByKey(dryRun?.results)
  const canWrite = pkgCheck.ok && dryCheck.ok && guard.ok
  const writeLimit = Number(limit || 0)
  const applied = []
  const skipped = []
  const errors = []
  let attemptedWrites = 0

  for (const entity of entities) {
    const dryRunRow = dryRunIndex.get(entityKey(entity))
    if (!pkgCheck.ok) {
      skipped.push(skipResult(entity, dryRunRow, pkgCheck.reason))
      continue
    }
    if (!dryCheck.ok) {
      skipped.push(skipResult(entity, dryRunRow, dryCheck.reason))
      continue
    }
    if (!dryRunRow) {
      skipped.push(skipResult(entity, dryRunRow, 'dry-run-row-missing'))
      continue
    }
    if (dryRunRow.status !== 'would-create') {
      skipped.push(skipResult(entity, dryRunRow, `dry-run-status-${dryRunRow.status}`))
      continue
    }
    if (!guard.ok) {
      skipped.push(skipResult(entity, dryRunRow, guard.reason))
      continue
    }
    if (writeLimit > 0 && attemptedWrites >= writeLimit) {
      skipped.push(skipResult(entity, dryRunRow, 'limit-reached'))
      continue
    }

    attemptedWrites += 1
    try {
      const created = await createEntity(entity, { url, token })
      applied.push({
        collection: cleanText(entity.collection),
        name: cleanText(entity.name),
        slug: cleanText(entity.slug),
        operation: 'created',
        created,
      })
    } catch (err) {
      errors.push({
        collection: cleanText(entity.collection),
        name: cleanText(entity.name),
        slug: cleanText(entity.slug),
        operation: 'create-error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    meta: {
      source: APPLY_SOURCE,
      mode: canWrite ? APPLY_MODE_WRITE : APPLY_MODE_DRY,
      generatedAt,
      url: cleanText(url),
      apply: Boolean(apply),
      confirmToken: confirm === CONFIRM_TOKEN ? 'matched' : 'not-matched',
      limit: writeLimit,
      checks: {
        packageCheck: pkgCheck.reason,
        dryRunCheck: dryCheck.reason,
        guard: guard.reason,
      },
      safety: {
        payloadRead: true,
        payloadWrite: canWrite,
        databaseWrite: canWrite,
        entityImport: canWrite,
        worksPatch: false,
      },
      stats: {
        packageEntitiesTotal: entities.length,
        wouldCreateTotal: asRows(dryRun?.results).filter((row) => row.status === 'would-create').length,
        attemptedWrites,
        appliedTotal: applied.length,
        skippedTotal: skipped.length,
        errorsTotal: errors.length,
        creatorsAppliedTotal: applied.filter((row) => row.collection === 'creators').length,
        organizationsAppliedTotal: applied.filter((row) => row.collection === 'organizations').length,
      },
    },
    applied,
    skipped,
    errors,
  }
}

function tableRow(row) {
  return `| ${row.collection || ''} | ${row.name || ''} | ${row.slug || ''} | ${row.operation || 'skipped'} | ${row.reason || row.message || row.created?.id || ''} |`
}

export function createBangumiMediaEntityImportApplyReport(result, { packagePath = '', dryRunPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = result?.meta || {}
  const stats = meta.stats || {}
  const lines = [
    '# Bangumi media entity import apply',
    '',
    '## Summary',
    '',
    `- source: ${meta.source || ''}`,
    `- mode: ${meta.mode || ''}`,
    `- generatedAt: ${meta.generatedAt || ''}`,
    `- url: ${meta.url || ''}`,
    packagePath ? `- package: ${packagePath}` : '',
    dryRunPath ? `- dryRun: ${dryRunPath}` : '',
    `- apply: ${meta.apply}`,
    `- confirmToken: ${meta.confirmToken}`,
    `- packageCheck: ${meta.checks?.packageCheck || ''}`,
    `- dryRunCheck: ${meta.checks?.dryRunCheck || ''}`,
    `- guard: ${meta.checks?.guard || ''}`,
    `- packageEntitiesTotal: ${stats.packageEntitiesTotal}`,
    `- wouldCreateTotal: ${stats.wouldCreateTotal}`,
    `- attemptedWrites: ${stats.attemptedWrites}`,
    `- appliedTotal: ${stats.appliedTotal}`,
    `- skippedTotal: ${stats.skippedTotal}`,
    `- errorsTotal: ${stats.errorsTotal}`,
    '',
    '## Safety',
    '',
    '- Guarded apply script.',
    '- Without `--apply --confirm APPLY_BANGUMI_MEDIA_ENTITIES`, it does not write Payload.',
    '- Writes only entities classified as `would-create` by the dry-run.',
    '- No works patch.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Applied',
    '',
  ].filter((line) => line !== '')

  const applied = asRows(result?.applied).slice(0, topLimit)
  if (applied.length === 0) lines.push('- none')
  else {
    lines.push('| Collection | Name | Slug | Operation | Note |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const row of applied) lines.push(tableRow(row))
  }

  lines.push('', '## Skipped', '')
  const skipped = asRows(result?.skipped).slice(0, topLimit)
  if (skipped.length === 0) lines.push('- none')
  else {
    lines.push('| Collection | Name | Slug | Operation | Note |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const row of skipped) lines.push(tableRow(row))
  }

  lines.push('', '## Errors', '')
  const errors = asRows(result?.errors).slice(0, topLimit)
  if (errors.length === 0) lines.push('- none')
  else {
    lines.push('| Collection | Name | Slug | Operation | Note |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const row of errors) lines.push(tableRow(row))
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
  const packagePath = args.get('in') || DEFAULT_PACKAGE_INPUT
  const dryRunPath = args.get('dry-run') || DEFAULT_DRY_RUN_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)
  const limit = Number(args.get('limit') || 0)
  const apply = args.get('apply') === 'true'
  const confirm = args.get('confirm') || ''
  const url = args.get('url') || DEFAULT_PAYLOAD_URL
  const token = args.get('token') || process.env.PAYLOAD_TOKEN || ''

  const pkg = await readJson(packagePath)
  const dryRun = await readJson(dryRunPath)
  const result = await applyBangumiMediaEntityImport(pkg, dryRun, { apply, confirm, limit, url, token })

  await writeJson(output, result)
  await writeText(report, createBangumiMediaEntityImportApplyReport(result, { packagePath, dryRunPath, topLimit }))

  console.log(`Wrote Bangumi media entity import apply result -> ${output}`)
  console.log(`Wrote Bangumi media entity import apply report -> ${report}`)
  console.log(`Apply mode: ${result.meta.mode}; attempted=${result.meta.stats.attemptedWrites}; applied=${result.meta.stats.appliedTotal}; skipped=${result.meta.stats.skippedTotal}; errors=${result.meta.stats.errorsTotal}`)

  if (result.meta.stats.errorsTotal > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
