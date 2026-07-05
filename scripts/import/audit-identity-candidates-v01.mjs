#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const CANDIDATES = 'data_local/staging/identity/identity-match-candidates-v01.jsonl'
const GROUPS = 'data_local/staging/identity/identity-match-groups-v01.jsonl'
const OUT = 'data_local/staging/identity'

function val(x) {
  return String(x ?? '').trim()
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

function isSourceToOwnCandidate(candidate) {
  const members = Array.isArray(candidate.memberSamples) ? candidate.memberSamples : []
  if (members.length !== 2) return false

  const source = members.find((member) => member.entityType === 'source_record')
  const other = members.find((member) => member.entityType !== 'source_record')
  if (!source || !other) return false

  if (!source.sourceRecordKey || !other.sourceRecordKey) return false
  return source.sourceRecordKey === other.sourceRecordKey
}

function hasTitleOnlyShape(candidate) {
  const reasons = Array.isArray(candidate.scoreReasons) ? candidate.scoreReasons : []
  return candidate.candidateType === 'title_match'
    || reasons.some((reason) => val(reason).toLowerCase().includes('title'))
}

function pushIssue(list, severity, code, message, row, extra = {}) {
  list.push({
    severity,
    code,
    message,
    candidateId: val(row.candidateId),
    groupId: val(row.groupId),
    candidateType: val(row.candidateType),
    candidateClass: val(row.candidateClass),
    score: row.score,
    normalizedTitle: val(row.normalizedTitle),
    memberCount: row.memberCount,
    ...extra,
  })
}

function auditCandidates(candidates) {
  const blockers = []
  const warnings = []

  const candidateIds = new Set()
  const duplicateCandidateIds = new Set()
  const groupIds = new Set()

  for (const candidate of candidates) {
    const candidateId = val(candidate.candidateId)
    const groupId = val(candidate.groupId)

    if (!candidateId) {
      pushIssue(blockers, 'blocker', 'missing_candidate_id', 'candidate is missing candidateId', candidate)
    } else if (candidateIds.has(candidateId)) {
      duplicateCandidateIds.add(candidateId)
      pushIssue(blockers, 'blocker', 'duplicate_candidate_id', 'duplicate candidateId', candidate)
    } else {
      candidateIds.add(candidateId)
    }

    if (!groupId) {
      pushIssue(blockers, 'blocker', 'missing_group_id', 'candidate is missing groupId', candidate)
    } else {
      groupIds.add(groupId)
    }

    if (candidate.applyAllowed === true) {
      pushIssue(blockers, 'blocker', 'apply_allowed_true', 'candidate has applyAllowed true', candidate)
    }

    if (candidate.reviewOnly !== true) {
      pushIssue(blockers, 'blocker', 'not_review_only', 'candidate is not reviewOnly true', candidate)
    }

    if (!Array.isArray(candidate.memberKeys) || candidate.memberKeys.length === 0) {
      pushIssue(blockers, 'blocker', 'missing_member_refs', 'candidate has no memberKeys', candidate)
    }

    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) {
      pushIssue(blockers, 'blocker', 'missing_evidence_refs', 'candidate has no evidenceRefs', candidate)
    }

    if (hasTitleOnlyShape(candidate) && candidate.candidateClass === 'strong_match_candidate') {
      pushIssue(blockers, 'blocker', 'title_only_strong', 'title-only candidate is classified as strong', candidate)
    }

    if (
      Array.isArray(candidate.conflictReasons)
      && candidate.conflictReasons.length > 0
      && candidate.candidateClass === 'strong_match_candidate'
    ) {
      pushIssue(blockers, 'blocker', 'conflict_strong', 'conflict candidate is classified as strong', candidate)
    }

    if (candidate.candidateType === 'graph_possible_duplicate' && candidate.candidateClass !== 'identity_conflict') {
      pushIssue(blockers, 'blocker', 'possible_duplicate_not_conflict', 'possible duplicate edge is not classified as conflict', candidate)
    }

    if (candidate.candidateType === 'boundary_relation' && candidate.score >= 60) {
      pushIssue(blockers, 'blocker', 'boundary_relation_too_high', 'boundary relation scored too high', candidate)
    }

    if (isSourceToOwnCandidate(candidate)) {
      pushIssue(warnings, 'warning', 'source_to_own_candidate_noise', 'source record is paired with its own candidate node', candidate)
    }

    if (candidate.candidateType === 'title_match') {
      pushIssue(warnings, 'warning', 'title_match_review_noise', 'title match candidate remains review-only', candidate)
    }

    if (candidate.candidateType === 'boundary_relation') {
      pushIssue(warnings, 'warning', 'boundary_relation_review', 'boundary relation remains review-only', candidate)
    }

    if (candidate.candidateClass === 'identity_conflict') {
      pushIssue(warnings, 'warning', 'identity_conflict_review', 'identity conflict requires manual review', candidate)
    }
  }

  return {
    blockers,
    warnings,
    candidateIds,
    groupIds,
    duplicateCandidateIds,
  }
}

