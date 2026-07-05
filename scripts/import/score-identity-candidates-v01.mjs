#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'

const EVIDENCE = 'data_local/staging/identity/identity-evidence-v01.jsonl'
const OUT = 'data_local/staging/identity'
const MEMBER_SAMPLE_LIMIT = 50
const EVIDENCE_SAMPLE_LIMIT = 80

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

function uniq(values) {
  return [...new Set(values.filter((v) => val(v)).map((v) => val(v)))]
}

function scoreBand(score) {
  if (score >= 90) return '90-100'
  if (score >= 60) return '60-89'
  if (score >= 30) return '30-59'
  return '0-29'
}

function memberFromEvidence(row) {
  return {
    entityKey: val(row.entityKey),
    entityType: val(row.entityType),
    sourceRecordKey: val(row.sourceRecordKey),
    sourceName: val(row.sourceName),
    sourceId: val(row.sourceId),
    sourceUrl: val(row.sourceUrl),
    normalizedTitle: val(row.normalizedTitle),
    mediaType: val(row.mediaType),
    boundaryScope: val(row.boundaryScope),
  }
}

function dedupeMembers(members) {
  const seen = new Set()
  const out = []

  for (const member of members) {
    if (!member.entityKey || seen.has(member.entityKey)) continue
    seen.add(member.entityKey)
    out.push(member)
  }

  return out
}

function classify(score, conflictReasons, candidateType) {
  if (conflictReasons.length > 0) return 'identity_conflict'
  if (candidateType === 'title_match') return 'weak_title_only_candidate'
  if (score >= 90) return 'strong_match_candidate'
  if (score >= 60) return 'review_match_candidate'
  if (score >= 30) return 'weak_title_only_candidate'
  return 'review_match_candidate'
}

function makeCandidate({
  candidateType,
  groupKey,
  members,
  evidenceRefs,
  score,
  scoreReasons,
  conflictReasons = [],
  normalizedTitle = '',
}) {
  const uniqueMembers = dedupeMembers(members)
  const memberKeys = uniqueMembers.map((member) => member.entityKey)
  const mediaTypes = uniq(uniqueMembers.map((member) => member.mediaType))
  const sourceNames = uniq(uniqueMembers.map((member) => member.sourceName))
  const boundaryScopes = uniq(uniqueMembers.map((member) => member.boundaryScope))
  const groupId = `identity-group:${candidateType}:${hash(groupKey)}`
  const candidateId = `identity-candidate:${hash([candidateType, groupKey, memberKeys.join('|')].join('|'))}`
  const finalConflictReasons = [...conflictReasons]

  if (candidateType === 'title_match' && mediaTypes.length > 1) {
    finalConflictReasons.push('same title appears across multiple media types')
  }

  const safeScore = Math.max(0, Math.min(100, score))
  const candidateClass = classify(safeScore, finalConflictReasons, candidateType)

  return {
    candidateId,
    groupId,
    candidateType,
    candidateClass,
    score: safeScore,
    scoreBand: scoreBand(safeScore),
    scoreReasons,
    conflictReasons: finalConflictReasons,
    normalizedTitle,
    sourceNames,
    mediaTypes,
    boundaryScopes,
    memberCount: uniqueMembers.length,
    memberKeys,
    memberSamples: uniqueMembers.slice(0, MEMBER_SAMPLE_LIMIT),
    membersTruncated: uniqueMembers.length > MEMBER_SAMPLE_LIMIT,
    evidenceRefCount: evidenceRefs.length,
    evidenceRefs: evidenceRefs.slice(0, EVIDENCE_SAMPLE_LIMIT),
    evidenceRefsTruncated: evidenceRefs.length > EVIDENCE_SAMPLE_LIMIT,
    reviewOnly: true,
    applyAllowed: false,
  }
}

function addToMap(map, key, row) {
  if (!key) return
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(row)
}

