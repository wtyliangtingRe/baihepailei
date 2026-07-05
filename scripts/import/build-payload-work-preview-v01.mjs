#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN = 'data_local/staging/import/payload-work-draft-plan-v02.rows.jsonl'
const DEFAULT_AUDIT = 'data_local/staging/import/work-draft-plan-audit-v02-summary.json'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const EXPECTED_PLAN_VERSION = 'payload-work-draft-plan-v0.2'
const EXPECTED_AUDIT_VERSION = 'work-draft-plan-audit-v0.2'
const VERSION = 'payload-work-preview-v0.1'
const SAMPLE_LIMIT = 30

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

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
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
    .map(([key, values]) => ({ key, count: values.length, samples: values.slice(0, 20).map((row) => row.planId || row.previewId) }))
}

function previewIssues(row) {
  const issues = []
  const payload = row.payload || {}
  const safety = row.safety || {}

  if (row.version !== EXPECTED_PLAN_VERSION) issues.push('unexpected_plan_version')
  if (row.action !== 'create_payload_work_draft') issues.push('unexpected_plan_action')
  if (row.collection !== 'works') issues.push('unexpected_collection')
  if (!val(row.planId)) issues.push('missing_plan_id')
  if (!val(payload.title)) issues.push('missing_title')
  if (!val(payload.slug)) issues.push('missing_slug')
  if (!val(payload.siteId)) issues.push('missing_site_id')
  if (payload.status !== 'draft') issues.push('status_not_draft')
  if (payload.reviewStatus !== 'pending') issues.push('review_status_not_pending')
  if (payload.rank !== 'unknown') issues.push('rank_not_unknown')
  if (payload.evidenceStrength !== 'unassessed') issues.push('evidence_strength_not_unassessed')
  if (payload.isFullVisible !== false) issues.push('full_visibility_not_false')
  if (payload.hasEvidence !== false) issues.push('has_evidence_not_false')
  if (safety.reviewOnly !== true) issues.push('safety_review_only_not_true')
  if (safety.applyAllowed !== false) issues.push('safety_apply_allowed_not_false')
  if (safety.payloadWriteAllowed !== false) issues.push('safety_payload_write_not_false')
  if (safety.postgresqlWriteAllowed !== false) issues.push('safety_postgresql_write_not_false')
  if (safety.importerActionAllowed !== false) issues.push('safety_importer_action_not_false')

  return issues
}

