#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'

const PLAN = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl'
const NODES = 'data_local/staging/work-graph/work-graph-v01.nodes.jsonl'
const EDGES = 'data_local/staging/work-graph/work-graph-v01.edges.jsonl'
const OUT = 'data_local/staging/identity'

function val(x) {
  return String(x ?? '').trim()
}

function sha(x) {
  return crypto.createHash('sha1').update(String(x)).digest('hex').slice(0, 16)
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
    const s = line.trim()
    if (!s) continue
    try {
      rows.push(JSON.parse(s))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const k = val(row[key]) || 'missing'
    out[k] = (out[k] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function mdCell(x) {
  return String(x ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function scope(node) {
  const type = val(node.nodeType)
  if (type === 'work_candidate' || type === 'existing_work') return 'work'
  if (type === 'child_entity_candidate') return 'child'
  if (type === 'edition_or_release_candidate') return 'edition_or_release'
  if (type === 'source_record') return 'source_record'
  if (type === 'parent_title_candidate') return 'parent_title'
  return type || 'unknown'
}

function makeEvidence(node, evidenceType, evidenceValue, evidenceLevel, reason, extra = {}) {
  const entityKey = val(node.nodeId)
  const key = [entityKey, evidenceType, evidenceValue, reason].join('|')

  return {
    evidenceId: `identity-evidence:${sha(key)}`,
    entityKey,
    entityType: val(node.nodeType),
    sourceRecordKey: val(node.sourceRecordKey),
    sourceName: val(node.sourceName),
    sourceId: val(node.sourceId),
    sourceUrl: val(node.sourceUrl),
    normalizedTitle: val(node.normalizedTitle),
    mediaType: val(node.sourceMediaType || node.mediaType),
    evidenceType,
    evidenceValue: val(evidenceValue),
    evidenceLevel,
    boundaryScope: scope(node),
    reason: val(reason),
    reviewOnly: true,
    applyAllowed: false,
    ...extra,
  }
}

function nodeEvidence(node) {
  const rows = []

  if (val(node.sourceName) && val(node.sourceId)) {
    rows.push(makeEvidence(
      node,
      'source_id',
      `${node.sourceName}:${node.sourceId}`,
      'strong',
      'source namespace plus source id',
    ))
  }

  if (val(node.sourceUrl)) {
    rows.push(makeEvidence(node, 'source_url', node.sourceUrl, 'medium', 'source url'))
  }

  if (val(node.normalizedTitle)) {
    rows.push(makeEvidence(node, 'normalized_title', node.normalizedTitle, 'weak', 'title evidence'))
  }

  if (val(node.sourceMediaType || node.mediaType)) {
    rows.push(makeEvidence(
      node,
      'media_type',
      node.sourceMediaType || node.mediaType,
      'medium',
      'media type evidence',
    ))
  }

  if (val(node.entityBoundary || node.nodeType)) {
    rows.push(makeEvidence(
      node,
      'boundary_signal',
      node.entityBoundary || node.nodeType,
      'medium',
      node.boundaryReason || 'entity boundary signal',
    ))
  }

  if (val(node.planAction)) {
    rows.push(makeEvidence(
      node,
      'planner_action',
      node.planAction,
      'medium',
      node.planReason || 'planner action',
    ))
  }

  if (val(node.parentCandidateTitle)) {
    rows.push(makeEvidence(
      node,
      'parent_candidate_title',
      node.parentCandidateTitle,
      'weak',
      'parent candidate title',
    ))
  }

  if (val(node.nodeType) === 'existing_work') {
    const payloadId = val(node.payloadId || node.workId || node.id || node.nodeId)
    rows.push(makeEvidence(node, 'payload_work_ref', payloadId, 'strong', 'existing Payload Work reference'))
  }

  return rows
}

function edgeLevel(edge) {
  const type = val(edge.edgeType)
  if (type === 'possible_duplicate_of') return 'conflict'
  if (type === 'linked_to_existing_work') return 'medium'
  if (type === 'candidate_child_of') return 'medium'
  if (type === 'candidate_edition_of') return 'medium'
  if (val(edge.confidence) === 'low') return 'weak'
  return 'medium'
}

function edgeEvidence(edge, nodeById) {
  const target = nodeById.get(edge.targetNodeId)
  const source = nodeById.get(edge.sourceNodeId)
  const holder = target || source
  if (!holder) return []

  return [makeEvidence(
    holder,
    `graph_edge:${edge.edgeType}`,
    `${edge.sourceNodeId}->${edge.targetNodeId}`,
    edgeLevel(edge),
    edge.reason || edge.planReason || 'graph edge',
    {
      edgeId: val(edge.edgeId),
      edgeType: val(edge.edgeType),
      sourceNodeId: val(edge.sourceNodeId),
      targetNodeId: val(edge.targetNodeId),
      edgeReviewOnly: Boolean(edge.reviewOnly),
      edgeConfidence: val(edge.confidence),
    },
  )]
}

function dedupe(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (seen.has(row.evidenceId)) continue
    seen.add(row.evidenceId)
    out.push(row)
  }
  return out
}

function mdReport(summary, samples) {
  return [
    '# Identity Evidence Index v0.1',
    '',
    'This is a read-only local evidence index for later candidate scoring.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No production change.',
    '- All rows are review-only and `applyAllowed: false`.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- evidenceRows: ${summary.evidenceRows}`,
    `- planRowsRead: ${summary.inputs.planRowsRead}`,
    `- nodesRead: ${summary.inputs.nodesRead}`,
    `- edgesRead: ${summary.inputs.edgesRead}`,
    '',
    '## Evidence by level',
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(summary.byEvidenceLevel).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## Evidence by type',
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(summary.byEvidenceType).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const planPath = arg('plan', PLAN)
  const nodesPath = arg('nodes', NODES)
  const edgesPath = arg('edges', EDGES)
  const outDir = arg('out-dir', OUT)

  for (const file of [planPath, nodesPath, edgesPath]) {
    if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  }

  const plan = await readJsonl(planPath)
  const nodes = await readJsonl(nodesPath)
  const edges = await readJsonl(edgesPath)
  const nodeById = new Map(nodes.rows.map((node) => [node.nodeId, node]))

  const evidence = dedupe([
    ...nodes.rows.flatMap(nodeEvidence),
    ...edges.rows.flatMap((edge) => edgeEvidence(edge, nodeById)),
  ])

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'identity-evidence-v0.1',
    evidenceRows: evidence.length,
    byEvidenceType: countBy(evidence, 'evidenceType'),
    byEvidenceLevel: countBy(evidence, 'evidenceLevel'),
    byEntityType: countBy(evidence, 'entityType'),
    byBoundaryScope: countBy(evidence, 'boundaryScope'),
    bySource: countBy(evidence, 'sourceName'),
    inputs: {
      plan: planPath,
      nodes: nodesPath,
      edges: edgesPath,
      planRowsRead: plan.read,
      planRowsFailed: plan.failed,
      nodesRead: nodes.read,
      nodesFailed: nodes.failed,
      edgesRead: edges.read,
      edgesFailed: edges.failed,
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: evidence.filter((row) => row.applyAllowed).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, 'identity-evidence-v01.jsonl')
  const outJson = path.join(outDir, 'identity-evidence-v01.json')
  const outSummary = path.join(outDir, 'identity-evidence-v01-summary.json')
  const outMd = path.join(outDir, 'identity-evidence-v01.md')

  fs.writeFileSync(outJsonl, evidence.map((row) => JSON.stringify(row)).join('\n') + (evidence.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, evidence }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, mdReport(summary, evidence.slice(0, 40)), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      jsonl: outJsonl,
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
