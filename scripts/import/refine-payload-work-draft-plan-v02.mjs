#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/import/payload-work-draft-plan-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const VERSION = 'payload-work-draft-plan-v0.2'
const BATCH = 'payload-work-draft-plan-v02'
const MAX_SLUG_LENGTH = 200

function val(value) {
  return String(value ?? '').trim()
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function collectDuplicates(rows, getKey) {
  const buckets = new Map()
  for (const row of rows) {
    const key = val(getKey(row))
    if (!key) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }
  return [...buckets.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, count: values.length, samples: values.slice(0, 20).map((row) => row.planId) }))
}

function safeSlugPart(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
}

function trimSlugBase(base, maxLength) {
  const text = safeSlugPart(base)
  if (text.length <= maxLength) return text

  const parts = text.split('-')
  const kept = []
  for (const part of parts) {
    const next = [...kept, part].join('-')
    if (next.length > maxLength) break
    kept.push(part)
  }

  const joined = kept.join('-')
  if (joined.length >= 2) return joined
  return text.slice(0, maxLength).replace(/-+$/u, '') || 'work'
}

function sourceIdentity(row) {
  const siteId = val(row.payload?.siteId)
  if (siteId.startsWith('catalog-')) return siteId.slice('catalog-'.length)

  const planId = val(row.planId)
  if (planId.startsWith('work-draft:')) return safeSlugPart(planId.slice('work-draft:'.length))

  const source = row.sourceEligibilityRow || {}
  const sourceName = safeSlugPart(source.sourceName || 'source')
  const sourceId = safeSlugPart(source.sourceId || source.sourceRecordKey || source.nodeId || 'unknown')
  return `${sourceName}-${sourceId}`
}

function buildSlug(row) {
  const identity = sourceIdentity(row)
  const suffix = `-${identity}`
  const maxBaseLength = Math.max(8, MAX_SLUG_LENGTH - suffix.length)
  const originalSlug = val(row.payload?.slug)
  const existingBase = originalSlug.endsWith(suffix) ? originalSlug.slice(0, -suffix.length) : originalSlug
  const fallbackBase = row.payload?.searchText || row.payload?.originalTitle || row.payload?.title || row.planId
  const base = trimSlugBase(existingBase || fallbackBase, maxBaseLength)
  return `${base}${suffix}`.replace(/^-+|-+$/gu, '')
}

