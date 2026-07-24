import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ASSESSMENT_BATCH,
  EXPECTED_ASSEMBLY_ZIP_SHA256,
  EXPECTED_REMEDIATION_ZIP_SHA256,
  EXPECTED_RESEARCH_ZIP_SHA256,
  asciiSafeJson,
  buildAssembledSnapshot,
  buildDryRunRow,
  buildPublicRecord,
  evidenceProviderFamilies,
  privatePatchFor,
} from '../scripts/radar/build-radar-blocked-assembly-dryrun-v01.mjs'
import {
  conclusionSha256ForRecord,
  normalizePublicRecordForStorage,
  sha256Canonical,
} from '../scripts/radar/lib/public-conclusion-storage-v01.mjs'

const selectedSnapshot = () => ({
  assessedAt: '2026-07-01T12:34:56.123456+00:00',
  assessmentBatch: 'OLD-BATCH',
  confidencePercent: 88,
  contradictions: [],
  decisiveRuleCode: 'B-LIGHT',
  decisiveRuleReason: 'reason',
  evidenceCoveragePercent: 75,
  evidenceStatus: 'multiple_secondary_supported',
  matchedRules: [{ code: 'B-LIGHT', grade: 'B', confidencePercent: 88, reason: 'reason' }],
  policyVersion: 'radar-rating-policy-v0.6-generalized-dryrun',
  requiresHumanReview: true,
  sourceCount: 1,
  sourceSummary: 'old summary',
  suggestedGrade: 'B',
  legacyResidualThatMustNotSurvive: 'forbidden',
})

function fixtures(category = 'assembly_ready_structured_cross_source') {
  const before = {
    evidenceStrength: 'unassessed',
    radarAssessment: {
      assessedAt: null,
      assessmentBatch: null,
      confidencePercent: null,
      contradictions: [],
      decisiveRuleCode: null,
      decisiveRuleReason: null,
      evidenceCoveragePercent: null,
      evidenceStatus: null,
      matchedRules: [],
      policyVersion: null,
      requiresHumanReview: true,
      sourceCount: null,
      sourceSummary: null,
      suggestedGrade: null,
    },
    rank: 'unknown',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['other'],
    reviewStatus: 'pending',
  }
  const oldSnapshot = selectedSnapshot()
  const candidateSha256 = 'a'.repeat(64)
  const privatePatch = {
    evidenceStrength: 'strong',
    radarAssessment: oldSnapshot,
    rank: 'B',
    ratingNotice: 'ai_synthesized_pending_review',
    reviewReasons: ['other', 'radar_seed_attached'],
    reviewStatus: 'pending',
  }
  const ledgerRow = {
    workId: '42',
    publicationKey: 'work:42',
    siteId: 'catalog-anilist-42',
    title: 'Example',
    selectedCandidate: { candidateSha256, grade: 'B', snapshot: oldSnapshot },
    selectedCandidateStatus: 'latest_structurally_valid_complete',
    identityResolved: true,
    discardedTestAssessment: false,
    currentPublicRecord: null,
    liveSnapshot: {
      title: 'Example',
      catalogStatus: 'active',
      payloadStatus: 'published',
      isLiteVisible: true,
      isFullVisible: true,
    },
    humanTrack: { recorded: false },
    remainingNonConflictBlockers: ['multiple_secondary_requires_two_traceable_sources'],
    latestStructurallyValidIdentityResolvedWins: true,
    wholeSnapshotReplacementRequired: true,
    explicitNullClearsOldValue: true,
    fieldResidualMergeForbidden: true,
    historicalCandidatesPreserved: true,
    history: [{ candidateSha256 }],
    conflicts: [],
    sourceAuditRow: {
      privatePlan: {
        target: { id: '42', siteId: 'catalog-anilist-42', title: 'Example' },
        expectedBefore: before,
        expectedBeforeHash: sha256Canonical(before),
        patch: privatePatch,
      },
    },
  }
  const researchRow = {
    workId: '42',
    publicationKey: 'work:42',
    candidate: { candidateSha256 },
    assemblyPatch: { preserveCandidateSha256: candidateSha256 },
    decision: {
      category,
      readyForOfflineAssemblyDryRun: true,
      sourceBlockerResolved: true,
    },
    sourceEvidence: category === 'assembly_ready_manual_verified'
      ? {
          manualEvidence: [
            { url: 'https://anilist.co/anime/42' },
            { url: 'https://en.wikipedia.org/wiki/Example' },
          ],
        }
      : { providerFamilies: ['anilist', 'myanimelist'] },
    manualOverride: category === 'assembly_ready_manual_verified'
      ? { findings: 'manually verified summary' }
      : null,
  }
  return { ledgerRow, researchRow }
}

test('locks the three accepted input bundles', () => {
  assert.equal(EXPECTED_ASSEMBLY_ZIP_SHA256, 'ecd2b30f925c2c20ef40f69a000d3bbd3950c6e42917aecad0449f7e79dd4d68')
  assert.equal(EXPECTED_RESEARCH_ZIP_SHA256, 'bfd991789b582faf4e780c973804d7ee8af4669f7ddb9724c3c52f9133d680a1')
  assert.equal(EXPECTED_REMEDIATION_ZIP_SHA256, '954c595e92c91f140b568389022c529196f5b4dbac00a83964377166b9eee729')
})

