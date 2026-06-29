#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_INPUT = path.join('data_local', 'payload', 'bangumi-media-work-package-preview.json')
const DEFAULT_DRY_RUN_INPUT = path.join('data_local', 'payload', 'bangumi-media-work-import-dry-run.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-work-import-apply.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-work-import-apply.md')
const DEFAULT_TOP_LIMIT = 100
const DEFAULT_PAYLOAD_URL = 'http://127.0.0.1:3000'
const CONFIRM_TOKEN = 'APPLY_BANGUMI_MEDIA_WORKS'
const REPORT_UTF8_BOM = '\uFEFF'

const EXPECTED_PACKAGE_SOURCE = 'bangumi-media-work-package-preview'
const EXPECTED_PACKAGE_MODE = 'package-preview-only-no-payload-write'
const EXPECTED_DRY_RUN_SOURCE = 'bangumi-media-work-import-dry-run'
const EXPECTED_DRY_RUN_MODE = 'dry-run-payload-read-no-write'
const APPLY_SOURCE = 'bangumi-media-work-import-apply'
const PREVIEW_MODE = 'guarded-apply-preview-no-payload-write'
const APPLY_MODE = 'apply-guarded-payload-write'

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

function packageAllowsApply(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, reason: 'package-not-object' }
  if (cleanText(pkg?.meta?.source) !== EXPECTED_PACKAGE_SOURCE) return { ok: false, reason: 'package-source-invalid' }
  if (cleanText(pkg?.meta?.mode) !== EXPECTED_PACKAGE_MODE) return { ok: false, reason: 'package-mode-invalid' }
  return { ok: true, reason: 'package-valid' }
}

function dryRunAllowsApply(dryRun) {
  if (!dryRun || typeof dryRun !== 'object' || Array.isArray(dryRun)) return { ok: false, reason: 'dry-run-not-object' }
  if (cleanText(dryRun?.meta?.source) !== EXPECTED_DRY_RUN_SOURCE) return { ok: false, reason: 'dry-run-source-invalid' }
  if (cleanText(dryRun?.meta?.mode) !== EXPECTED_DRY_RUN_MODE) return { ok: false, reason: 'dry-run-mode-invalid' }
  if (safeCount(dryRun?.meta?.stats?.queryErrorsTotal) > 0) return { ok: false, reason: 'dry-run-has-query-errors' }
  if (safeCount(dryRun?.meta?.stats?.skippedWorksTotal) > 0) return { ok: false, reason: 'dry-run-has-skipped-works' }
  if (safeCount(dryRun?.meta?.stats?.ambiguousExistingTotal) > 0) return { ok: false, reason: 'dry-run-has-ambiguous-existing' }
  return { ok: true, reason: 'dry-run-valid' }
}

function workKey(work) {
  return cleanText(work.bangumiSubjectId) || cleanText(work.slug) || cleanText(work.title)
}

function dryRunByWorkKey(dryRun) {
  const byKey = new Map()
  for (const row of asRows(dryRun?.results)) {
    const key = workKey(row)
    if (!key || byKey.has(key)) continue
    byKey.set(key, row)
  }
  return byKey
}

function normalizeAliasRows(aliases) {
  return asRows(aliases).map((alias) => {
    if (typeof alias === 'string') return { value: cleanText(alias) }
    return { value: cleanText(alias?.value || alias?.name || alias?.title) }
  }).filter((alias) => alias.value)
}

function bangumiSubjectUrl(bangumiSubjectId) {
  const id = cleanText(bangumiSubjectId)
  return id ? `https://bgm.tv/subject/${id}` : ''
}

function hintNames(hints) {
  return asRows(hints).map((hint) => cleanText(hint?.name)).filter(Boolean)
}

function buildSearchText(work) {
  return [
    cleanText(work.title),
    cleanText(work.originalSlug),
    cleanText(work.slug),
    ...normalizeAliasRows(work.aliases).map((alias) => alias.value),
    ...hintNames(work.creatorCreditHints),
    ...hintNames(work.organizationCreditHints),
    cleanText(work.bangumiSubjectId),
  ].filter(Boolean).join('\n')
}

