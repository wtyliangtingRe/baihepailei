#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PLAN = 'data_local/staging/full-catalog-ingestion/full-catalog-ingestion-plan-v04.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-graph'
const SAMPLE_LIMIT = 80

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function asText(value) {
  return String(value ?? '').trim()
}

function normalizeWhitespace(value) {
  return asText(value).replace(/\s+/gu, ' ')
}

function normalizeTitle(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u3000\s]+/gu, ' ')
    .replace(/[「」『』【】\[\]（）()〈〉《》]/gu, '')
    .replace(/[,:;，。！？!?.·・~〜ー—–_\-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
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

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

async function readJsonl(filePath) {
  const rows = []
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let read = 0
  let failed = 0

  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue
    try {
      rows.push(JSON.parse(text))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function sourceNodeId(row) {
  return `source:${row.sourceName || 'unknown'}:${row.sourceRecordKey || row.sourceId || row.rowKey || 'missing'}`
}

function workCandidateNodeId(row) {
  return `work-candidate:${row.sourceRecordKey || row.sourceName + ':' + row.sourceId}`
}

function childCandidateNodeId(row) {
  return `child-candidate:${row.sourceRecordKey || row.sourceName + ':' + row.sourceId}`
}

function editionCandidateNodeId(row) {
  return `edition-release-candidate:${row.sourceRecordKey || row.sourceName + ':' + row.sourceId}`
}

function existingWorkNodeId(work) {
  return `payload-work:${work?.id || work?.siteId || work?.slug || 'missing'}`
}

function parentCandidateNodeId(row) {
  const normalized = row.parentCandidateNormalizedTitle || normalizeTitle(row.parentCandidateTitle)
  return `parent-title-candidate:${normalized || 'missing'}`
}

function edgeId(edgeType, source, target, suffix = '') {
  return `edge:${edgeType}:${source}->${target}${suffix ? ':' + suffix : ''}`
}

function baseSourceFields(row) {
  return {
    sourceRecordKey: row.sourceRecordKey || '',
    sourceName: row.sourceName || '',
    sourceId: row.sourceId || '',
    sourceUrl: row.sourceUrl || '',
    sourceTitle: row.sourceTitle || '',
    normalizedTitle: row.normalizedTitle || normalizeTitle(row.sourceTitle),
    sourceMediaType: row.sourceMediaType || '',
    eligibilityStatus: row.eligibilityStatus || '',
    rawPath: row.rawPath || '',
  }
}

function makeSourceRecordNode(row) {
  return {
    nodeId: sourceNodeId(row),
    nodeType: 'source_record',
    label: row.sourceTitle || row.sourceRecordKey || row.sourceId || '',
    ...baseSourceFields(row),
    planAction: row.action || '',
    planReason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
  }
}

function makeWorkCandidateNode(row) {
  return {
    nodeId: workCandidateNodeId(row),
    nodeType: 'work_candidate',
    label: row.sourceTitle || row.sourceRecordKey || '',
    ...baseSourceFields(row),
    planAction: row.action || '',
    planReason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    reviewOnly: row.action === 'create_new_work_needs_review',
  }
}

function makeChildCandidateNode(row) {
  return {
    nodeId: childCandidateNodeId(row),
    nodeType: 'child_entity_candidate',
    label: row.sourceTitle || row.sourceRecordKey || '',
    ...baseSourceFields(row),
    planAction: row.action || '',
    planReason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    parentCandidateTitle: row.parentCandidateTitle || '',
    parentCandidateNormalizedTitle: row.parentCandidateNormalizedTitle || '',
    rejectedParentCandidateTitle: row.rejectedParentCandidateTitle || '',
    parentTitleInferenceRejected: Boolean(row.parentTitleInferenceRejected),
    parentTitleInferenceRejectedReason: row.parentTitleInferenceRejectedReason || '',
    reviewOnly: true,
  }
}

function makeEditionCandidateNode(row) {
  return {
    nodeId: editionCandidateNodeId(row),
    nodeType: 'edition_or_release_candidate',
    label: row.sourceTitle || row.sourceRecordKey || '',
    ...baseSourceFields(row),
    planAction: row.action || '',
    planReason: row.reason || '',
    confidence: row.confidence || '',
    entityBoundary: row.entityBoundary || '',
    boundaryReason: row.boundaryReason || '',
    parentCandidateTitle: row.parentCandidateTitle || '',
    parentCandidateNormalizedTitle: row.parentCandidateNormalizedTitle || '',
    reviewOnly: true,
  }
}

function makeExistingWorkNode(work) {
  return {
    nodeId: existingWorkNodeId(work),
    nodeType: 'existing_work',
    label: work?.title || work?.siteId || work?.slug || String(work?.id || ''),
    payloadId: work?.id || '',
    siteId: work?.siteId || '',
    slug: work?.slug || '',
    title: work?.title || '',
    normalizedTitle: work?.normalizedTitle || normalizeTitle(work?.title),
    reviewOnly: false,
  }
}

function makeParentTitleCandidateNode(row) {
  return {
    nodeId: parentCandidateNodeId(row),
    nodeType: 'parent_title_candidate',
    label: row.parentCandidateTitle || row.parentCandidateNormalizedTitle || '',
    normalizedTitle: row.parentCandidateNormalizedTitle || normalizeTitle(row.parentCandidateTitle),
    reviewOnly: true,
  }
}

function addNode(nodes, node) {
  if (!node?.nodeId) return
  if (!nodes.has(node.nodeId)) nodes.set(node.nodeId, node)
}

function addEdge(edges, edge) {
  if (!edge?.edgeId) return
  if (!edges.has(edge.edgeId)) edges.set(edge.edgeId, edge)
}

function makeEdge(edgeType, source, target, fields = {}) {
  return {
    edgeId: edgeId(edgeType, source, target, fields.suffix || ''),
    edgeType,
    sourceNodeId: source,
    targetNodeId: target,
    confidence: fields.confidence || '',
    reviewOnly: Boolean(fields.reviewOnly),
    reason: fields.reason || '',
    sourceRecordKey: fields.sourceRecordKey || '',
    planAction: fields.planAction || '',
    planReason: fields.planReason || '',
  }
}

function getMatchedWorks(row) {
  return Array.isArray(row.matchedWorks) ? row.matchedWorks.filter(Boolean) : []
}

function graphCandidateNodeForRow(row) {
  if (row.action === 'create_new_work' || row.action === 'create_new_work_needs_review') {
    return makeWorkCandidateNode(row)
  }
  if (row.action === 'create_child_entity_needs_policy' || row.action === 'link_to_parent_work_candidate') {
    return makeChildCandidateNode(row)
  }
  if (row.action === 'create_volume_or_edition_needs_policy') {
    return makeEditionCandidateNode(row)
  }
  return null
}

function buildGraph(rows) {
  const nodes = new Map()
  const edges = new Map()
  const samples = {
    sourceRecord: [],
    workCandidate: [],
    childCandidate: [],
    editionCandidate: [],
    existingWork: [],
    duplicateCandidate: [],
    parentCandidate: [],
  }

  const pushSample = (key, value) => {
    if (samples[key] && samples[key].length < SAMPLE_LIMIT) samples[key].push(value)
  }

  for (const row of rows) {
    const sourceNode = makeSourceRecordNode(row)
    addNode(nodes, sourceNode)
    pushSample('sourceRecord', sourceNode)

    const candidateNode = graphCandidateNodeForRow(row)
    if (candidateNode) {
      addNode(nodes, candidateNode)
      if (candidateNode.nodeType === 'work_candidate') pushSample('workCandidate', candidateNode)
      if (candidateNode.nodeType === 'child_entity_candidate') pushSample('childCandidate', candidateNode)
      if (candidateNode.nodeType === 'edition_or_release_candidate') pushSample('editionCandidate', candidateNode)
      addEdge(edges, makeEdge('evidence_for_candidate', sourceNode.nodeId, candidateNode.nodeId, {
        confidence: row.confidence,
        reviewOnly: candidateNode.reviewOnly,
        reason: 'source_record_evidence_for_candidate',
        sourceRecordKey: row.sourceRecordKey,
        planAction: row.action,
        planReason: row.reason,
      }))
    }

    const matchedWorks = getMatchedWorks(row)
    matchedWorks.forEach((work, index) => {
      const workNode = makeExistingWorkNode(work)
      addNode(nodes, workNode)
      pushSample('existingWork', workNode)

      if (row.action === 'link_existing_work_exact_title') {
        addEdge(edges, makeEdge('linked_to_existing_work', sourceNode.nodeId, workNode.nodeId, {
          suffix: String(index),
          confidence: row.confidence || 'medium',
          reviewOnly: false,
          reason: 'exact_normalized_title_match',
          sourceRecordKey: row.sourceRecordKey,
          planAction: row.action,
          planReason: row.reason,
        }))
      }

      if (row.action === 'possible_duplicate_title') {
        addEdge(edges, makeEdge('possible_duplicate_of', sourceNode.nodeId, workNode.nodeId, {
          suffix: String(index),
          confidence: row.confidence || 'low',
          reviewOnly: true,
          reason: 'normalized_title_matches_multiple_works',
          sourceRecordKey: row.sourceRecordKey,
          planAction: row.action,
          planReason: row.reason,
        }))
        pushSample('duplicateCandidate', { source: sourceNode, target: workNode })
      }

      if (row.action === 'link_to_parent_work_candidate' && candidateNode) {
        addEdge(edges, makeEdge('candidate_child_of', candidateNode.nodeId, workNode.nodeId, {
          suffix: String(index),
          confidence: row.confidence || 'medium',
          reviewOnly: true,
          reason: 'volume_like_row_parent_title_matches_existing_work',
          sourceRecordKey: row.sourceRecordKey,
          planAction: row.action,
          planReason: row.reason,
        }))
      }
    })

    if (candidateNode && row.parentCandidateTitle && !row.parentTitleInferenceRejected) {
      const parentNode = makeParentTitleCandidateNode(row)
      addNode(nodes, parentNode)
      pushSample('parentCandidate', parentNode)
      const parentEdgeType = candidateNode.nodeType === 'edition_or_release_candidate'
        ? 'candidate_edition_of'
        : 'candidate_child_of'
      addEdge(edges, makeEdge(parentEdgeType, candidateNode.nodeId, parentNode.nodeId, {
        confidence: row.confidence || 'low',
        reviewOnly: true,
        reason: 'parent_title_candidate_from_planner',
        sourceRecordKey: row.sourceRecordKey,
        planAction: row.action,
        planReason: row.reason,
      }))
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], samples }
}

function summarizeGraph(planRows, graph) {
  const byAction = {}
  const byReason = {}
  const bySource = {}
  const byConfidence = {}
  const byEntityBoundary = {}
  const byNodeType = {}
  const byEdgeType = {}
  const byEdgeReviewOnly = {}

  for (const row of planRows) {
    inc(byAction, row.action)
    inc(byReason, row.reason)
    inc(bySource, row.sourceName)
    inc(byConfidence, row.confidence)
    inc(byEntityBoundary, row.entityBoundary)
  }

  for (const node of graph.nodes) inc(byNodeType, node.nodeType)
  for (const edge of graph.edges) {
    inc(byEdgeType, edge.edgeType)
    inc(byEdgeReviewOnly, edge.reviewOnly ? 'review_only' : 'not_review_only')
  }

  return {
    planRows: planRows.length,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    byAction: sortCountObject(byAction),
    byReason: sortCountObject(byReason),
    bySource: sortCountObject(bySource),
    byConfidence: sortCountObject(byConfidence),
    byEntityBoundary: sortCountObject(byEntityBoundary),
    byNodeType: sortCountObject(byNodeType),
    byEdgeType: sortCountObject(byEdgeType),
    byEdgeReviewOnly: sortCountObject(byEdgeReviewOnly),
    sourceRecordNodes: graph.nodes.filter((node) => node.nodeType === 'source_record').length,
    workCandidateNodes: graph.nodes.filter((node) => node.nodeType === 'work_candidate').length,
    childCandidateNodes: graph.nodes.filter((node) => node.nodeType === 'child_entity_candidate').length,
    editionOrReleaseCandidateNodes: graph.nodes.filter((node) => node.nodeType === 'edition_or_release_candidate').length,
    existingWorkNodes: graph.nodes.filter((node) => node.nodeType === 'existing_work').length,
    parentTitleCandidateNodes: graph.nodes.filter((node) => node.nodeType === 'parent_title_candidate').length,
  }
}

function formatCountTable(title, entries) {
  return [
    `## ${title}`,
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(entries || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function formatMarkdown(report) {
  return [
    '# Work Graph Preview v0.1',
    '',
    'This is a local preview graph generated from the Payload-checked v0.4 full-catalog dry-run plan.',
    '',
    '## Safety',
    '',
    '- Read-only input scan.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- planRowsRead: ${report.summary.planRowsRead}`,
    `- planRowsFailed: ${report.summary.planRowsFailed}`,
    `- graphNodes: ${report.summary.graph.nodes}`,
    `- graphEdges: ${report.summary.graph.edges}`,
    `- sourceRecordNodes: ${report.summary.graph.sourceRecordNodes}`,
    `- workCandidateNodes: ${report.summary.graph.workCandidateNodes}`,
    `- childCandidateNodes: ${report.summary.graph.childCandidateNodes}`,
    `- editionOrReleaseCandidateNodes: ${report.summary.graph.editionOrReleaseCandidateNodes}`,
    `- existingWorkNodes: ${report.summary.graph.existingWorkNodes}`,
    '',
    ...formatCountTable('Plan rows by action', report.summary.graph.byAction),
    ...formatCountTable('Nodes by type', report.summary.graph.byNodeType),
    ...formatCountTable('Edges by type', report.summary.graph.byEdgeType),
    ...formatCountTable('Edges by review mode', report.summary.graph.byEdgeReviewOnly),
    '## Samples',
    '',
    '```json',
    JSON.stringify(report.samples, null, 2),
    '```',
    '',
    '## Next step',
    '',
    '- Run a graph audit to verify node IDs, edge IDs, missing endpoints, source row representation, and noisy parent edges.',
    '- Continue treating duplicate title and weak parent relations as review-only.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const planPath = args.plan || DEFAULT_PLAN
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  if (!fs.existsSync(planPath)) throw new Error(`v04 plan file not found: ${planPath}`)

  console.error(`[work-graph] reading v04 plan: ${planPath}`)
  const plan = await readJsonl(planPath)
  const graph = buildGraph(plan.rows)
  const graphSummary = summarizeGraph(plan.rows, graph)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'work-graph-preview-v0.1',
    input: planPath,
    planRowsRead: plan.read,
    planRowsFailed: plan.failed,
    graph: graphSummary,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      delete: false,
    },
  }

  const report = {
    ok: true,
    summary,
    samples: graph.samples,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outNodes = path.join(outDir, 'work-graph-v01.nodes.jsonl')
  const outEdges = path.join(outDir, 'work-graph-v01.edges.jsonl')
  const outSummary = path.join(outDir, 'work-graph-v01-summary.json')
  const outJson = path.join(outDir, 'work-graph-v01.json')
  const outMd = path.join(outDir, 'work-graph-v01.md')

  fs.writeFileSync(outNodes, graph.nodes.map((node) => JSON.stringify(node)).join('\n') + (graph.nodes.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outEdges, graph.edges.map((edge) => JSON.stringify(edge)).join('\n') + (graph.edges.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ...report, nodes: graph.nodes, edges: graph.edges }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = {
    nodes: outNodes,
    edges: outEdges,
    summary: outSummary,
    json: outJson,
    md: outMd,
  }

  console.log(JSON.stringify({ ok: true, summary, outputs: report.outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