test('collapses same-database URLs into provider families', () => {
  const research = fixtures('assembly_ready_manual_verified').researchRow
  research.sourceEvidence.manualEvidence.push({ url: 'https://graphql.anilist.co' })
  assert.deepEqual(evidenceProviderFamilies(research), ['anilist', 'wikipedia'])
})

test('assembles an exact whole snapshot and never revives residual fields', () => {
  const { ledgerRow, researchRow } = fixtures()
  const snapshot = buildAssembledSnapshot({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
  })
  assert.equal(snapshot.assessmentBatch, ASSESSMENT_BATCH)
  assert.equal(snapshot.assessedAt, '2026-07-24T03:37:27+00:00')
  assert.equal(snapshot.sourceCount, 2)
  assert.equal(snapshot.suggestedGrade, 'B')
  assert.equal(snapshot.decisiveRuleCode, 'B-LIGHT')
  assert.equal('legacyResidualThatMustNotSurvive' in snapshot, false)
  assert.equal(Object.keys(snapshot).length, 14)
})

test('manual verification replaces the summary but preserves grade and rule', () => {
  const { ledgerRow, researchRow } = fixtures('assembly_ready_manual_verified')
  const snapshot = buildAssembledSnapshot({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
  })
  assert.equal(snapshot.sourceSummary, 'manually verified summary')
  assert.equal(snapshot.suggestedGrade, 'B')
  assert.equal(snapshot.decisiveRuleCode, 'B-LIGHT')
})

test('private plan reports semantic changes and binds expected-before hash', () => {
  const { ledgerRow, researchRow } = fixtures()
  const snapshot = buildAssembledSnapshot({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
  })
  const plan = privatePatchFor(ledgerRow, snapshot)
  assert.deepEqual(plan.changedFields, ['evidenceStrength', 'radarAssessment', 'rank', 'reviewReasons'])
  assert.equal(plan.expectedBeforeHash, sha256Canonical(plan.expectedBefore))
  assert.equal(plan.wholeSnapshotReplacement, true)
  assert.equal(plan.explicitNullClearsOldValue, true)
  assert.equal(plan.fieldResidualMergeForbidden, true)
})

test('public record hash reproduces and storage normalization changes only timestamp/hash', () => {
  const { ledgerRow, researchRow } = fixtures()
  const snapshot = buildAssembledSnapshot({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
  })
  const record = buildPublicRecord({ ledgerRow, assembledSnapshot: snapshot, researchZipSha256: EXPECTED_RESEARCH_ZIP_SHA256 })
  assert.equal(conclusionSha256ForRecord(record), record.conclusionSha256)
  const normalized = normalizePublicRecordForStorage(record)
  assert.deepEqual(normalized.mapping.changedFields, [
    'publicRecord.radarAssessment.assessedAt',
    'publicRecord.conclusionSha256',
  ])
  assert.equal(normalized.normalizedRecord.radarAssessment.assessedAt, '2026-07-24T03:37:27.000Z')
  assert.equal(conclusionSha256ForRecord(normalized.normalizedRecord), normalized.normalizedRecord.conclusionSha256)
})

test('dry-run blocks overlap with an existing current public record', () => {
  const { ledgerRow, researchRow } = fixtures()
  ledgerRow.currentPublicRecord = { id: 'existing' }
  const row = buildDryRunRow({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
    researchZipSha256: EXPECTED_RESEARCH_ZIP_SHA256,
  })
  assert.equal(row.dryRunStatus, 'blocked')
  assert.ok(row.blockers.includes('current_public_record_overlap'))
})

test('structured rows retain an explicit non-manual-review warning', () => {
  const { ledgerRow, researchRow } = fixtures()
  const row = buildDryRunRow({
    ledgerRow,
    researchRow,
    researchGeneratedAt: '2026-07-24T03:37:27+00:00',
    researchZipSha256: EXPECTED_RESEARCH_ZIP_SHA256,
  })
  assert.equal(row.dryRunStatus, 'ready_for_offline_assembly')
  assert.deepEqual(row.warnings, ['structured_source_evidence_is_triage_not_manual_page_review'])
  assert.equal(row.safety.payloadRead, false)
  assert.equal(row.safety.postgresqlRead, false)
  assert.equal(row.safety.productionApplyAuthorized, false)
})

test('JSONL serialization is ASCII-safe and one physical line', () => {
  const serialized = asciiSafeJson({ title: '百合\u2028作品😀' })
  assert.match(serialized, /^[\x20-\x7e]+$/u)
  assert.equal(serialized.includes('\n'), false)
  assert.deepEqual(JSON.parse(serialized), { title: '百合\u2028作品😀' })
})

test('runner is offline-only and has no apply mode', () => {
  const testRoot = path.dirname(fileURLToPath(import.meta.url))
  const root = path.dirname(testRoot)
  const runner = fs.readFileSync(path.join(root, 'scripts/radar/run-and-package-radar-blocked-assembly-dryrun-v01.ps1'), 'utf8')
  assert.doesNotMatch(runner, /Invoke-(?:WebRequest|RestMethod)|\/api\/|\b(?:docker|psql|pg_dump|next\s+dev)\b/iu)
  assert.match(runner, /PayloadRead\s*:\s*False/iu)
  assert.match(runner, /PostgreSQLRead\s*:\s*False/iu)
  assert.match(runner, /ProductionApply\s*:\s*False/iu)
  assert.match(runner, /EXPECTED|ExpectedAssemblyBundleSHA256|ExpectedResearchBundleSHA256/iu)
})
