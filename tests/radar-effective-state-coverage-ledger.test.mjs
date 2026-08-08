import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { auditEffectiveStateCoverage } from '../src/lib/radar/effectiveStateCoverageLedger.mjs'
import { writeAuditOutputs } from '../scripts/radar/audit-radar-effective-state-coverage-v01.mjs'

function work(id, overrides = {}) {
  return {
    id: String(id),
    siteId: `site-${id}`,
    title: `Work ${id}`,
    rank: 'unknown',
    reviewStatus: 'pending',
    humanAssessment: { status: 'pending' },
    ...overrides,
  }
}

function exactClaim(id, overrides = {}) {
  return {
    id: `claim-${id}`,
    work: String(id),
    workIdSnapshot: String(id),
    workSiteId: `site-${id}`,
    identityKey: `${id}|site-${id}`,
    publicationKey: `work:${id}`,
    recordStatus: 'current',
    ...overrides,
  }
}

function fixedCandidate(id, grade = 'B', overrides = {}) {
  return exactClaim(id, {
    conclusionMode: 'fixed_grade',
    compatibilityGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    radarAssessment: { policyVersion: 'radar-rating-policy-v0.5' },
    ...overrides,
  })
}

function fixedPublished(id, grade = 'B', overrides = {}) {
  return exactClaim(id, {
    conclusionMode: 'fixed_grade',
    coreGrade: grade,
    bestGrade: grade,
    likelyGrade: grade,
    worstGrade: grade,
    sourcePolicyVersion: 'radar-rating-policy-v0.5',
    sourceReleaseId: 'release-1',
    sourceCommitSha: 'a'.repeat(40),
    researchSnapshotId: 'research-1',
    ...overrides,
  })
}

function snapshot(overrides = {}) {
  return {
    works: [work(1)],
    radarPublicRecords: [],
    radarPublicRatings: [],
    radarPublicConclusions: [],
    radarResearchRecords: [],
    ...overrides,
  }
}

test('presence-first Published pair blocks lower valid Candidate and Research', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicRecords: [exactClaim(1, { sourceReleaseId: 'release-1' })],
    radarPublicConclusions: [fixedCandidate(1, 'A')],
    radarResearchRecords: [exactClaim(1, {
      researchKey: 'program|1|site-1',
      programId: 'program',
      researchStatus: 'resolved',
      proposedBestGrade: 'A',
      proposedLikelyGrade: 'B',
      proposedWorstGrade: 'C',
    })],
  }))

  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Published')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'published_pair_cardinality_invalid'))
  assert.equal(row.authorityPresence.Candidate, true)
  assert.equal(row.authorityPresence.Research, true)
})

test('malformed Candidate occupies Candidate instead of falling back to Research', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicConclusions: [exactClaim(1, {
      conclusionMode: 'labels_only',
      compatibilityGrade: 'B',
      radarAssessment: { policyVersion: 'radar-rating-policy-v0.5' },
    })],
    radarResearchRecords: [exactClaim(1, {
      researchKey: 'p|1|site-1',
      programId: 'p',
      researchStatus: 'resolved',
    })],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Candidate')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'nonrating_mode_ghost_grades'))
})

test('valid Human authority wins while lower-layer violations remain visible but shadowed', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    works: [work(1, { humanAssessment: { status: 'reviewed', grade: 'A' } })],
    radarPublicConclusions: [exactClaim(1, {
      conclusionMode: 'labels_only',
      compatibilityGrade: 'B',
    })],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Human')
  assert.equal(row.effectiveValid, true)
  assert.equal(row.effectiveConclusion.fixedGrade, 'A')
  assert.ok(row.violations.some((item) => item.code === 'nonrating_mode_ghost_grades'))
  assert.ok(!row.effectiveViolations.some((item) => item.code === 'nonrating_mode_ghost_grades'))
})

test('valid Published pair binds record/rating and uses canonical v0.5 conclusion semantics', () => {
  const record = exactClaim(1, {
    sourceReleaseId: 'release-1',
    sourceCommitSha: 'a'.repeat(40),
    researchSnapshotId: 'research-1',
  })
  const rating = fixedPublished(1, 'B')
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicRecords: [record],
    radarPublicRatings: [rating],
    radarPublicConclusions: [fixedCandidate(1, 'A')],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Published')
  assert.equal(row.effectiveValid, true)
  assert.equal(row.effectiveConclusion.conclusionMode, 'fixed_grade')
  assert.equal(row.effectiveConclusion.fixedGrade, 'B')
})