function buildEvidenceNote(work) {
  const creatorHints = asRows(work.creatorCreditHints).map((hint) => `${cleanText(hint.name)}:${cleanText(hint.role || hint.originalRole)}`).filter((item) => item !== ':')
  const organizationHints = asRows(work.organizationCreditHints).map((hint) => `${cleanText(hint.name)}:${cleanText(hint.role || hint.originalRole)}`).filter((item) => item !== ':')
  const lines = [
    'Bangumi media work seed import.',
    `Bangumi subject: ${cleanText(work.bangumiSubjectId)}`,
    `Media: ${cleanText(work.mediaGroup)} / ${cleanText(work.mediaType)}`,
    work.slugCollisionResolved ? `Slug collision resolved: ${cleanText(work.originalSlug)} -> ${cleanText(work.slug)}` : '',
    creatorHints.length > 0 ? `Creator hints: ${creatorHints.join('；')}` : '',
    organizationHints.length > 0 ? `Organization hints: ${organizationHints.join('；')}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

export function buildWorkCreatePayload(work) {
  const bangumiSubjectId = cleanText(work.bangumiSubjectId)
  const bangumiUrl = bangumiSubjectUrl(bangumiSubjectId)
  return {
    title: cleanText(work.title),
    slug: cleanText(work.slug),
    siteId: bangumiSubjectId ? `bangumi-${bangumiSubjectId}` : '',
    status: cleanText(work.status || 'draft') || 'draft',
    mediaGroup: cleanText(work.mediaGroup) || 'unknown',
    mediaType: cleanText(work.mediaType) || 'unknown',
    externalIds: {
      bangumiSubjectId,
    },
    candidateSources: [
      {
        source: 'bangumi',
        label: 'Bangumi',
        externalId: bangumiSubjectId,
        url: bangumiUrl,
        note: 'Imported from Bangumi media work package preview.',
      },
    ].filter((source) => source.externalId || source.url),
    sourceLinks: [
      {
        label: 'Bangumi',
        url: bangumiUrl,
      },
    ].filter((source) => source.url),
    aliases: normalizeAliasRows(work.aliases),
    searchText: buildSearchText(work),
    evidenceNote: buildEvidenceNote(work),
    hasEvidence: false,
  }
}

async function defaultCreateWork(work, { url = DEFAULT_PAYLOAD_URL, token = '' } = {}) {
  const baseUrl = String(url || DEFAULT_PAYLOAD_URL).replace(/\/+$/u, '')
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const payload = buildWorkCreatePayload(work)
  const response = await fetch(`${baseUrl}/api/works`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = cleanText(body?.message || body?.errors?.map((error) => error.message).join('; '))
    } catch {
      detail = cleanText(await response.text())
    }
    throw new Error(`Payload create failed for works/${cleanText(work.title)}: ${response.status} ${detail || response.statusText}`)
  }

  const body = await response.json()
  return body?.doc || body
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

export async function buildBangumiMediaWorkImportApply(pkg, dryRun, {
  generatedAt = new Date().toISOString(),
  apply = false,
  confirm = '',
  url = DEFAULT_PAYLOAD_URL,
  token = '',
  createWork = defaultCreateWork,
} = {}) {
  const packageCheck = packageAllowsApply(pkg)
  const dryRunCheck = dryRunAllowsApply(dryRun)
  const confirmOk = cleanText(confirm) === CONFIRM_TOKEN
  const payloadWrite = Boolean(apply && confirmOk && packageCheck.ok && dryRunCheck.ok)
  const mode = payloadWrite ? APPLY_MODE : PREVIEW_MODE
  const dryRows = dryRunByWorkKey(dryRun)
  const works = asRows(pkg?.works)
  const results = []
  const errors = []

  for (const work of works) {
    const summary = workSummary(work)
    const dryRow = dryRows.get(workKey(work))
    const dryStatus = cleanText(dryRow?.status)

    if (!packageCheck.ok || !dryRunCheck.ok) {
      results.push({ ...summary, status: 'skipped', dryRunStatus: dryStatus, reason: packageCheck.ok ? dryRunCheck.reason : packageCheck.reason })
      continue
    }

    if (dryStatus !== 'would-create') {
      results.push({ ...summary, status: 'skipped', dryRunStatus: dryStatus, reason: `dry-run-status-${dryStatus || 'missing'}` })
      continue
    }

    if (!payloadWrite) {
      results.push({ ...summary, status: 'skipped', dryRunStatus: dryStatus, reason: apply ? 'confirm-token-missing-or-invalid' : 'apply-flag-missing', plannedOperation: 'create' })
      continue
    }

    try {
      const created = await createWork(work, { url, token })
      results.push({
        ...summary,
        status: 'applied',
        dryRunStatus: dryStatus,
        plannedOperation: 'create',
        created: {
          id: cleanText(created?.id),
          title: cleanText(created?.title || created?.name),
          slug: cleanText(created?.slug),
          siteId: cleanText(created?.siteId),
          status: cleanText(created?.status),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const error = { ...summary, status: 'error', dryRunStatus: dryStatus, plannedOperation: 'create', error: message }
      results.push(error)
      errors.push(error)
    }
  }

  const applied = results.filter((row) => row.status === 'applied')
  const skipped = results.filter((row) => row.status === 'skipped')
  const attempted = results.filter((row) => row.status === 'applied' || row.status === 'error')

  return {
    meta: {
      source: APPLY_SOURCE,
      mode,
      generatedAt,
      url: cleanText(url),
      apply: Boolean(apply),
      confirmToken: confirmOk ? 'matched' : 'missing-or-invalid',
      input: {
        packageSource: cleanText(pkg?.meta?.source),
        packageMode: cleanText(pkg?.meta?.mode),
        dryRunSource: cleanText(dryRun?.meta?.source),
        dryRunMode: cleanText(dryRun?.meta?.mode),
      },
      checks: {
        packageCheck: packageCheck.reason,
        dryRunCheck: dryRunCheck.reason,
      },
      safety: {
        payloadRead: false,
        payloadWrite,
        databaseWrite: payloadWrite,
        workImport: payloadWrite,
        entityImport: false,
        worksPatch: false,
        coverUpload: false,
      },
      stats: {
        packageWorksTotal: works.length,
        dryRunResultsTotal: asRows(dryRun?.results).length,
        attemptedWrites: attempted.length,
        appliedTotal: applied.length,
        skippedTotal: skipped.length,
        errorsTotal: errors.length,
        creatorCreditHintsTotal: works.reduce((sum, work) => sum + asRows(work.creatorCreditHints).length, 0),
        organizationCreditHintsTotal: works.reduce((sum, work) => sum + asRows(work.organizationCreditHints).length, 0),
      },
    },
    results,
    errors,
  }
}

function reportRow(row) {
  const created = row.created?.id ? `${row.created.id}/${row.created.slug}` : ''
  const note = [row.reason, row.error].filter(Boolean).join('；')
  return `| ${row.title} | ${row.slug} | ${row.bangumiSubjectId} | ${row.mediaGroup}/${row.mediaType} | ${row.status} | ${row.dryRunStatus || ''} | ${created} | ${note} |`
}

export function createBangumiMediaWorkImportApplyReport(applyResult, { inputPath = '', dryRunPath = '', topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const meta = applyResult?.meta || {}
  const stats = meta.stats || {}
  const lines = [
    '# Bangumi media work import apply',
    '',
    '## Summary',
    '',
    `- source: ${meta.source || ''}`,
    `- mode: ${meta.mode || ''}`,
    `- generatedAt: ${meta.generatedAt || ''}`,
    `- url: ${meta.url || ''}`,
    inputPath ? `- input: ${inputPath}` : '',
    dryRunPath ? `- dryRun: ${dryRunPath}` : '',
    `- apply: ${meta.apply}`,
    `- confirmToken: ${meta.confirmToken}`,
    `- packageCheck: ${meta.checks?.packageCheck || ''}`,
    `- dryRunCheck: ${meta.checks?.dryRunCheck || ''}`,
    `- packageWorksTotal: ${stats.packageWorksTotal}`,
    `- attemptedWrites: ${stats.attemptedWrites}`,
    `- appliedTotal: ${stats.appliedTotal}`,
    `- skippedTotal: ${stats.skippedTotal}`,
    `- errorsTotal: ${stats.errorsTotal}`,
    '',
    '## Safety',
    '',
    `- Payload write: ${meta.safety?.payloadWrite ? 'yes' : 'no'}`,
    `- Database write: ${meta.safety?.databaseWrite ? 'yes' : 'no'}`,
    `- Work import: ${meta.safety?.workImport ? 'yes' : 'no'}`,
    '- Entity import: no.',
    '- Works patch: no.',
    '- Cover upload: no.',
    '- Only dry-run `would-create` rows are eligible for create.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Results',
    '',
    '| Title | Slug | Bangumi | Media | Status | Dry-run status | Created | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...asRows(applyResult?.results).slice(0, topLimit).map(reportRow),
  ]

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
  const dryRunInput = args.get('dry-run') || DEFAULT_DRY_RUN_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)
  const url = args.get('url') || DEFAULT_PAYLOAD_URL
  const token = args.get('token') || process.env.PAYLOAD_TOKEN || ''
  const apply = args.get('apply') === 'true'
  const confirm = args.get('confirm') || ''

  const pkg = await readJson(input)
  const dryRun = await readJson(dryRunInput)
  const result = await buildBangumiMediaWorkImportApply(pkg, dryRun, { apply, confirm, url, token })

  await writeJson(output, result)
  await writeText(report, createBangumiMediaWorkImportApplyReport(result, { inputPath: input, dryRunPath: dryRunInput, topLimit }))

  console.log(`Wrote Bangumi media work import apply result -> ${output}`)
  console.log(`Wrote Bangumi media work import apply report -> ${report}`)
  console.log(`Apply mode: ${result.meta.mode}; attempted=${result.meta.stats.attemptedWrites}; applied=${result.meta.stats.appliedTotal}; skipped=${result.meta.stats.skippedTotal}; errors=${result.meta.stats.errorsTotal}`)

  if (result.meta.stats.errorsTotal > 0) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