function buildCandidates(evidence) {
  const byEntity = new Map()
  const bySourceId = new Map()
  const byTitleMedia = new Map()
  const graphRows = []

  for (const row of evidence) {
    addToMap(byEntity, row.entityKey, row)

    if (row.evidenceType === 'source_id') {
      addToMap(bySourceId, row.evidenceValue, row)
    }

    if (row.evidenceType === 'normalized_title' && val(row.evidenceValue)) {
      const key = `${row.evidenceValue}||${val(row.mediaType) || 'unknown'}`
      addToMap(byTitleMedia, key, row)
    }

    if (val(row.evidenceType).startsWith('graph_edge:')) {
      graphRows.push(row)
    }
  }

  const candidates = []

  for (const [sourceId, rows] of bySourceId.entries()) {
    const members = dedupeMembers(rows.map(memberFromEvidence))
    if (members.length < 2) continue

    const scopes = uniq(members.map((m) => m.boundaryScope))
    const conflictReasons = []
    const scoreReasons = ['same source namespace plus source id']

    let score = 85
    if (scopes.length > 1) {
      score = 75
      scoreReasons.push('multiple boundary scopes require review')
    }

    candidates.push(makeCandidate({
      candidateType: 'same_source_id',
      groupKey: sourceId,
      members,
      evidenceRefs: rows.map((row) => row.evidenceId),
      score,
      scoreReasons,
      conflictReasons,
    }))
  }

  for (const [titleKey, rows] of byTitleMedia.entries()) {
    const members = dedupeMembers(rows.map(memberFromEvidence))
    if (members.length < 2) continue

    const [title] = titleKey.split('||')
    const scoreReasons = ['normalized title match within media bucket']
    let score = 45
    const conflictReasons = []

    if (title.length <= 2) {
      score = 25
      conflictReasons.push('very short title')
    }

    candidates.push(makeCandidate({
      candidateType: 'title_match',
      groupKey: titleKey,
      members,
      evidenceRefs: rows.map((row) => row.evidenceId),
      score,
      scoreReasons,
      conflictReasons,
      normalizedTitle: title,
    }))
  }

  for (const row of graphRows) {
    const sourceRows = byEntity.get(row.sourceNodeId) || []
    const targetRows = byEntity.get(row.targetNodeId) || []
    const members = dedupeMembers([
      ...sourceRows.map(memberFromEvidence),
      ...targetRows.map(memberFromEvidence),
    ])

    if (members.length < 2) continue

    const edgeType = val(row.edgeType)
    const graphKey = `${edgeType}:${row.sourceNodeId}->${row.targetNodeId}`
    const conflictReasons = []
    const scoreReasons = [`graph edge ${edgeType}`]
    let score = 60
    let candidateType = 'graph_relation'

    if (edgeType === 'possible_duplicate_of') {
      candidateType = 'graph_possible_duplicate'
      score = 20
      conflictReasons.push('possible duplicate edge requires manual review')
    } else if (edgeType === 'linked_to_existing_work') {
      candidateType = 'graph_existing_work_link'
      score = 70
      scoreReasons.push('planner linked source to existing Work')
    } else if (edgeType === 'candidate_child_of' || edgeType === 'candidate_edition_of') {
      candidateType = 'boundary_relation'
      score = 50
      scoreReasons.push('boundary relation is not identity confirmation')
    }

    candidates.push(makeCandidate({
      candidateType,
      groupKey: graphKey,
      members,
      evidenceRefs: [row.evidenceId],
      score,
      scoreReasons,
      conflictReasons,
      normalizedTitle: val(row.normalizedTitle),
    }))
  }

  const seen = new Set()
  const deduped = []

  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) continue
    seen.add(candidate.candidateId)
    deduped.push(candidate)
  }

  deduped.sort((a, b) => {
    if (a.candidateClass !== b.candidateClass) return a.candidateClass.localeCompare(b.candidateClass)
    if (b.score !== a.score) return b.score - a.score
    return a.candidateId.localeCompare(b.candidateId)
  })

  return deduped
}

