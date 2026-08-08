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

function researchClaim(id, overrides = {}) {
  return exactClaim(id, {
    researchKey: `program|${id}|site-${id}`,
    programId: 'program',
    batchId: 'batch',
    researchStatus: 'resolved',
    confidencePercent: 80,
    importedAt: '2026-01-01T00:00:00Z',
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
    radarResearchRecords: [researchClaim(1, {
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
    radarResearchRecords: [researchClaim(1)],
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

test('Research preserves history and prefers resolved quality over a newer partial observation', () => {
  const older = researchClaim(1, {
    id: 'r-old',
    researchKey: 'p-old|1|site-1',
    programId: 'p-old',
    researchStatus: 'resolved',
    importedAt: '2026-01-01T00:00:00Z',
  })
  const newer = researchClaim(1, {
    id: 'r-new',
    researchKey: 'p-new|1|site-1',
    programId: 'p-new',
    researchStatus: 'partial',
    confidencePercent: 100,
    importedAt: '2026-02-01T00:00:00Z',
  })
  const archived = researchClaim(1, {
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
  assert.equal(row.effectiveResearchObservation.id, 'r-old')
  assert.match(row.effectiveResearchObservation.selectionReason, /^quality\/status-first:/)
  assert.equal(row.effectiveResearchObservation.selectionBlocked, false)
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'duplicate_current_research_claim'))
})

test('reviewed Research observation beats a newer unreviewed peer before recency tie-break', () => {
  const reviewed = researchClaim(1, {
    id: 'r-reviewed',
    reviewed: true,
    confidencePercent: 70,
    importedAt: '2026-01-01T00:00:00Z',
  })
  const newer = researchClaim(1, {
    id: 'r-newer',
    confidencePercent: 100,
    importedAt: '2026-03-01T00:00:00Z',
  })
  const row = auditEffectiveStateCoverage(snapshot({ radarResearchRecords: [reviewed, newer] })).ledger[0]
  assert.equal(row.effectiveResearchObservation.id, 'r-reviewed')
})

test('equal-quality Research observations use recency only as a later deterministic tie-break', () => {
  const older = researchClaim(1, { id: 'r-equal-old', importedAt: '2026-01-01T00:00:00Z' })
  const newer = researchClaim(1, { id: 'r-equal-new', importedAt: '2026-02-01T00:00:00Z' })
  const row = auditEffectiveStateCoverage(snapshot({ radarResearchRecords: [newer, older] })).ledger[0]
  assert.equal(row.effectiveResearchObservation.id, 'r-equal-new')
})

test('malformed higher-priority Research observation blocks instead of falling back to lower valid observation', () => {
  const valid = researchClaim(1, {
    id: 'r-valid',
    researchStatus: 'partial',
    confidencePercent: 20,
    importedAt: '2026-02-01T00:00:00Z',
  })
  const malformed = researchClaim(1, {
    id: 'r-malformed',
    researchStatus: 'resolved',
    confidencePercent: 99,
    proposedBestGrade: 'D',
    proposedLikelyGrade: 'B',
    proposedWorstGrade: 'A',
    importedAt: '2026-01-01T00:00:00Z',
  })
  const row = auditEffectiveStateCoverage(snapshot({ radarResearchRecords: [valid, malformed] })).ledger[0]
  assert.equal(row.effectiveBucket, 'Research')
  assert.equal(row.effectiveResearchObservation.id, 'r-malformed')
  assert.equal(row.effectiveResearchObservation.selectionBlocked, true)
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'research_effective_selection_blocked_by_malformed_observation'))
  assert.ok(row.effectiveViolations.some((item) => item.code === 'research_range_order_invalid'))
})

test('archived Research identity drift remains visible and invalidates Research integrity', () => {
  const current = researchClaim(1, {
    id: 'r-current',
    researchKey: 'p-current|1|site-1',
    programId: 'p-current',
    importedAt: '2026-02-01T00:00:00Z',
  })
  const archived = researchClaim(1, {
    id: 'r-archive-drift',
    researchKey: 'p-archive|1|wrong-site',
    programId: 'p-archive',
    recordStatus: 'archived',
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
    radarResearchRecords: [researchClaim(1, {
      id: 'r-archive',
      recordStatus: 'archived',
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
    radarResearchRecords: [researchClaim(1)],
  }))
  const row = audit.ledger[0]
  assert.equal(row.effectiveBucket, 'Candidate')
  assert.equal(row.effectiveValid, false)
  assert.ok(row.effectiveViolations.some((item) => item.code === 'record_status_invalid'))
})
