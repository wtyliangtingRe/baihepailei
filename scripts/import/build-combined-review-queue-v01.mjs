#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'

const WORK_QUEUE = 'data_local/staging/work-graph/work-graph-review-queue-v01.jsonl'
const IDENTITY_CANDIDATES = 'data_local/staging/identity/identity-match-candidates-v01.jsonl'
const IDENTITY_AUDIT_SUMMARY = 'data_local/staging/identity/identity-match-candidates-v01-audit-summary.json'
const OUT = 'data_local/staging/review'

const TITLE_MATCH_SAMPLE_LIMIT = 500
const GRAPH_EXISTING_WORK_LINK_LIMIT = 500

function val(x) {
  return String(x ?? '').trim()
}

function hash(x) {
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

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback
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

function mdCell(x) {
  return String(x ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function csvCell(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/u.test(text)) return `"${text.replace(/"/gu, '""')}"`
  return text
}

function toCsv(rows) {
  const columns = [
    'combinedQueueId',
    'queueSource',
    'priority',
    'issueType',
    'title',
    'normalizedTitle',
    'sourceName',
    'sourceId',
    'candidateClass',
    'candidateType',
    'score',
    'memberCount',
    'reviewReason',
    'suggestedAction',
    'reviewOnly',
    'applyAllowed',
  ]

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n')
}

function asList(values) {
  if (!Array.isArray(values)) return []
  return values.map((value) => val(value)).filter(Boolean)
}

function memberTitle(candidate) {
  const sample = Array.isArray(candidate.memberSamples) ? candidate.memberSamples.find((member) => val(member.normalizedTitle)) : null
  return val(candidate.normalizedTitle || sample?.normalizedTitle)
}

function memberSourceName(candidate) {
  const sample = Array.isArray(candidate.memberSamples) ? candidate.memberSamples.find((member) => val(member.sourceName)) : null
  const sourceNames = asList(candidate.sourceNames)
  return val(sourceNames[0] || sample?.sourceName)
}

function memberSourceId(candidate) {
  const sample = Array.isArray(candidate.memberSamples) ? candidate.memberSamples.find((member) => val(member.sourceId)) : null
  return val(sample?.sourceId)
}

function identityPriority(candidate) {
  if (candidate.candidateType === 'graph_possible_duplicate') return 'P1'
  if (candidate.candidateClass === 'identity_conflict') return 'P1'
  if (candidate.candidateType === 'boundary_relation') return 'P2'
  if (candidate.candidateType === 'graph_existing_work_link') return 'P3'
  if (candidate.candidateType === 'title_match') return 'P3'
  return 'P3'
}

function identityIssueType(candidate) {
  if (candidate.candidateType === 'graph_possible_duplicate') return 'identity_possible_duplicate'
  if (candidate.candidateClass === 'identity_conflict') return 'identity_conflict'
  if (candidate.candidateType === 'boundary_relation') return 'identity_boundary_relation'
  if (candidate.candidateType === 'graph_existing_work_link') return 'identity_existing_work_link_review'
  if (candidate.candidateType === 'title_match') return 'identity_title_match_sample'
  return `identity_${candidate.candidateType || 'candidate_review'}`
}

function identitySuggestedAction(candidate) {
  if (candidate.candidateType === 'graph_possible_duplicate') return 'Review possible duplicate identity manually; do not merge by title only.'
  if (candidate.candidateClass === 'identity_conflict') return 'Review conflict evidence manually; keep all source rows visible.'
  if (candidate.candidateType === 'boundary_relation') return 'Review boundary relation; do not treat child or edition relation as identity confirmation.'
  if (candidate.candidateType === 'graph_existing_work_link') return 'Spot-check existing Work link evidence before any future apply step.'
  if (candidate.candidateType === 'title_match') return 'Review title match as weak evidence only.'
  return 'Review identity candidate manually.'
}

function identityReason(candidate) {
  const scoreReasons = asList(candidate.scoreReasons).join('; ')
  const conflicts = asList(candidate.conflictReasons).join('; ')
  return [scoreReasons, conflicts].filter(Boolean).join(' | ')
}

function fromWorkGraph(row) {
  return {
    combinedQueueId: `combined:work-graph:${row.queueId || hash(JSON.stringify(row))}`,
    queueSource: 'work_graph',
    priority: val(row.priority || 'P3'),
    issueType: val(row.issueType || 'work_graph_review'),
    title: val(row.title || row.normalizedTitle),
    normalizedTitle: val(row.normalizedTitle),
    sourceName: val(row.sourceName),
    sourceId: val(row.sourceId),
    sourceUrl: val(row.sourceUrl),
    sourceRecordKey: val(row.sourceRecordKey),
    sourceNodeId: val(row.sourceNodeId),
    targetNodeIds: Array.isArray(row.targetNodeIds) ? row.targetNodeIds : [],
    candidateId: '',
    groupId: '',
    candidateClass: '',
    candidateType: '',
    score: '',
    memberCount: '',
    memberKeys: [],
    reviewReason: val(row.issueReason || row.planReason || row.boundaryReason || row.planAction),
    suggestedAction: val(row.suggestedAction || 'Review work graph issue manually.'),
    originalPriority: val(row.priority),
    originalIssueType: val(row.issueType),
    reviewOnly: true,
    applyAllowed: false,
  }
}

function fromIdentityCandidate(candidate) {
  return {
    combinedQueueId: `combined:identity:${candidate.candidateId || hash(JSON.stringify(candidate))}`,
    queueSource: 'identity',
    priority: identityPriority(candidate),
    issueType: identityIssueType(candidate),
    title: memberTitle(candidate),
    normalizedTitle: val(candidate.normalizedTitle || memberTitle(candidate)),
    sourceName: memberSourceName(candidate),
    sourceId: memberSourceId(candidate),
    sourceUrl: '',
    sourceRecordKey: '',
    sourceNodeId: '',
    targetNodeIds: [],
    candidateId: val(candidate.candidateId),
    groupId: val(candidate.groupId),
    candidateClass: val(candidate.candidateClass),
    candidateType: val(candidate.candidateType),
    score: candidate.score,
    memberCount: candidate.memberCount,
    memberKeys: Array.isArray(candidate.memberKeys) ? candidate.memberKeys : [],
    evidenceRefs: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [],
    reviewReason: identityReason(candidate),
    suggestedAction: identitySuggestedAction(candidate),
    originalPriority: '',
    originalIssueType: val(candidate.candidateType),
    reviewOnly: true,
    applyAllowed: false,
  }
}

function pickIdentityCandidates(candidates) {
  const rows = []
  let titleMatches = 0
  let existingLinks = 0

  for (const candidate of candidates) {
    if (candidate.candidateType === 'graph_possible_duplicate') {
      rows.push(candidate)
      continue
    }

    if (candidate.candidateClass === 'identity_conflict') {
      rows.push(candidate)
      continue
    }

    if (candidate.candidateType === 'boundary_relation') {
      rows.push(candidate)
      continue
    }

    if (candidate.candidateType === 'graph_existing_work_link') {
      if (existingLinks < GRAPH_EXISTING_WORK_LINK_LIMIT) {
        rows.push(candidate)
        existingLinks += 1
      }
      continue
    }

    if (candidate.candidateType === 'title_match') {
      if (titleMatches < TITLE_MATCH_SAMPLE_LIMIT) {
        rows.push(candidate)
        titleMatches += 1
      }
    }
  }

  return rows
}

function priorityRank(priority) {
  if (priority === 'P1') return 1
  if (priority === 'P2') return 2
  if (priority === 'P3') return 3
  return 9
}

function markdown(summary, rows) {
  const topRows = rows.slice(0, 80)

  return [
    '# Combined Review Queue v0.1',
    '',
    'This queue combines Work Graph review rows with selected identity review candidates.',
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
    `- combinedRows: ${summary.combinedRows}`,
    `- workGraphRowsIncluded: ${summary.workGraphRowsIncluded}`,
    `- identityRowsIncluded: ${summary.identityRowsIncluded}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    `- readyForHumanReview: ${summary.readyForHumanReview}`,
    '',
    '## By priority',
    '',
    '| Priority | Count |',
    '|---|---:|',
    ...Object.entries(summary.byPriority).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## By source',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.byQueueSource).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## By issue type',
    '',
    '| Issue Type | Count |',
    '|---|---:|',
    ...Object.entries(summary.byIssueType).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## Top rows',
    '',
    '| Priority | Source | Issue Type | Title | Suggested Action |',
    '|---|---|---|---|---|',
    ...topRows.map((row) => `| ${mdCell(row.priority)} | ${mdCell(row.queueSource)} | ${mdCell(row.issueType)} | ${mdCell(row.title || row.normalizedTitle)} | ${mdCell(row.suggestedAction)} |`),
    '',
  ].join('\n')
}

async function main() {
  const workQueuePath = arg('work-queue', WORK_QUEUE)
  const identityCandidatesPath = arg('identity-candidates', IDENTITY_CANDIDATES)
  const identityAuditSummaryPath = arg('identity-audit-summary', IDENTITY_AUDIT_SUMMARY)
  const outDir = arg('out-dir', OUT)

  for (const file of [workQueuePath, identityCandidatesPath, identityAuditSummaryPath]) {
    if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  }

  const workQueue = await readJsonl(workQueuePath)
  const identityCandidates = await readJsonl(identityCandidatesPath)
  const identityAuditSummary = readJson(identityAuditSummaryPath, {})

  const workRows = workQueue.rows.map(fromWorkGraph)
  const pickedIdentityCandidates = pickIdentityCandidates(identityCandidates.rows)
  const identityRows = pickedIdentityCandidates.map(fromIdentityCandidate)

  const combined = [...workRows, ...identityRows]
    .sort((a, b) => {
      const p = priorityRank(a.priority) - priorityRank(b.priority)
      if (p !== 0) return p
      if (a.queueSource !== b.queueSource) return a.queueSource.localeCompare(b.queueSource)
      if (a.issueType !== b.issueType) return a.issueType.localeCompare(b.issueType)
      return (a.title || a.normalizedTitle).localeCompare(b.title || b.normalizedTitle)
    })

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'combined-review-queue-v0.1',
    readyForHumanReview: true,
    combinedRows: combined.length,
    workGraphRowsIncluded: workRows.length,
    identityRowsIncluded: identityRows.length,
    byPriority: countBy(combined, 'priority'),
    byQueueSource: countBy(combined, 'queueSource'),
    byIssueType: countBy(combined, 'issueType'),
    inputs: {
      workQueue: workQueuePath,
      identityCandidates: identityCandidatesPath,
      identityAuditSummary: identityAuditSummaryPath,
      workQueueRowsRead: workQueue.read,
      workQueueRowsFailed: workQueue.failed,
      identityCandidateRowsRead: identityCandidates.read,
      identityCandidateRowsFailed: identityCandidates.failed,
      identityAuditReadyForCombinedReviewQueue: Boolean(identityAuditSummary.readyForCombinedReviewQueue),
      identityAuditBlockers: identityAuditSummary.blockers ?? null,
      identityAuditWarnings: identityAuditSummary.warnings ?? null,
    },
    sampling: {
      identityTitleMatchSampleLimit: TITLE_MATCH_SAMPLE_LIMIT,
      identityGraphExistingWorkLinkLimit: GRAPH_EXISTING_WORK_LINK_LIMIT,
      identityConflictIncluded: true,
      identityBoundaryRelationIncluded: true,
      identityPossibleDuplicateIncluded: true,
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: combined.filter((row) => row.applyAllowed).length,
      notReviewOnlyRows: combined.filter((row) => row.reviewOnly !== true).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJsonl = path.join(outDir, 'combined-review-queue-v01.jsonl')
  const outJson = path.join(outDir, 'combined-review-queue-v01.json')
  const outSummary = path.join(outDir, 'combined-review-queue-v01-summary.json')
  const outCsv = path.join(outDir, 'combined-review-queue-v01.csv')
  const outMd = path.join(outDir, 'combined-review-queue-v01.md')

  fs.writeFileSync(outJsonl, combined.map((row) => JSON.stringify(row)).join('\n') + (combined.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, rows: combined }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outCsv, toCsv(combined) + '\n', 'utf8')
  fs.writeFileSync(outMd, markdown(summary, combined), 'utf8')

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
