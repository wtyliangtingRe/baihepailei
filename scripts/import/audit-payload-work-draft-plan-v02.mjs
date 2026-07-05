#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN = 'data_local/staging/import/payload-work-draft-plan-v02.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/import'
const EXPECTED_VERSION = 'payload-work-draft-plan-v0.2'
const EXPECTED_BATCH = 'payload-work-draft-plan-v02'

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

function hasText(value) {
  return val(value).length > 0
}

function hasSafeSlug(value) {
  const text = val(value)
  return text.length <= 200 && /^[\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}]$/u.test(text)
}

function rowIssues(row) {
  const issues = []
  const payload = row.payload || {}
  const safety = row.safety || {}
  const source = row.sourceEligibilityRow || {}

  if (row.version !== EXPECTED_VERSION) issues.push('unexpected_version')
  if (row.action !== 'create_payload_work_draft') issues.push('unexpected_action')
  if (row.collection !== 'works') issues.push('unexpected_collection')
  if (!hasText(row.planId)) issues.push('missing_plan_id')

  if (!hasText(payload.title)) issues.push('missing_title')
  if (!hasSafeSlug(payload.slug)) issues.push('invalid_slug')
  if (!/^catalog-[a-z0-9-]+$/u.test(val(payload.siteId))) issues.push('invalid_site_id')

  if (payload.status !== 'draft') issues.push('status_not_draft')
  if (payload.reviewStatus !== 'pending') issues.push('review_status_not_pending')
  if (payload.rank !== 'unknown') issues.push('rank_not_unknown')
  if (payload.importBatch !== EXPECTED_BATCH) issues.push('import_batch_unexpected')
  if (payload.ratingNotice !== 'ai_synthesized_pending_review') issues.push('rating_notice_unexpected')
  if (payload.evidenceStrength !== 'unassessed') issues.push('evidence_strength_not_unassessed')
  if (payload.isLiteVisible !== true) issues.push('lite_visibility_not_true')
  if (payload.isFullVisible !== false) issues.push('full_visibility_not_false')
  if (payload.hasEvidence !== false) issues.push('has_evidence_not_false')

  if (!hasText(payload.searchText)) issues.push('missing_search_text')
  if (!Array.isArray(payload.candidateSources) || payload.candidateSources.length !== 1) issues.push('candidate_sources_not_single')
  if (!Array.isArray(payload.sourceLinks)) issues.push('source_links_not_array')

  if (source.eligibility !== 'eligible_for_draft_plan') issues.push('source_not_eligible')
  if (!hasText(source.sourceName)) issues.push('missing_source_name')
  if (!hasText(source.sourceMediaType) || source.sourceMediaType === 'unknown') issues.push('unknown_source_media_type')

  if (safety.reviewOnly !== true) issues.push('safety_review_only_not_true')
  if (safety.applyAllowed !== false) issues.push('safety_apply_allowed_not_false')
  if (safety.payloadWriteAllowed !== false) issues.push('safety_payload_write_not_false')
  if (safety.postgresqlWriteAllowed !== false) issues.push('safety_postgresql_write_not_false')
  if (safety.importerActionAllowed !== false) issues.push('safety_importer_action_not_false')

  const noteText = [payload.sourceConflictNotes, payload.evidenceNote, payload.searchText].map(val).join('\n').toLowerCase()
  if (noteText.includes('final rating')) issues.push('wording_final_rating')
  if (noteText.includes('authoritative')) issues.push('wording_authoritative')

  return issues
}

