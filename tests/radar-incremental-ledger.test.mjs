import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  catalogFingerprint,
  decideIncrementalAction,
  identityKey,
} from '../scripts/radar/lib/processing-ledger-v01.mjs'

const baseRow = {
  workId: '100',
  siteId: 'work:100',
  title: 'Example',
  summaryText: 'same',
  writeProtection: { protected: false, reasons: [] },
}

test('processing ledger identity is stable', () => {
  assert.equal(identityKey(baseRow), '100|work:100')
  assert.equal(catalogFingerprint(baseRow), catalogFingerprint({ ...baseRow }))
})

test('new rows enter research and completed unchanged rows are skipped', () => {
  assert.equal(decideIncrementalAction(baseRow, null).action, 'research_new')
  const entry = {
    ...baseRow,
    catalogFingerprint: catalogFingerprint(baseRow),
    researchStatus: 'ready_for_ai_assessment',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    calibrationProfileId: 'site-owner-primary-v0.1',
    aiQaStatus: 'ai_qa_passed',
  }
  assert.equal(decideIncrementalAction(baseRow, entry, {
    policyVersion: 'radar-rating-policy-v0.4-draft',
    calibrationProfileId: 'site-owner-primary-v0.1',
  }).action, 'skip_completed_unchanged')
})

test('deferred rows retry research while policy changes only reassess', () => {
  const common = {
    ...baseRow,
    catalogFingerprint: catalogFingerprint(baseRow),
    researchStatus: 'ready_for_ai_assessment',
    policyVersion: 'radar-rating-policy-v0.4-draft',
    calibrationProfileId: 'site-owner-primary-v0.1',
  }
  assert.equal(decideIncrementalAction(baseRow, {
    ...common,
    aiQaStatus: 'ai_qa_deferred',
  }).action, 'research_retry_ai_qa_deferred')
  const policy = decideIncrementalAction(baseRow, {
    ...common,
    aiQaStatus: 'ai_qa_passed',
  }, {
    policyVersion: 'radar-rating-policy-v0.5-draft',
    calibrationProfileId: 'site-owner-primary-v0.1',
  })
  assert.equal(policy.action, 'reassess_policy_changed')
  assert.equal(policy.needsResearch, false)
  assert.equal(policy.needsAssessment, true)
})

test('catalog changes trigger targeted research refresh', () => {
  const changed = { ...baseRow, summaryText: 'changed' }
  const decision = decideIncrementalAction(changed, {
    ...baseRow,
    catalogFingerprint: catalogFingerprint(baseRow),
    researchStatus: 'ready_for_ai_assessment',
    aiQaStatus: 'ai_qa_passed',
  })
  assert.equal(decision.action, 'research_refresh_catalog_changed')
  assert.equal(decision.refreshReason, 'catalog_changed')
})

test('ledger scripts remain local-only and preserve human track isolation', () => {
  for (const file of [
    'scripts/radar/build-ai-radar-processing-ledger-v01.mjs',
    'scripts/radar/select-ai-radar-incremental-wave-v01.mjs',
  ]) {
    const text = fs.readFileSync(file, 'utf8')
    assert.match(text, /assertUnderDataLocal/u)
    assert.match(text, /humanTrackMutations:\s*0/u)
    assert.doesNotMatch(text, /payload\.update|payload\.create|UPDATE\s+works|INSERT\s+INTO/iu)
  }
})