test('Research preserves history and selects deterministically; duplicate current observations fail closed', () => {
  const older = exactClaim(1, {
    id: 'r-old',
    researchKey: 'p-old|1|site-1',
    programId: 'p-old',
    researchStatus: 'resolved',
    importedAt: '2026-01-01T00:00:00Z',
  })
  const newer = exactClaim(1, {
    id: 'r-new',
    researchKey: 'p-new|1|site-1',
    programId: 'p-new',
    researchStatus: 'partial',
    importedAt: '2026-02-01T00:00:00Z',
  })
  const archived = exactClaim(1, {
    id: 'r-archive',
    researchKey: 'p-archive|1|site-1',
    programId: 'p-archive',
    recordStatus: 'archived',
    researchStatus: 'resolved',
    importedAt: '2026-03-01T00:00:00Z',
  })
  const audit = auditEffectiveStateCoverage(snapshot({ radarResearchRecords: [older, archived, newer] }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Research')
  assert.equal(row.historicalObservationCount, 3)
  assert.equal(row.effectiveResearchObservation.id, 'r-new')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'duplicate_current_research_claim'))
})

test('archived Research identity drift remains visible and invalidates Research integrity', () => {
  const current = exactClaim(1, {
    id: 'r-current',
    researchKey: 'p-current|1|site-1',
    programId: 'p-current',
    researchStatus: 'resolved',
    importedAt: '2026-02-01T00:00:00Z',
  })
  const archived = exactClaim(1, {
    id: 'r-archive-drift',
    researchKey: 'p-archive|1|wrong-site',
    programId: 'p-archive',
    recordStatus: 'archived',
    researchStatus: 'resolved',
    workSiteId: 'wrong-site',
    identityKey: '1|wrong-site',
    importedAt: '2026-01-01T00:00:00Z',
  })
  const audit = auditEffectiveStateCoverage(snapshot({ radarResearchRecords: [archived, current] }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Research')
  assert.equal(row.historicalObservationCount, 2)
  assert.equal(row.effectiveResearchObservation.id, 'r-current')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'work_site_id_snapshot_mismatch'))
  assert.ok(row.effectiveViolations.some((item) => item.code === 'identity_key_mismatch'))
})

test('Research history without a current observation remains Research and does not fall through to Legacy', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    works: [work(1, { rank: 'C' })],
    radarResearchRecords: [exactClaim(1, {
      id: 'r-archive',
      researchKey: 'p|1|site-1',
      programId: 'p',
      recordStatus: 'archived',
      researchStatus: 'resolved',
    })],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Research')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'research_no_current_observation'))
})

test('strict conservation requires one unique canonical Work per ledger row', () => {
  const good = auditEffectiveStateCoverage(snapshot({ works: [work(1), work(2)] }))
  assert.equal(good.conservation.strictSatisfied, true)
  assert.deepEqual(good.bucketCounts, {
    Human: 0,
    Published: 0,
    Candidate: 0,
    Research: 0,
    Legacy: 0,
    TrulyUnassessed: 2,
  })

  const duplicate = auditEffectiveStateCoverage(snapshot({ works: [work(1), work(1)] }))
  assert.equal(duplicate.conservation.strictSatisfied, false)
  assert.equal(duplicate.decision, 'FAIL')
})

test('orphan work references are global blockers', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicConclusions: [fixedCandidate(999, 'A')],
  }))
  assert.equal(audit.decision, 'FAIL')
  assert.ok(audit.globalViolations.some((item) => item.code === 'orphan_work_reference'))
})

test('machine X is rejected on Candidate/Published machine state', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicConclusions: [fixedCandidate(1, 'X')],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Candidate')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'machine_x_not_allowed'))
})

test('writer is byte deterministic for the same snapshot', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicConclusions: [fixedCandidate(1, 'B')],
  }))
  const left = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-ledger-a-'))
  const right = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-ledger-b-'))
  writeAuditOutputs(audit, left)
  writeAuditOutputs(audit, right)
  for (const name of ['audit.json', 'ledger.jsonl', 'violations.jsonl', 'SUMMARY.md', 'SHA256SUMS']) {
    assert.deepEqual(fs.readFileSync(path.join(left, name)), fs.readFileSync(path.join(right, name)))
  }
})

test('unknown recordStatus is treated as malformed authority presence, not as a fallback trigger', () => {
  const audit = auditEffectiveStateCoverage(snapshot({
    radarPublicConclusions: [fixedCandidate(1, 'B', { recordStatus: 'mystery' })],
    radarResearchRecords: [exactClaim(1, {
      researchKey: 'p|1|site-1',
      programId: 'p',
      researchStatus: 'resolved',
    })],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Candidate')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'record_status_invalid'))
})