function buildGroups(candidates) {
  const byGroup = new Map()

  for (const candidate of candidates) {
    if (!byGroup.has(candidate.groupId)) {
      byGroup.set(candidate.groupId, {
        groupId: candidate.groupId,
        candidateType: candidate.candidateType,
        candidateIds: [],
        candidateClasses: [],
        memberKeys: [],
        bestScore: 0,
        conflictReasons: [],
        reviewOnly: true,
        applyAllowed: false,
      })
    }

    const group = byGroup.get(candidate.groupId)
    group.candidateIds.push(candidate.candidateId)
    group.candidateClasses.push(candidate.candidateClass)
    group.memberKeys.push(...candidate.memberKeys)
    group.bestScore = Math.max(group.bestScore, candidate.score)
    group.conflictReasons.push(...candidate.conflictReasons)
  }

  return [...byGroup.values()].map((group) => ({
    ...group,
    candidateIds: uniq(group.candidateIds),
    candidateClasses: uniq(group.candidateClasses),
    memberKeys: uniq(group.memberKeys),
    memberCount: uniq(group.memberKeys).length,
    conflictReasons: uniq(group.conflictReasons),
  }))
}

function mdReport(summary, samples) {
  return [
    '# Identity Match Candidates v0.1',
    '',
    'This is a read-only candidate scoring preview generated from the local identity evidence index.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No production change.',
    '- All candidates are review-only and `applyAllowed: false`.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- evidenceRowsRead: ${summary.inputs.evidenceRowsRead}`,
    `- candidateRows: ${summary.candidateRows}`,
    `- groupRows: ${summary.groupRows}`,
    `- applyAllowedRows: ${summary.safety.applyAllowedRows}`,
    '',
    '## By candidate class',
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(summary.byCandidateClass).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## By candidate type',
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(summary.byCandidateType).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## By score band',
    '',
    '| Key | Count |',
    '|---|---:|',
    ...Object.entries(summary.byScoreBand).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
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
  const evidencePath = arg('evidence', EVIDENCE)
  const outDir = arg('out-dir', OUT)

  if (!fs.existsSync(evidencePath)) {
    throw new Error(`Input file not found: ${evidencePath}`)
  }

  const evidence = await readJsonl(evidencePath)
  const candidates = buildCandidates(evidence.rows)
  const groups = buildGroups(candidates)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'identity-match-candidates-v0.1',
    candidateRows: candidates.length,
    groupRows: groups.length,
    byCandidateClass: countBy(candidates, 'candidateClass'),
    byCandidateType: countBy(candidates, 'candidateType'),
    byScoreBand: countBy(candidates, 'scoreBand'),
    byReviewOnly: countBy(candidates, 'reviewOnly'),
    inputs: {
      evidence: evidencePath,
      evidenceRowsRead: evidence.read,
      evidenceRowsFailed: evidence.failed,
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: candidates.filter((row) => row.applyAllowed).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outCandidates = path.join(outDir, 'identity-match-candidates-v01.jsonl')
  const outGroups = path.join(outDir, 'identity-match-groups-v01.jsonl')
  const outJson = path.join(outDir, 'identity-match-candidates-v01.json')
  const outSummary = path.join(outDir, 'identity-match-candidates-v01-summary.json')
  const outMd = path.join(outDir, 'identity-match-candidates-v01.md')

  fs.writeFileSync(
    outCandidates,
    candidates.map((row) => JSON.stringify(row)).join('\n') + (candidates.length ? '\n' : ''),
    'utf8',
  )

  fs.writeFileSync(
    outGroups,
    groups.map((row) => JSON.stringify(row)).join('\n') + (groups.length ? '\n' : ''),
    'utf8',
  )

  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, candidates, groups }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, mdReport(summary, candidates.slice(0, 30)), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      candidates: outCandidates,
      groups: outGroups,
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
