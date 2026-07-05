#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const NODES = 'data_local/staging/work-graph/work-graph-v01.nodes.jsonl'
const EDGES = 'data_local/staging/work-graph/work-graph-v01.edges.jsonl'
const WORK_GRAPH_AUDIT = 'data_local/staging/work-graph/work-graph-v01-audit-summary.json'
const IDENTITY_AUDIT = 'data_local/staging/identity/identity-match-candidates-v01-audit-summary.json'
const IDENTITY_TITLE_NOISE_AUDIT = 'data_local/staging/identity/identity-title-noise-audit-v01-summary.json'
const COMBINED_REVIEW_SUMMARY = 'data_local/staging/review/combined-review-queue-v01-summary.json'
const OUT = 'data_local/staging/import'

function val(value) {
  return String(value ?? '').trim()
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
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

function readJsonIfExists(file, fallback = null) {
  if (!file || !fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = val(row[key]) || 'missing'
    out[value] = (out[value] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function countByPair(rows, leftKey, rightKey) {
  const out = {}
  for (const row of rows) {
    const left = val(row[leftKey]) || 'missing'
    const right = val(row[rightKey]) || 'missing'
    const key = `${left} / ${right}`
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function countReasons(rows) {
  const out = {}
  for (const row of rows) {
    const reasons = Array.isArray(row.eligibilityReasons) ? row.eligibilityReasons : []
    for (const reason of reasons) {
      const key = val(reason) || 'missing'
      out[key] = (out[key] || 0) + 1
    }
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function asBool(value) {
  return value === true || value === 'true'
}

function hasUsableText(value) {
  return /[\p{L}\p{N}]/u.test(val(value))
}

function titleQualityReasons(node) {
  const title = val(node.sourceTitle || node.label)
  const normalizedTitle = val(node.normalizedTitle)
  const reasons = []

  if (!title) reasons.push('missing_title')
  if (!normalizedTitle) reasons.push('title_quality_missing_normalized_title')
  else if (!hasUsableText(normalizedTitle)) reasons.push('title_quality_punctuation_only_normalized_title')

  return reasons
}

function compactNode(node) {
  return {
    nodeId: val(node.nodeId),
    nodeType: val(node.nodeType),
    title: val(node.sourceTitle || node.label || node.normalizedTitle),
    normalizedTitle: val(node.normalizedTitle),
    sourceName: val(node.sourceName),
    sourceId: val(node.sourceId),
    sourceUrl: val(node.sourceUrl),
    sourceRecordKey: val(node.sourceRecordKey),
    sourceMediaType: val(node.sourceMediaType),
    eligibilityStatus: val(node.eligibilityStatus),
    planAction: val(node.planAction),
    planReason: val(node.planReason),
    confidence: val(node.confidence),
    entityBoundary: val(node.entityBoundary),
    boundaryReason: val(node.boundaryReason),
    reviewOnly: asBool(node.reviewOnly),
  }
}

function indexEdges(edges) {
  const bySource = new Map()
  const byTarget = new Map()

  for (const edge of edges) {
    const source = val(edge.sourceNodeId)
    const target = val(edge.targetNodeId)
    if (source) {
      if (!bySource.has(source)) bySource.set(source, [])
      bySource.get(source).push(edge)
    }
    if (target) {
      if (!byTarget.has(target)) byTarget.set(target, [])
      byTarget.get(target).push(edge)
    }
  }

  return { bySource, byTarget }
}

function edgesForNode(edgeIndex, nodeId) {
  return [
    ...(edgeIndex.bySource.get(nodeId) || []),
    ...(edgeIndex.byTarget.get(nodeId) || []),
  ]
}

function hasEdgeType(edges, edgeType) {
  return edges.some((edge) => edge.edgeType === edgeType)
}

function unique(values) {
  return [...new Set(values.map((value) => val(value)).filter(Boolean))]
}

function classifyWorkCandidate(node, edges) {
  const reasons = []
  const blockers = []
  const warnings = []
  const titleReasons = titleQualityReasons(node)

  const mediaType = val(node.sourceMediaType)
  const action = val(node.planAction)
  const confidence = val(node.confidence)
  const reviewOnly = asBool(node.reviewOnly)

  const duplicateEdge = hasEdgeType(edges, 'possible_duplicate_of')
  const linkedExistingEdge = hasEdgeType(edges, 'linked_to_existing_work')
  const childEdge = hasEdgeType(edges, 'candidate_child_of')
  const editionEdge = hasEdgeType(edges, 'candidate_edition_of')

  if (titleReasons.includes('missing_title')) blockers.push('missing_title')
  for (const reason of titleReasons.filter((reason) => reason !== 'missing_title')) warnings.push(reason)

  if (!mediaType) warnings.push('missing_source_media_type')
  if (mediaType === 'unknown') warnings.push('unknown_source_media_type')
  if (!val(node.sourceRecordKey) && !val(node.sourceId)) blockers.push('missing_source_identity')
  if (duplicateEdge) blockers.push('possible_duplicate_edge')
  if (linkedExistingEdge) blockers.push('already_linked_to_existing_work')
  if (childEdge) blockers.push('child_or_parent_relation_candidate')
  if (editionEdge) blockers.push('edition_or_release_relation_candidate')

  if (reviewOnly) warnings.push('review_only_candidate')
  if (action !== 'create_new_work') warnings.push(`non_auto_create_action:${action || 'missing'}`)
  if (!confidence) warnings.push('missing_confidence')
  if (confidence === 'low') warnings.push('low_confidence')

  if (blockers.includes('already_linked_to_existing_work')) {
    return { eligibility: 'existing_work_linked', reasons: [...blockers, ...warnings] }
  }

  if (blockers.length > 0) {
    return { eligibility: 'blocked', reasons: [...blockers, ...warnings] }
  }

  if (warnings.length > 0) {
    return { eligibility: 'needs_review', reasons: warnings }
  }

  reasons.push('work_candidate_create_new_work')
  reasons.push('no_duplicate_or_existing_work_edge')
  reasons.push('has_usable_title_media_and_source_identity')
  return { eligibility: 'eligible_for_draft_plan', reasons }
}

function classifyNonWorkNode(node) {
  if (node.nodeType === 'existing_work') return 'existing_work_node'
  if (node.nodeType === 'child_entity_candidate') return 'relation_candidate_needs_review'
  if (node.nodeType === 'edition_or_release_candidate') return 'relation_candidate_needs_review'
  if (node.nodeType === 'parent_title_candidate') return 'parent_title_candidate_needs_review'
  if (node.nodeType === 'source_record') return 'source_record_only'
  return 'unsupported_node_type'
}

function buildEligibilityRows(nodes, edges) {
  const edgeIndex = indexEdges(edges)
  const rows = []

  for (const node of nodes) {
    if (node.nodeType !== 'work_candidate') continue

    const relatedEdges = edgesForNode(edgeIndex, node.nodeId)
    const result = classifyWorkCandidate(node, relatedEdges)
    const relatedEdgeTypes = unique(relatedEdges.map((edge) => edge.edgeType))

    rows.push({
      ...compactNode(node),
      eligibility: result.eligibility,
      eligibilityReasons: result.reasons,
      relatedEdgeTypes,
      relatedEdgeCount: relatedEdges.length,
      reviewOnly: asBool(node.reviewOnly),
      importPlanAllowed: false,
      payloadWriteAllowed: false,
    })
  }

  return rows.sort((a, b) => {
    if (a.eligibility !== b.eligibility) return a.eligibility.localeCompare(b.eligibility)
    if (a.sourceName !== b.sourceName) return a.sourceName.localeCompare(b.sourceName)
    return (a.title || a.normalizedTitle).localeCompare(b.title || b.normalizedTitle)
  })
}

function summarizeOtherNodes(nodes) {
  return countBy(nodes.filter((node) => node.nodeType !== 'work_candidate').map((node) => ({
    bucket: classifyNonWorkNode(node),
  })), 'bucket')
}

function buildNotInDraftPlan(summaryCounts, rows) {
  const needsReviewRows = rows.filter((row) => row.eligibility === 'needs_review').length
  const blockedRows = rows.filter((row) => row.eligibility === 'blocked').length
  const existingWorkLinkedRows = rows.filter((row) => row.eligibility === 'existing_work_linked').length

  return {
    work_candidate_needs_review: needsReviewRows,
    work_candidate_blocked: blockedRows,
    work_candidate_existing_work_linked: existingWorkLinkedRows,
    ...summaryCounts,
  }
}

function optionalAuditStatus(summary) {
  if (!summary) return { present: false }
  return {
    present: true,
    readyForHumanReview: summary.readyForHumanReview,
    readyForCombinedReviewQueue: summary.readyForCombinedReviewQueue,
    blockers: summary.blockers ?? null,
    warnings: summary.warnings ?? null,
    safety: summary.safety || null,
    riskCounts: summary.riskCounts || null,
  }
}

function sampleRows(rows, eligibility, limit = 40) {
  return rows.filter((row) => row.eligibility === eligibility).slice(0, limit)
}

function formatCountTable(title, entries, keyLabel = 'Key') {
  return [
    `## ${title}`,
    '',
    `| ${keyLabel} | Count |`,
    '|---|---:|',
    ...Object.entries(entries || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function markdown(summary, samples) {
  return [
    '# Catalog Import Eligibility Audit v0.1',
    '',
    'This is a read-only audit for deciding which Work Graph candidates can move into a future draft import plan.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No draft import plan is produced by this script.',
    '- Every row has `importPlanAllowed: false` and `payloadWriteAllowed: false`.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForDraftPlanBuild: ${summary.readyForDraftPlanBuild}`,
    `- workCandidateRows: ${summary.workCandidateRows}`,
    `- eligibleForDraftPlan: ${summary.eligibleForDraftPlan}`,
    `- needsReview: ${summary.needsReview}`,
    `- blocked: ${summary.blocked}`,
    `- existingWorkLinked: ${summary.existingWorkLinked}`,
    `- titleQualityIssueRows: ${summary.titleQualityIssueRows}`,
    `- unknownMediaTypeRows: ${summary.unknownMediaTypeRows}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    `- payloadWriteAllowedRows: ${summary.safety.payloadWriteAllowedRows}`,
    '',
    ...formatCountTable('By eligibility', summary.byEligibility, 'Eligibility'),
    ...formatCountTable('By eligibility and source', summary.byEligibilityAndSource, 'Eligibility / Source'),
    ...formatCountTable('By eligibility and media type', summary.byEligibilityAndMediaType, 'Eligibility / Media Type'),
    ...formatCountTable('By plan action', summary.byPlanAction, 'Plan Action'),
    ...formatCountTable('By source', summary.bySource, 'Source'),
    ...formatCountTable('By eligibility reason', summary.byEligibilityReason, 'Reason'),
    ...formatCountTable('Not in draft plan', summary.notInDraftPlan, 'Bucket'),
    '## Eligible samples',
    '',
    samples.eligible.length ? JSON.stringify(samples.eligible, null, 2) : '- none',
    '',
    '## Needs review samples',
    '',
    samples.needsReview.length ? JSON.stringify(samples.needsReview, null, 2) : '- none',
    '',
    '## Blocked samples',
    '',
    samples.blocked.length ? JSON.stringify(samples.blocked, null, 2) : '- none',
    '',
    '## Existing work linked samples',
    '',
    samples.existingWorkLinked.length ? JSON.stringify(samples.existingWorkLinked, null, 2) : '- none',
    '',
    '## Next step',
    '',
    '- Review this audit summary locally.',
    '- If counts look right, build a separate Payload Work draft import plan from `eligible_for_draft_plan` rows only.',
    '- Keep relation candidates, duplicates, existing-work links, unknown-media rows, title-quality rows, and review-only rows out of the first draft import plan.',
    '',
  ].join('\n')
}

async function main() {
  const nodesPath = arg('nodes', NODES)
  const edgesPath = arg('edges', EDGES)
  const outDir = arg('out-dir', OUT)
  const workGraphAuditPath = arg('work-graph-audit', WORK_GRAPH_AUDIT)
  const identityAuditPath = arg('identity-audit', IDENTITY_AUDIT)
  const titleNoiseAuditPath = arg('title-noise-audit', IDENTITY_TITLE_NOISE_AUDIT)
  const combinedReviewSummaryPath = arg('combined-review-summary', COMBINED_REVIEW_SUMMARY)

  for (const file of [nodesPath, edgesPath]) {
    if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  }

  const nodes = await readJsonl(nodesPath)
  const edges = await readJsonl(edgesPath)

  const workGraphAudit = readJsonIfExists(workGraphAuditPath)
  const identityAudit = readJsonIfExists(identityAuditPath)
  const titleNoiseAudit = readJsonIfExists(titleNoiseAuditPath)
  const combinedReviewSummary = readJsonIfExists(combinedReviewSummaryPath)

  const rows = buildEligibilityRows(nodes.rows, edges.rows)
  const eligible = rows.filter((row) => row.eligibility === 'eligible_for_draft_plan')
  const needsReview = rows.filter((row) => row.eligibility === 'needs_review')
  const blocked = rows.filter((row) => row.eligibility === 'blocked')
  const existingWorkLinked = rows.filter((row) => row.eligibility === 'existing_work_linked')
  const otherNodeBuckets = summarizeOtherNodes(nodes.rows)

  const payloadWriteAllowedRows = rows.filter((row) => row.payloadWriteAllowed === true).length
  const importPlanAllowedRows = rows.filter((row) => row.importPlanAllowed === true).length

  const titleQualityIssueRows = rows.filter((row) => (
    Array.isArray(row.eligibilityReasons)
    && row.eligibilityReasons.some((reason) => val(reason).startsWith('title_quality_'))
  )).length

  const unknownMediaTypeRows = rows.filter((row) => row.sourceMediaType === 'unknown').length

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'catalog-import-eligibility-audit-v0.1',
    readyForDraftPlanBuild: payloadWriteAllowedRows === 0 && importPlanAllowedRows === 0 && eligible.length > 0,
    workCandidateRows: rows.length,
    eligibleForDraftPlan: eligible.length,
    needsReview: needsReview.length,
    blocked: blocked.length,
    existingWorkLinked: existingWorkLinked.length,
    titleQualityIssueRows,
    unknownMediaTypeRows,
    byEligibility: countBy(rows, 'eligibility'),
    byEligibilityAndSource: countByPair(rows, 'eligibility', 'sourceName'),
    byEligibilityAndMediaType: countByPair(rows, 'eligibility', 'sourceMediaType'),
    byPlanAction: countBy(rows, 'planAction'),
    bySource: countBy(rows, 'sourceName'),
    byConfidence: countBy(rows, 'confidence'),
    byMediaType: countBy(rows, 'sourceMediaType'),
    byEligibilityReason: countReasons(rows),
    otherNodeBuckets,
    notInDraftPlan: buildNotInDraftPlan(otherNodeBuckets, rows),
    inputs: {
      nodes: nodesPath,
      edges: edgesPath,
      nodesRead: nodes.read,
      nodesFailed: nodes.failed,
      edgesRead: edges.read,
      edgesFailed: edges.failed,
      workGraphAudit: workGraphAuditPath,
      identityAudit: identityAuditPath,
      titleNoiseAudit: titleNoiseAuditPath,
      combinedReviewSummary: combinedReviewSummaryPath,
    },
    upstreamStatus: {
      workGraphAudit: optionalAuditStatus(workGraphAudit),
      identityAudit: optionalAuditStatus(identityAudit),
      titleNoiseAudit: optionalAuditStatus(titleNoiseAudit),
      combinedReviewSummary: optionalAuditStatus(combinedReviewSummary),
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      importPlanAllowedRows,
      payloadWriteAllowedRows,
      applyAllowedRows: 0,
    },
  }

  const samples = {
    eligible: sampleRows(rows, 'eligible_for_draft_plan'),
    needsReview: sampleRows(rows, 'needs_review'),
    blocked: sampleRows(rows, 'blocked'),
    existingWorkLinked: sampleRows(rows, 'existing_work_linked'),
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, 'catalog-import-eligibility-v01.rows.jsonl')
  const outJson = path.join(outDir, 'catalog-import-eligibility-v01.json')
  const outSummary = path.join(outDir, 'catalog-import-eligibility-v01-summary.json')
  const outMd = path.join(outDir, 'catalog-import-eligibility-v01.md')

  fs.writeFileSync(outJsonl, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, samples, rows }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      rows: outJsonl,
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