function sanitizeRow(row) {
  const next = JSON.parse(JSON.stringify(row))
  const payload = next.payload || {}
  const safety = next.safety || {}

  next.version = VERSION
  payload.importBatch = BATCH
  payload.slug = buildSlug(next)
  payload.sourceConflictNotes = 'Generated draft only. Not manually reviewed.'
  payload.evidenceNote = 'Catalog draft generated from source metadata only. Human review and evidence assessment have not been applied.'
  payload.status = 'draft'
  payload.reviewStatus = 'pending'
  payload.rank = 'unknown'
  payload.ratingNotice = 'ai_synthesized_pending_review'
  payload.evidenceStrength = 'unassessed'
  payload.isLiteVisible = true
  payload.isFullVisible = false
  payload.hasEvidence = false

  if (payload.riskMatrix && typeof payload.riskMatrix === 'object') {
    payload.riskMatrix.note = 'Unassessed catalog draft.'
  }

  safety.reviewOnly = true
  safety.applyAllowed = false
  safety.payloadWriteAllowed = false
  safety.postgresqlWriteAllowed = false
  safety.importerActionAllowed = false

  next.payload = payload
  next.safety = safety
  return next
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function table(title, rows, keyLabel = 'Key') {
  return [
    `## ${title}`,
    '',
    `| ${keyLabel} | Count |`,
    '|---|---:|',
    ...Object.entries(rows || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function markdown(summary, samples) {
  return [
    '# Refined Payload Work Draft Plan v0.2',
    '',
    'This script normalizes local draft plan rows and writes a new local plan. It does not access Payload or PostgreSQL.',
    '',
    '## Safety',
    '',
    '- No Payload access.',
    '- No PostgreSQL access.',
    '- No importer action.',
    '- No apply action.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForPlanAudit: ${summary.readyForPlanAudit}`,
    `- inputRowsRead: ${summary.inputRowsRead}`,
    `- inputRowsFailed: ${summary.inputRowsFailed}`,
    `- outputRows: ${summary.outputRows}`,
    `- duplicateSiteIds: ${summary.duplicateSiteIds}`,
    `- duplicateSlugs: ${summary.duplicateSlugs}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    `- payloadWriteAllowedRows: ${summary.safety.payloadWriteAllowedRows}`,
    '',
    ...table('Rows by source', summary.bySource, 'Source'),
    ...table('Rows by media type', summary.byMediaType, 'Media Type'),
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const inputPath = arg('input', DEFAULT_INPUT)
  const outDir = arg('out-dir', DEFAULT_OUT_DIR)

  if (!fs.existsSync(inputPath)) throw new Error(`Input plan file not found: ${inputPath}`)

  const input = await readJsonl(inputPath)
  const rows = input.rows.map(sanitizeRow)
  const duplicateSiteIds = collectDuplicates(rows, (row) => row.payload?.siteId)
  const duplicateSlugs = collectDuplicates(rows, (row) => row.payload?.slug)

  const applyAllowedRows = rows.filter((row) => row.safety?.applyAllowed === true).length
  const payloadWriteAllowedRows = rows.filter((row) => row.safety?.payloadWriteAllowed === true).length
  const postgresqlWriteAllowedRows = rows.filter((row) => row.safety?.postgresqlWriteAllowed === true).length
  const importerActionAllowedRows = rows.filter((row) => row.safety?.importerActionAllowed === true).length

  const blockers = []
  if (input.failed) blockers.push(`input_rows_failed_to_parse:${input.failed}`)
  if (duplicateSiteIds.length) blockers.push(`duplicate_site_ids:${duplicateSiteIds.length}`)
  if (duplicateSlugs.length) blockers.push(`duplicate_slugs:${duplicateSlugs.length}`)
  if (applyAllowedRows || payloadWriteAllowedRows || postgresqlWriteAllowedRows || importerActionAllowedRows) blockers.push('unsafe_permission_flags')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    readyForPlanAudit: blockers.length === 0 && rows.length > 0,
    inputRowsRead: input.read,
    inputRowsFailed: input.failed,
    outputRows: rows.length,
    duplicateSiteIds: duplicateSiteIds.length,
    duplicateSlugs: duplicateSlugs.length,
    bySource: countBy(rows, (row) => row.sourceEligibilityRow?.sourceName),
    byMediaType: countBy(rows, (row) => row.payload?.mediaType),
    inputs: { input: inputPath },
    outputs: {
      rows: path.join(outDir, 'payload-work-draft-plan-v02.rows.jsonl'),
      json: path.join(outDir, 'payload-work-draft-plan-v02.json'),
      summary: path.join(outDir, 'payload-work-draft-plan-v02-summary.json'),
      md: path.join(outDir, 'payload-work-draft-plan-v02.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows,
      payloadWriteAllowedRows,
      postgresqlWriteAllowedRows,
      importerActionAllowedRows,
    },
  }

  const samples = {
    rows: rows.slice(0, 20).map((row) => ({
      planId: row.planId,
      title: row.payload?.title,
      slug: row.payload?.slug,
      siteId: row.payload?.siteId,
      sourceConflictNotes: row.payload?.sourceConflictNotes,
    })),
    duplicateSiteIds: duplicateSiteIds.slice(0, 20),
    duplicateSlugs: duplicateSlugs.slice(0, 20),
  }

  const report = { ok: blockers.length === 0, summary, blockers, samples, rows }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.rows, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: report.ok, summary, blockers, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
