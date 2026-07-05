#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"

const DEFAULT_NODES = "data_local/staging/work-graph/work-graph-v01.nodes.jsonl"
const DEFAULT_EDGES = "data_local/staging/work-graph/work-graph-v01.edges.jsonl"
const DEFAULT_AUDIT = "data_local/staging/work-graph/work-graph-v01-audit-summary.json"
const DEFAULT_OUT_DIR = "data_local/staging/work-graph"
const LOW_SAMPLE_LIMIT = 80

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function readJsonl(filePath) {
  const rows = []
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  })

  let read = 0
  let failed = 0

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function text(value) {
  return String(value ?? "").trim()
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = text(row[key]) || "missing"
    out[value] = (out[value] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function csvCell(value) {
  const body = String(value ?? "")
  return /[",\n\r]/u.test(body) ? `"${body.replace(/"/gu, '""')}"` : body
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, " ")
}

function makeRow({
  priority,
  issueType,
  issueKey,
  node,
  targetNodeIds = [],
  targetLabels = [],
  issueReason,
  suggestedAction,
}) {
  return {
    queueId: `work-graph:${issueType}:${issueKey}`,
    priority,
    issueType,
    title: node?.label || node?.sourceTitle || node?.title || "",
    normalizedTitle: node?.normalizedTitle || "",
    sourceRecordKey: node?.sourceRecordKey || "",
    sourceName: node?.sourceName || "",
    sourceId: node?.sourceId || "",
    sourceUrl: node?.sourceUrl || "",
    sourceNodeId: node?.nodeId || "",
    targetNodeIds,
    targetLabels,
    confidence: node?.confidence || "",
    planAction: node?.planAction || "",
    planReason: node?.planReason || "",
    entityBoundary: node?.entityBoundary || "",
    boundaryReason: node?.boundaryReason || "",
    issueReason,
    suggestedAction,
    applyAllowed: false,
    reviewOnly: true,
  }
}

function buildQueue(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]))
  const outgoingByNode = new Map()

  for (const edge of edges) {
    if (!outgoingByNode.has(edge.sourceNodeId)) outgoingByNode.set(edge.sourceNodeId, [])
    outgoingByNode.get(edge.sourceNodeId).push(edge)
  }

  const rows = []

  const dupGroups = new Map()
  for (const edge of edges.filter((edge) => edge.edgeType === "possible_duplicate_of")) {
    if (!dupGroups.has(edge.sourceNodeId)) dupGroups.set(edge.sourceNodeId, [])
    dupGroups.get(edge.sourceNodeId).push(edge)
  }

  for (const [sourceNodeId, groupEdges] of dupGroups.entries()) {
    const sourceNode = nodeById.get(sourceNodeId)
    const targetNodes = groupEdges.map((edge) => nodeById.get(edge.targetNodeId)).filter(Boolean)

    rows.push(makeRow({
      priority: "P1",
      issueType: "possible_duplicate_identity",
      issueKey: sourceNodeId,
      node: sourceNode,
      targetNodeIds: targetNodes.map((node) => node.nodeId),
      targetLabels: targetNodes.map((node) => node.label || node.title || node.nodeId),
      issueReason: `Source row has ${targetNodes.length} possible duplicate existing Work targets.`,
      suggestedAction: "Manual identity review. Do not merge or link by title only.",
    }))
  }

  for (const node of nodes.filter((node) => node.nodeType === "child_entity_candidate")) {
    const hasParent = (outgoingByNode.get(node.nodeId) || []).some((edge) => edge.edgeType === "candidate_child_of")
    if (hasParent) continue

    rows.push(makeRow({
      priority: node.parentTitleInferenceRejected ? "P2" : "P3",
      issueType: node.parentTitleInferenceRejected ? "rejected_parent_child_candidate" : "child_without_parent",
      issueKey: node.nodeId,
      node,
      issueReason: node.parentTitleInferenceRejected
        ? `Parent candidate rejected: ${node.parentTitleInferenceRejectedReason || "unknown"}`
        : "Child candidate has no candidate_child_of edge.",
      suggestedAction: "Keep as child candidate. Review parent relation before structured import.",
    }))
  }

  for (const node of nodes.filter((node) => node.nodeType === "edition_or_release_candidate")) {
    const hasParent = (outgoingByNode.get(node.nodeId) || []).some((edge) => edge.edgeType === "candidate_edition_of")
    if (hasParent) continue

    rows.push(makeRow({
      priority: "P2",
      issueType: "edition_or_release_without_parent",
      issueKey: node.nodeId,
      node,
      issueReason: "Edition or release candidate has no candidate_edition_of edge.",
      suggestedAction: "Keep as edition/release candidate. Review parent Work before structured import.",
    }))
  }

  const alreadyQueued = new Set(rows.map((row) => row.sourceNodeId).filter(Boolean))
  const lowConfidence = nodes
    .filter((node) => node.confidence === "low" && !alreadyQueued.has(node.nodeId))
    .slice(0, LOW_SAMPLE_LIMIT)

  for (const node of lowConfidence) {
    rows.push(makeRow({
      priority: "P3",
      issueType: "low_confidence_sample",
      issueKey: node.nodeId,
      node,
      issueReason: "Low-confidence graph node sample for spot checking.",
      suggestedAction: "Spot check only. Do not block graph preview if no structural blocker exists.",
    }))
  }

  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 }
  rows.sort((a, b) => {
    const d = (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99)
    if (d !== 0) return d
    if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType)
    return a.queueId.localeCompare(b.queueId)
  })

  return rows
}

function writeCsv(filePath, rows) {
  const headers = [
    "queueId",
    "priority",
    "issueType",
    "title",
    "normalizedTitle",
    "sourceRecordKey",
    "sourceName",
    "sourceId",
    "sourceUrl",
    "confidence",
    "planAction",
    "planReason",
    "issueReason",
    "suggestedAction",
    "applyAllowed",
    "reviewOnly",
  ]

  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(","))
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8")
}

function countTable(title, data) {
  return [
    `## ${title}`,
    "",
    "| Key | Count |",
    "|---|---:|",
    ...Object.entries(data || {}).map(([key, value]) => `| ${mdCell(key)} | ${value} |`),
    "",
  ]
}

function writeMarkdown(filePath, summary, rows) {
  const lines = [
    "# Work Graph Review Queue v0.1",
    "",
    "This queue converts review-only Work Graph warnings into human-readable rows.",
    "",
    "## Safety",
    "",
    "- Read-only local graph input.",
    "- No Payload read or write.",
    "- No PostgreSQL write.",
    "- No importer action.",
    "- All rows are review-only and `applyAllowed: false`.",
    "",
    "## Summary",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- queueRows: ${summary.queueRows}`,
    `- auditReadyForWorkGraphPreview: ${summary.auditReadyForWorkGraphPreview}`,
    "",
    "## Audit blockers carried forward",
    "",
    ...(summary.auditBlockers.length ? summary.auditBlockers.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Audit warnings carried forward",
    "",
    ...(summary.auditWarnings.length ? summary.auditWarnings.map((item) => `- ${item}`) : ["- none"]),
    "",
    ...countTable("By priority", summary.byPriority),
    ...countTable("By issue type", summary.byIssueType),
    ...countTable("By source", summary.bySource),
    "## Queue samples",
    "",
    "| Priority | Issue | Title | Source | Suggested action |",
    "|---|---|---|---|---|",
    ...rows.slice(0, 80).map((row) => {
      const source = row.sourceName ? `${row.sourceName}:${row.sourceId}` : row.sourceRecordKey
      return `| ${mdCell(row.priority)} | ${mdCell(row.issueType)} | ${mdCell(row.title)} | ${mdCell(source)} | ${mdCell(row.suggestedAction)} |`
    }),
    "",
  ]

  fs.writeFileSync(filePath, lines.join("\n"), "utf8")
}

async function main() {
  const nodesPath = arg("nodes", DEFAULT_NODES)
  const edgesPath = arg("edges", DEFAULT_EDGES)
  const auditPath = arg("audit", DEFAULT_AUDIT)
  const outDir = arg("out-dir", DEFAULT_OUT_DIR)

  for (const filePath of [nodesPath, edgesPath, auditPath]) {
    if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`)
  }

  const nodes = await readJsonl(nodesPath)
  const edges = await readJsonl(edgesPath)
  const audit = readJson(auditPath)
  const rows = buildQueue(nodes.rows, edges.rows)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: "work-graph-review-queue-v0.1",
    queueRows: rows.length,
    byPriority: countBy(rows, "priority"),
    byIssueType: countBy(rows, "issueType"),
    bySource: countBy(rows, "sourceName"),
    auditReadyForWorkGraphPreview: Boolean(audit?.analysis?.readyForWorkGraphPreview),
    auditBlockers: audit?.analysis?.blockers || [],
    auditWarnings: audit?.analysis?.warnings || [],
    inputs: {
      nodes: nodesPath,
      edges: edgesPath,
      audit: auditPath,
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
      applyAllowedRows: rows.filter((row) => row.applyAllowed).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, "work-graph-review-queue-v01.jsonl")
  const outJson = path.join(outDir, "work-graph-review-queue-v01.json")
  const outSummary = path.join(outDir, "work-graph-review-queue-v01-summary.json")
  const outCsv = path.join(outDir, "work-graph-review-queue-v01.csv")
  const outMd = path.join(outDir, "work-graph-review-queue-v01.md")

  fs.writeFileSync(outJsonl, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8")
  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, rows }, null, 2), "utf8")
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), "utf8")
  writeCsv(outCsv, rows)
  writeMarkdown(outMd, summary, rows)

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      jsonl: outJsonl,
      json: outJson,
      summary: outSummary,
      csv: outCsv,
      md: outMd,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
