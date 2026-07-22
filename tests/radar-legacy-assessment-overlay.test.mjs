import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  extractLegacyReusableEvidence,
  isLegacyAssessmentFile,
} from '../scripts/radar/lib/legacy-assessment-overlay-v01.mjs'
import {
  catalogFingerprint,
  decideIncrementalAction,
  normalizeLedgerEntry,
} from '../scripts/radar/lib/processing-ledger-v01.mjs'

const row = {
  workId: '4145',
  siteId: 'work:4145',
  title: 'Example',
  writeProtection: { protected: false, reasons: [] },
}

test('legacy resolution files are recognized without treating arbitrary JSONL as legacy', () => {
  assert.equal(isLegacyAssessmentFile('data_local/x/v0.6-resolutions.jsonl'), true)
  assert.equal(isLegacyAssessmentFile('data_local/x/radar-assess-0001-chunk-0001.output.jsonl'), true)
  assert.equal(isLegacyAssessmentFile('data_local/x/incremental-research-selection-v01.jsonl'), false)
})

test('strong legacy assessment becomes reusable reassessment evidence', () => {
  const extracted = extractLegacyReusableEvidence({
    workId: '4145',
    siteId: 'work:4145',
    title: 'Example',
    grade: 'A',
    ruleCodes: ['A-NEAR-CONFIRMED'],
    evidenceCoverage: 0.71,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: 'Traceable old assessment evidence.',
    batchId: 'RADAR-ASSESS-0001',
  }, 'data_local/x/v0.6-resolutions.jsonl')
  assert.equal(extracted.accepted, true)

  const ledger = normalizeLedgerEntry({
    ...extracted.entry,
    catalogFingerprint: catalogFingerprint(row),
  })
  const decision = decideIncrementalAction(row, ledger, {
    policyVersion: 'radar-rating-policy-v0.4-draft',
    calibrationProfileId: 'site-owner-primary-v0.1',
  })
  assert.equal(decision.needsResearch, false)
  assert.equal(decision.needsAssessment, true)
  assert.match(decision.action, /^reassess_/u)
  assert.equal(ledger.reusableEvidence.grade, 'A')
})

test('weak or identity-conflicted legacy rows stay in network research', () => {
  for (const candidate of [
    {
      workId: '1',
      siteId: 'work:1',
      grade: 'D',
      evidenceCoverage: 0.2,
      evidenceStatus: 'single_secondary_supported',
      sourceSummary: 'weak',
    },
    {
      workId: '1',
      siteId: 'work:1',
      grade: 'D',
      evidenceCoverage: 0.8,
      evidenceStatus: 'single_secondary_supported',
      sourceSummary: 'conflict',
      blockers: ['identity_review_required'],
    },
  ]) {
    assert.equal(
      extractLegacyReusableEvidence(candidate, 'data_local/x/v0.6-resolutions.jsonl').accepted,
      false,
    )
  }
})

test('catalog drift still forces targeted research ahead of legacy reuse', () => {
  const extracted = extractLegacyReusableEvidence({
    workId: '4145',
    siteId: 'work:4145',
    grade: 'A',
    ruleCodes: ['A-NEAR-CONFIRMED'],
    evidenceCoverage: 0.7,
    evidenceStatus: 'single_secondary_supported',
    sourceSummary: 'old',
  }, 'data_local/x/v0.6-resolutions.jsonl')
  const ledger = normalizeLedgerEntry({
    ...extracted.entry,
    catalogFingerprint: catalogFingerprint(row),
  })
  assert.equal(
    decideIncrementalAction({ ...row, title: 'Changed' }, ledger).action,
    'research_refresh_catalog_changed',
  )
})

test('legacy overlay remains local-only and cannot mutate the human track', () => {
  for (const file of [
    'scripts/radar/lib/legacy-assessment-overlay-v01.mjs',
    'scripts/radar/build-ai-radar-processing-ledger-v01.mjs',
    'scripts/radar/select-ai-radar-incremental-wave-v01.mjs',
  ]) {
    const text = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  }
  const ledgerBuilder = fs.readFileSync('scripts/radar/build-ai-radar-processing-ledger-v01.mjs', 'utf8')
  assert.match(ledgerBuilder, /humanTrackMutations:\s*0/u)
})