function auditGroups(groups, candidateGroupIds) {
  const blockers = []
  const warnings = []
  const groupIds = new Set()
  const duplicateGroupIds = new Set()

  for (const group of groups) {
    const groupId = val(group.groupId)

    if (!groupId) {
      pushIssue(blockers, 'blocker', 'missing_group_id', 'group is missing groupId', group)
    } else if (groupIds.has(groupId)) {
      duplicateGroupIds.add(groupId)
      pushIssue(blockers, 'blocker', 'duplicate_group_id', 'duplicate groupId', group)
    } else {
      groupIds.add(groupId)
    }

    if (group.applyAllowed === true) {
      pushIssue(blockers, 'blocker', 'group_apply_allowed_true', 'group has applyAllowed true', group)
    }

    if (group.reviewOnly !== true) {
      pushIssue(blockers, 'blocker', 'group_not_review_only', 'group is not reviewOnly true', group)
    }

    if (!Array.isArray(group.candidateIds) || group.candidateIds.length === 0) {
      pushIssue(blockers, 'blocker', 'group_missing_candidate_ids', 'group has no candidateIds', group)
    }

    if (!Array.isArray(group.memberKeys) || group.memberKeys.length === 0) {
      pushIssue(blockers, 'blocker', 'group_missing_member_keys', 'group has no memberKeys', group)
    }

    if (groupId && !candidateGroupIds.has(groupId)) {
      pushIssue(blockers, 'blocker', 'group_without_candidate', 'groupId is not referenced by any candidate', group)
    }
  }

  return {
    blockers,
    warnings,
    groupIds,
    duplicateGroupIds,
  }
}

function sample(rows, limit = 80) {
  return rows.slice(0, limit)
}

function mdReport(summary, blockers, warnings) {
  return [
    '# Identity Match Candidates Audit v0.1',
    '',
    'This is a read-only audit of local identity match candidate outputs.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No production change.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForCombinedReviewQueue: ${summary.readyForCombinedReviewQueue}`,
    `- candidateRows: ${summary.candidateRows}`,
    `- groupRows: ${summary.groupRows}`,
    `- blockers: ${summary.blockers}`,
    `- warnings: ${summary.warnings}`,
    `- applyAllowedRows: ${summary.riskCounts.applyAllowedRows}`,
    '',
    '## Blockers by code',
    '',
    '| Code | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBlockerCode).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## Warnings by code',
    '',
    '| Code | Count |',
    '|---|---:|',
    ...Object.entries(summary.byWarningCode).map(([k, v]) => `| ${mdCell(k)} | ${v} |`),
    '',
    '## Blocker samples',
    '',
    blockers.length ? JSON.stringify(sample(blockers, 60), null, 2) : '- none',
    '',
    '## Warning samples',
    '',
    warnings.length ? JSON.stringify(sample(warnings, 60), null, 2) : '- none',
    '',
  ].join('\n')
}

async function main() {
  const candidatesPath = arg('candidates', CANDIDATES)
  const groupsPath = arg('groups', GROUPS)
  const outDir = arg('out-dir', OUT)

  for (const file of [candidatesPath, groupsPath]) {
    if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  }

  const candidates = await readJsonl(candidatesPath)
  const groups = await readJsonl(groupsPath)

  const candidateAudit = auditCandidates(candidates.rows)
  const groupAudit = auditGroups(groups.rows, candidateAudit.groupIds)

  const blockers = [
    ...candidateAudit.blockers,
    ...groupAudit.blockers,
  ]

  const warnings = [
    ...candidateAudit.warnings,
    ...groupAudit.warnings,
  ]

  const applyAllowedRows = candidates.rows.filter((row) => row.applyAllowed === true).length
    + groups.rows.filter((row) => row.applyAllowed === true).length

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'identity-match-candidates-audit-v0.1',
    readyForCombinedReviewQueue: blockers.length === 0,
    candidateRows: candidates.rows.length,
    groupRows: groups.rows.length,
    blockers: blockers.length,
    warnings: warnings.length,
    byCandidateClass: countBy(candidates.rows, 'candidateClass'),
    byCandidateType: countBy(candidates.rows, 'candidateType'),
    byBlockerCode: countBy(blockers, 'code'),
    byWarningCode: countBy(warnings, 'code'),
    riskCounts: {
      applyAllowedRows,
      notReviewOnlyCandidates: candidates.rows.filter((row) => row.reviewOnly !== true).length,
      notReviewOnlyGroups: groups.rows.filter((row) => row.reviewOnly !== true).length,
      duplicateCandidateIds: candidateAudit.duplicateCandidateIds.size,
      duplicateGroupIds: groupAudit.duplicateGroupIds.size,
      sourceToOwnCandidateNoise: warnings.filter((row) => row.code === 'source_to_own_candidate_noise').length,
      titleMatchReviewNoise: warnings.filter((row) => row.code === 'title_match_review_noise').length,
      boundaryRelationReview: warnings.filter((row) => row.code === 'boundary_relation_review').length,
      identityConflictReview: warnings.filter((row) => row.code === 'identity_conflict_review').length,
    },
    inputs: {
      candidates: candidatesPath,
      groups: groupsPath,
      candidateRowsRead: candidates.read,
      candidateRowsFailed: candidates.failed,
      groupRowsRead: groups.read,
      groupRowsFailed: groups.failed,
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'identity-match-candidates-v01-audit.json')
  const outSummary = path.join(outDir, 'identity-match-candidates-v01-audit-summary.json')
  const outMd = path.join(outDir, 'identity-match-candidates-v01-audit.md')

  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, blockers, warnings }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, mdReport(summary, blockers, warnings), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
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
