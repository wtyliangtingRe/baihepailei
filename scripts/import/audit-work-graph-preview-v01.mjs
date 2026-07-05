#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_NODES = 'data_local/staging/work-graph/work-graph-v01.nodes.jsonl'
const DEFAULT_EDGES = 'data_local/staging/work-graph/work-graph-v01.edges.jsonl'
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

function isPureNumeric(value) {
  return /^\d+$/u.test(normalizeWhitespace(value))
}

function isTooShortParent(value) {
  const normalized = normalizeTitle(value)
  return normalized.length > 0 && normalized.length < 2
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

function compactNode(node) {
  return {
    nodeId: node.nodeId || '',
    nodeType: node.nodeType || '',
    label: node.label || node.sourceTitle || node.title || '',
    sourceRecordKey: node.sourceRecordKey || '',
    sourceName: node.sourceName || '',
    sourceId: node.sourceId || '',
    sourceTitle: node.sourceTitle || '',
    normalizedTitle: node.normalizedTitle || '',
    planAction: node.planAction || '',
    planReason: node.planReason || '',
    confidence: node.confidence || '',
    entityBoundary: node.entityBoundary || '',
    boundaryReason: node.boundaryReason || '',
    rawPath: node.rawPath || '',
  }
}

function compactEdge(edge) {
  return {
    edgeId: edge.edgeId || '',
    edgeType: edge.edgeType || '',
    sourceNodeId: edge.sourceNodeId || '',
    targetNodeId: edge.targetNodeId || '',
    confidence: edge.confidence || '',
    reviewOnly: Boolean(edge.reviewOnly),
    reason: edge.reason || '',
    sourceRecordKey: edge.sourceRecordKey || '',
    planAction: edge.planAction || '',
    planReason: edge.planReason || '',
  }
}

function pushSample(samples, key, value) {
  if (samples[key] && samples[key].length < SAMPLE_LIMIT) samples[key].push(value)
}

function isWorkflowArtifactNode(node) {
  return node.rawPath === 'payload/bgm-work-field-plan.json'
    && !asText(node.sourceTitle)
    && !asText(node.sourceId)
    && !asText(node.sourceUrl)
}

function countRows(rows, keyName) {
  const counts = {}
  for (const row of rows) inc(counts, row[keyName])
  return sortCountObject(counts)
}

function duplicateIds(rows, keyName) {
  const counts = new Map()
  for (const row of rows) {
    const key = asText(row[keyName])
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }))
}