function auditRows(rows) {
  const issueRows = []
  const byIssue = {}

  for (const row of rows) {
    const issues = rowIssues(row)
    if (!issues.length) continue
    issueRows.push({
      planId: val(row.planId),
      title: val(row.payload?.title),
      slug: val(row.payload?.slug),
      siteId: val(row.payload?.siteId),
      issues,
    })
    for (const issue of issues) byIssue[issue] = (byIssue[issue] || 0) + 1
  }

  return {
    issueRows,
    byIssue: Object.fromEntries(Object.entries(byIssue).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  }
}

function markdown(summary, samples) {
  return [
    '# Work Draft Plan Audit v0.2',
    '',
    'Read-only audit for refined local work draft plan rows.',
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
    `- readyForDryRunImporter: ${summary.readyForDryRunImporter}`,
    `- planRowsRead: ${summary.planRowsRead}`,
    `- planRowsFailed: ${summary.planRowsFailed}`,
    `- issueRows: ${summary.issueRows}`,
    `- duplicatePlanIds: ${summary.duplicatePlanIds}`,
    `- duplicateSiteIds: ${summary.duplicateSiteIds}`,
    `- duplicateSlugs: ${summary.duplicateSlugs}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    `- payloadWriteAllowedRows: ${summary.safety.payloadWriteAllowedRows}`,
    `- postgresqlWriteAllowedRows: ${summary.safety.postgresqlWriteAllowedRows}`,
    `- importerActionAllowedRows: ${summary.safety.importerActionAllowedRows}`,
    '',
    ...table('Rows by source', summary.bySource, 'Source'),
    ...table('Rows by media type', summary.byMediaType, 'Media Type'),
    ...table('Rows by issue', summary.byIssue, 'Issue'),
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
  const outDir = arg('out-dir', DEFAULT_OUT_DIR)

  if (!fs.existsSync(planPath)) throw new Error(`Plan rows file not found: ${planPath}`)

  const plan = await readJsonl(planPath)
  const rows = plan.rows
  const duplicatePlanIds = collectDuplicates(rows, (row) => row.planId)
  const duplicateSiteIds = collectDuplicates(rows, (row) => row.payload?.siteId)
  const duplicateSlugs = collectDuplicates(rows, (row) => row.payload?.slug)
  const audit = auditRows(rows)

  const applyAllowedRows = rows.filter((row) => row.safety?.applyAllowed === true).length
  const payloadWriteAllowedRows = rows.filter((row) => row.safety?.payloadWriteAllowed === true).length
  const postgresqlWriteAllowedRows = rows.filter((row) => row.safety?.postgresqlWriteAllowed === true).length
  const importerActionAllowedRows = rows.filter((row) => row.safety?.importerActionAllowed === true).length

  const blockers = []
  if (plan.failed) blockers.push(`plan_rows_failed_to_parse:${plan.failed}`)
  if (duplicatePlanIds.length) blockers.push(`duplicate_plan_ids:${duplicatePlanIds.length}`)
  if (duplicateSiteIds.length) blockers.push(`duplicate_site_ids:${duplicateSiteIds.length}`)
  if (duplicateSlugs.length) blockers.push(`duplicate_slugs:${duplicateSlugs.length}`)
  if (audit.issueRows.length) blockers.push(`issue_rows:${audit.issueRows.length}`)
  if (applyAllowedRows || payloadWriteAllowedRows || postgresqlWriteAllowedRows || importerActionAllowedRows) blockers.push('unsafe_permission_flags')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'work-draft-plan-audit-v0.2',
    readyForDryRunImporter: blockers.length === 0 && rows.length > 0,
    planRowsRead: plan.read,
    planRowsFailed: plan.failed,
    planRowsLoaded: rows.length,
    issueRows: audit.issueRows.length,
    duplicatePlanIds: duplicatePlanIds.length,
    duplicateSiteIds: duplicateSiteIds.length,
    duplicateSlugs: duplicateSlugs.length,
    bySource: countBy(rows, (row) => row.sourceEligibilityRow?.sourceName),
    byMediaType: countBy(rows, (row) => row.payload?.mediaType),
    byStatus: countBy(rows, (row) => row.payload?.status),
    byIssue: audit.byIssue,
    inputs: { plan: planPath },
    outputs: {
      json: path.join(outDir, 'work-draft-plan-audit-v02.json'),
      summary: path.join(outDir, 'work-draft-plan-audit-v02-summary.json'),
      md: path.join(outDir, 'work-draft-plan-audit-v02.md'),
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
    issueRows: audit.issueRows.slice(0, 40),
    duplicatePlanIds: duplicatePlanIds.slice(0, 40),
    duplicateSiteIds: duplicateSiteIds.slice(0, 40),
    duplicateSlugs: duplicateSlugs.slice(0, 40),
  }

  const report = { ok: blockers.length === 0, summary, blockers, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(summary.outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(summary.outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: report.ok, summary, blockers, outputs: summary.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