function buildPreview(row) {
  return {
    previewId: `preview:${row.planId}`,
    version: VERSION,
    collection: 'works',
    operation: 'create_draft_preview',
    sourcePlanId: row.planId,
    payload: row.payload,
    safety: {
      dryRunOnly: true,
      localReportOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowed: false,
    },
  }
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
    '# Payload Work Preview v0.1',
    '',
    'Local preview for reviewed draft rows. This report does not access Payload or PostgreSQL.',
    '',
    '## Safety',
    '',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL access.',
    '- No importer action.',
    '- No apply action.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForPayloadDryRun: ${summary.readyForPayloadDryRun}`,
    `- planRowsRead: ${summary.planRowsRead}`,
    `- planRowsFailed: ${summary.planRowsFailed}`,
    `- previewRows: ${summary.previewRows}`,
    `- skippedRows: ${summary.skippedRows}`,
    `- issueRows: ${summary.issueRows}`,
    `- duplicatePreviewIds: ${summary.duplicatePreviewIds}`,
    `- duplicateSiteIds: ${summary.duplicateSiteIds}`,
    `- duplicateSlugs: ${summary.duplicateSlugs}`,
    `- payloadWriteRows: ${summary.safety.payloadWriteRows}`,
    `- postgresqlWriteRows: ${summary.safety.postgresqlWriteRows}`,
    `- importerActionRows: ${summary.safety.importerActionRows}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    '',
    ...table('Preview rows by source', summary.bySource, 'Source'),
    ...table('Preview rows by media type', summary.byMediaType, 'Media Type'),
    ...table('Skipped rows by issue', summary.byIssue, 'Issue'),
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const planPath = arg('plan', DEFAULT_PLAN)
  const auditPath = arg('audit', DEFAULT_AUDIT)
  const outDir = arg('out-dir', DEFAULT_OUT_DIR)

  if (!fs.existsSync(planPath)) throw new Error(`Plan rows file not found: ${planPath}`)

  const plan = await readJsonl(planPath)
  const auditSummary = readJsonIfExists(auditPath)
  const previewRows = []
  const issueRows = []
  const byIssue = {}

  for (const row of plan.rows) {
    const issues = previewIssues(row)
    if (issues.length) {
      issueRows.push({
        planId: val(row.planId),
        title: val(row.payload?.title),
        slug: val(row.payload?.slug),
        siteId: val(row.payload?.siteId),
        issues,
      })
      for (const issue of issues) byIssue[issue] = (byIssue[issue] || 0) + 1
      continue
    }
    previewRows.push(buildPreview(row))
  }

  const duplicatePreviewIds = collectDuplicates(previewRows, (row) => row.previewId)
  const duplicateSiteIds = collectDuplicates(previewRows, (row) => row.payload?.siteId)
  const duplicateSlugs = collectDuplicates(previewRows, (row) => row.payload?.slug)

  const payloadWriteRows = previewRows.filter((row) => row.safety?.payloadWrite === true).length
  const postgresqlWriteRows = previewRows.filter((row) => row.safety?.postgresqlWrite === true).length
  const importerActionRows = previewRows.filter((row) => row.safety?.importerAction === true).length
  const applyAllowedRows = previewRows.filter((row) => row.safety?.applyAllowed === true).length

  const blockers = []
  if (plan.failed) blockers.push(`plan_rows_failed_to_parse:${plan.failed}`)
  if (!auditSummary) blockers.push('missing_audit_summary')
  if (auditSummary && auditSummary.version !== EXPECTED_AUDIT_VERSION) blockers.push('unexpected_audit_version')
  if (auditSummary && auditSummary.readyForDryRunImporter !== true) blockers.push('audit_not_ready')
  if (issueRows.length) blockers.push(`issue_rows:${issueRows.length}`)
  if (duplicatePreviewIds.length) blockers.push(`duplicate_preview_ids:${duplicatePreviewIds.length}`)
  if (duplicateSiteIds.length) blockers.push(`duplicate_site_ids:${duplicateSiteIds.length}`)
  if (duplicateSlugs.length) blockers.push(`duplicate_slugs:${duplicateSlugs.length}`)
  if (payloadWriteRows || postgresqlWriteRows || importerActionRows || applyAllowedRows) blockers.push('unsafe_preview_flags')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    readyForPayloadDryRun: blockers.length === 0 && previewRows.length > 0,
    planRowsRead: plan.read,
    planRowsFailed: plan.failed,
    planRowsLoaded: plan.rows.length,
    previewRows: previewRows.length,
    skippedRows: issueRows.length,
    issueRows: issueRows.length,
    duplicatePreviewIds: duplicatePreviewIds.length,
    duplicateSiteIds: duplicateSiteIds.length,
    duplicateSlugs: duplicateSlugs.length,
    bySource: countBy(previewRows, (row) => row.payload?.candidateSources?.[0]?.source),
    byMediaType: countBy(previewRows, (row) => row.payload?.mediaType),
    byStatus: countBy(previewRows, (row) => row.payload?.status),
    byIssue: Object.fromEntries(Object.entries(byIssue).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    inputs: {
      plan: planPath,
      audit: auditPath,
    },
    outputs: {
      rows: path.join(outDir, 'payload-work-preview-v01.rows.jsonl'),
      json: path.join(outDir, 'payload-work-preview-v01.json'),
      summary: path.join(outDir, 'payload-work-preview-v01-summary.json'),
      md: path.join(outDir, 'payload-work-preview-v01.md'),
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowed: false,
      payloadWriteRows,
      postgresqlWriteRows,
      importerActionRows,
      applyAllowedRows,
    },
  }

  const samples = {
    previewRows: previewRows.slice(0, SAMPLE_LIMIT).map((row) => ({
      previewId: row.previewId,
      title: row.payload?.title,
      slug: row.payload?.slug,
      siteId: row.payload?.siteId,
      status: row.payload?.status,
      reviewStatus: row.payload?.reviewStatus,
      mediaType: row.payload?.mediaType,
    })),
    issueRows: issueRows.slice(0, SAMPLE_LIMIT),
    duplicatePreviewIds: duplicatePreviewIds.slice(0, SAMPLE_LIMIT),
    duplicateSiteIds: duplicateSiteIds.slice(0, SAMPLE_LIMIT),
    duplicateSlugs: duplicateSlugs.slice(0, SAMPLE_LIMIT),
  }

  const report = { ok: blockers.length === 0, summary, blockers, samples, rows: previewRows }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.rows, previewRows.map((row) => JSON.stringify(row)).join('\n') + (previewRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: report.ok, summary, blockers, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