function auditGraph({ nodes, edges, planRows, nodesRead, nodesFailed, edgesRead, edgesFailed, planRead, planFailed }) {
  const samples = {
    duplicateNodeIds: [],
    duplicateEdgeIds: [],
    missingEdgeSource: [],
    missingEdgeTarget: [],
    selfLoopEdges: [],
    invalidQuarantineNodes: [],
    invalidNeedsPayloadNodes: [],
    workflowArtifactNodes: [],
    noisyParentEdges: [],
    rejectedParentEdges: [],
    possibleDuplicateEdges: [],
    lowConfidenceNodes: [],
    childWithoutParentEdge: [],
    editionWithoutParentEdge: [],
  }

  const nodeIdDuplicates = duplicateIds(nodes, 'nodeId')
  const edgeIdDuplicates = duplicateIds(edges, 'edgeId')
  for (const item of nodeIdDuplicates) pushSample(samples, 'duplicateNodeIds', item)
  for (const item of edgeIdDuplicates) pushSample(samples, 'duplicateEdgeIds', item)

  const nodeIds = new Set(nodes.map((node) => node.nodeId).filter(Boolean))
  const outgoingByNode = new Map()
  for (const edge of edges) {
    if (!outgoingByNode.has(edge.sourceNodeId)) outgoingByNode.set(edge.sourceNodeId, [])
    outgoingByNode.get(edge.sourceNodeId).push(edge)
  }

  let missingEdgeSource = 0
  let missingEdgeTarget = 0
  let selfLoopEdges = 0
  let noisyParentEdges = 0
  let rejectedParentEdges = 0
  let possibleDuplicateEdges = 0

  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]))

  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      missingEdgeSource += 1
      pushSample(samples, 'missingEdgeSource', compactEdge(edge))
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      missingEdgeTarget += 1
      pushSample(samples, 'missingEdgeTarget', compactEdge(edge))
    }
    if (edge.sourceNodeId && edge.sourceNodeId === edge.targetNodeId) {
      selfLoopEdges += 1
      pushSample(samples, 'selfLoopEdges', compactEdge(edge))
    }

    const targetNode = nodeById.get(edge.targetNodeId)
    if ((edge.edgeType === 'candidate_child_of' || edge.edgeType === 'candidate_edition_of')
      && targetNode?.nodeType === 'parent_title_candidate') {
      const parentTitle = targetNode.normalizedTitle || targetNode.label
      if (isPureNumeric(parentTitle) || isTooShortParent(parentTitle)) {
        noisyParentEdges += 1
        pushSample(samples, 'noisyParentEdges', { edge: compactEdge(edge), targetNode: compactNode(targetNode) })
      }
    }

    const sourceNode = nodeById.get(edge.sourceNodeId)
    if ((edge.edgeType === 'candidate_child_of' || edge.edgeType === 'candidate_edition_of')
      && sourceNode?.parentTitleInferenceRejected) {
      rejectedParentEdges += 1
      pushSample(samples, 'rejectedParentEdges', { edge: compactEdge(edge), sourceNode: compactNode(sourceNode) })
    }

    if (edge.edgeType === 'possible_duplicate_of') {
      possibleDuplicateEdges += 1
      pushSample(samples, 'possibleDuplicateEdges', compactEdge(edge))
    }
  }

  let sourceRecordNodes = 0
  let invalidQuarantineNodes = 0
  let invalidNeedsPayloadNodes = 0
  let workflowArtifactNodes = 0
  let lowConfidenceNodes = 0
  let childWithoutParentEdge = 0
  let editionWithoutParentEdge = 0
  let rejectedParentCandidateNodes = 0

  for (const node of nodes) {
    if (node.nodeType === 'source_record') sourceRecordNodes += 1

    if (node.planAction === 'quarantine') {
      invalidQuarantineNodes += 1
      pushSample(samples, 'invalidQuarantineNodes', compactNode(node))
    }
    if (node.planAction === 'needs_payload_comparison') {
      invalidNeedsPayloadNodes += 1
      pushSample(samples, 'invalidNeedsPayloadNodes', compactNode(node))
    }
    if (isWorkflowArtifactNode(node)) {
      workflowArtifactNodes += 1
      pushSample(samples, 'workflowArtifactNodes', compactNode(node))
    }
    if (node.confidence === 'low') {
      lowConfidenceNodes += 1
      pushSample(samples, 'lowConfidenceNodes', compactNode(node))
    }
    if (node.parentTitleInferenceRejected) rejectedParentCandidateNodes += 1

    const outgoing = outgoingByNode.get(node.nodeId) || []
    if (node.nodeType === 'child_entity_candidate' && !outgoing.some((edge) => edge.edgeType === 'candidate_child_of')) {
      childWithoutParentEdge += 1
      pushSample(samples, 'childWithoutParentEdge', compactNode(node))
    }
    if (node.nodeType === 'edition_or_release_candidate' && !outgoing.some((edge) => edge.edgeType === 'candidate_edition_of')) {
      editionWithoutParentEdge += 1
      pushSample(samples, 'editionWithoutParentEdge', compactNode(node))
    }
  }

  const blockers = []
  const warnings = []

  if (nodesFailed > 0) blockers.push(`node JSONL parse failures: ${nodesFailed}`)
  if (edgesFailed > 0) blockers.push(`edge JSONL parse failures: ${edgesFailed}`)
  if (planFailed > 0) blockers.push(`plan JSONL parse failures: ${planFailed}`)
  if (nodeIdDuplicates.length > 0) blockers.push(`duplicate node IDs: ${nodeIdDuplicates.length}`)
  if (edgeIdDuplicates.length > 0) blockers.push(`duplicate edge IDs: ${edgeIdDuplicates.length}`)
  if (missingEdgeSource > 0) blockers.push(`edges with missing source node: ${missingEdgeSource}`)
  if (missingEdgeTarget > 0) blockers.push(`edges with missing target node: ${missingEdgeTarget}`)
  if (selfLoopEdges > 0) blockers.push(`self-loop edges: ${selfLoopEdges}`)
  if (invalidQuarantineNodes > 0) blockers.push(`quarantine nodes in accepted graph: ${invalidQuarantineNodes}`)
  if (invalidNeedsPayloadNodes > 0) blockers.push(`needs_payload_comparison nodes in accepted graph: ${invalidNeedsPayloadNodes}`)
  if (workflowArtifactNodes > 0) blockers.push(`workflow artifact nodes in graph: ${workflowArtifactNodes}`)
  if (noisyParentEdges > 0) blockers.push(`numeric or too-short parent edges remain: ${noisyParentEdges}`)
  if (sourceRecordNodes !== planRows.length) blockers.push(`sourceRecordNodes does not match plan rows: ${sourceRecordNodes} vs ${planRows.length}`)

  if (possibleDuplicateEdges > 0) warnings.push(`possible duplicate edges remain for review: ${possibleDuplicateEdges}`)
  if (lowConfidenceNodes > 0) warnings.push(`low confidence nodes remain: ${lowConfidenceNodes}`)
  if (childWithoutParentEdge > 0) warnings.push(`child candidate nodes without parent edge: ${childWithoutParentEdge}`)
  if (editionWithoutParentEdge > 0) warnings.push(`edition or release candidate nodes without parent edge: ${editionWithoutParentEdge}`)
  if (rejectedParentCandidateNodes > 0) warnings.push(`rejected parent candidate nodes preserved: ${rejectedParentCandidateNodes}`)

  return {
    readyForWorkGraphPreview: blockers.length === 0,
    blockers,
    warnings,
    riskCounts: {
      planRows: planRows.length,
      nodesRead,
      nodesFailed,
      edgesRead,
      edgesFailed,
      planRead,
      planFailed,
      sourceRecordNodes,
      duplicateNodeIds: nodeIdDuplicates.length,
      duplicateEdgeIds: edgeIdDuplicates.length,
      missingEdgeSource,
      missingEdgeTarget,
      selfLoopEdges,
      invalidQuarantineNodes,
      invalidNeedsPayloadNodes,
      workflowArtifactNodes,
      noisyParentEdges,
      rejectedParentEdges,
      possibleDuplicateEdges,
      lowConfidenceNodes,
      childWithoutParentEdge,
      editionWithoutParentEdge,
      rejectedParentCandidateNodes,
    },
    samples,
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

function formatRiskTable(riskCounts) {
  return [
    '## Risk counts',
    '',
    '| Risk | Count |',
    '|---|---:|',
    ...Object.entries(riskCounts || {}).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
  ]
}

function formatSamples(title, rows) {
  return [
    `## ${title}`,
    '',
    '```json',
    JSON.stringify(rows || [], null, 2),
    '```',
    '',
  ]
}

function formatMarkdown(report) {
  return [
    '# Work Graph Preview v0.1 Audit',
    '',
    '## Safety',
    '',
    '- Read-only graph audit.',
    '- No Payload read or write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- Generated files under `data_local` should not be committed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${report.summary.generatedAt}`,
    `- readyForWorkGraphPreview: ${report.analysis.readyForWorkGraphPreview}`,
    `- planRows: ${report.analysis.riskCounts.planRows}`,
    `- nodesRead: ${report.analysis.riskCounts.nodesRead}`,
    `- edgesRead: ${report.analysis.riskCounts.edgesRead}`,
    `- sourceRecordNodes: ${report.analysis.riskCounts.sourceRecordNodes}`,
    '',
    '## Blockers',
    '',
    ...(report.analysis.blockers.length ? report.analysis.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(report.analysis.warnings.length ? report.analysis.warnings.map((item) => `- ${item}`) : ['- none']),
    '',
    ...formatCountTable('Nodes by type', report.counts.nodesByType),
    ...formatCountTable('Edges by type', report.counts.edgesByType),
    ...formatRiskTable(report.analysis.riskCounts),
    ...formatSamples('Missing edge source samples', report.analysis.samples.missingEdgeSource),
    ...formatSamples('Missing edge target samples', report.analysis.samples.missingEdgeTarget),
    ...formatSamples('Noisy parent edge samples', report.analysis.samples.noisyParentEdges),
    ...formatSamples('Possible duplicate edge samples', report.analysis.samples.possibleDuplicateEdges),
    ...formatSamples('Child without parent samples', report.analysis.samples.childWithoutParentEdge),
    '## Next step',
    '',
    '- If there are no blockers, keep this graph preview as the current A2 graph output.',
    '- Continue to the graph review queue PR, where review-only graph issues become human-readable rows.',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const nodesPath = args.nodes || DEFAULT_NODES
  const edgesPath = args.edges || DEFAULT_EDGES
  const planPath = args.plan || DEFAULT_PLAN
  const outDir = args['out-dir'] || DEFAULT_OUT_DIR

  for (const filePath of [nodesPath, edgesPath, planPath]) {
    if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`)
  }

  console.error(`[work-graph-audit] reading nodes: ${nodesPath}`)
  const nodes = await readJsonl(nodesPath)
  console.error(`[work-graph-audit] reading edges: ${edgesPath}`)
  const edges = await readJsonl(edgesPath)
  console.error(`[work-graph-audit] reading plan: ${planPath}`)
  const plan = await readJsonl(planPath)

  const analysis = auditGraph({
    nodes: nodes.rows,
    edges: edges.rows,
    planRows: plan.rows,
    nodesRead: nodes.read,
    nodesFailed: nodes.failed,
    edgesRead: edges.read,
    edgesFailed: edges.failed,
    planRead: plan.read,
    planFailed: plan.failed,
  })

  const counts = {
    nodesByType: countRows(nodes.rows, 'nodeType'),
    edgesByType: countRows(edges.rows, 'edgeType'),
    edgesByReviewOnly: sortCountObject(edges.rows.reduce((acc, edge) => {
      inc(acc, edge.reviewOnly ? 'review_only' : 'not_review_only')
      return acc
    }, {})),
    nodesByPlanAction: countRows(nodes.rows, 'planAction'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'work-graph-preview-audit-v0.1',
    inputs: { nodes: nodesPath, edges: edgesPath, plan: planPath },
    counts,
    riskCounts: analysis.riskCounts,
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
    },
  }

  const report = {
    ok: true,
    summary,
    counts,
    analysis,
    outputs: {},
  }

  fs.mkdirSync(outDir, { recursive: true })
  const outJson = path.join(outDir, 'work-graph-v01-audit.json')
  const outSummary = path.join(outDir, 'work-graph-v01-audit-summary.json')
  const outMd = path.join(outDir, 'work-graph-v01-audit.md')

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify({
    summary,
    analysis: {
      readyForWorkGraphPreview: analysis.readyForWorkGraphPreview,
      blockers: analysis.blockers,
      warnings: analysis.warnings,
      riskCounts: analysis.riskCounts,
    },
  }, null, 2), 'utf8')
  fs.writeFileSync(outMd, formatMarkdown(report), 'utf8')

  report.outputs = { json: outJson, summary: outSummary, md: outMd }

  console.log(JSON.stringify({
    ok: true,
    readyForWorkGraphPreview: analysis.readyForWorkGraphPreview,
    blockers: analysis.blockers,
    warnings: analysis.warnings,
    riskCounts: analysis.riskCounts,
    outputs: report.outputs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
