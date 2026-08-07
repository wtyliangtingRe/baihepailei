import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const policy = await import('../src/lib/radar/ratingPolicy.ts')

const active = new Set(Object.keys(policy.radarClassDefinitions))
const retired = new Set(policy.radarRetiredClassIds)

test('runtime policy selector points to v0.5 bundle and class registry', () => {
  assert.equal(policy.RADAR_RATING_POLICY_ID, 'radar-rating-policy-v0.5')
  assert.equal(policy.RADAR_CLASS_REGISTRY_ID, 'radar-class-registry-v0.5')
  assert.equal(policy.RADAR_POLICY_BUNDLE_ID, 'radar-policy-bundle-v0.5')

  const websiteBundle = JSON.parse(fs.readFileSync('config/radar-policy-bundle-v05.json', 'utf8'))
  assert.equal(websiteBundle.policyId, policy.RADAR_RATING_POLICY_ID)
  assert.equal(websiteBundle.researchAuthority.bundleId, policy.RADAR_POLICY_BUNDLE_ID)
  assert.equal(websiteBundle.bundleId, 'radar-website-policy-bundle-v0.5')
})

test('v0.5 runtime class registry excludes retired classes', () => {
  for (const classId of retired) assert.equal(active.has(classId), false, classId)
  assert.equal(active.has('D-UNCLEAR'), false)
  assert.equal(active.has('D-TS'), false)
  assert.equal(active.has('S-CREATOR-SAFE'), false)
})

test('v0.5 runtime class registry contains new and human-only special classes', () => {
  for (const classId of ['D-FUTURE-HET-HINT', 'D-SPECIAL', 'F-SPECIAL']) {
    assert.equal(active.has(classId), true, classId)
  }
  for (const classId of ['C-SPECIAL', 'D-SPECIAL', 'E-SPECIAL', 'F-SPECIAL']) {
    assert.equal(policy.radarClassDefinitions[classId].requiresHumanReview, true, classId)
  }
})

test('ordinary E and F classes are not blanket mandatory-human-review', () => {
  assert.notEqual(policy.radarClassDefinitions['E-MALE-INTIMACY'].requiresHumanReview, true)
  assert.notEqual(policy.radarClassDefinitions['F-HET-END'].requiresHumanReview, true)
})

test('X remains human-only and non-auto-publishable', () => {
  for (const [classId, definition] of Object.entries(policy.radarClassDefinitions)) {
    if (!classId.startsWith('X-')) continue
    assert.equal(definition.requiresHumanReview, true, classId)
    assert.equal(definition.doNotAutoPublish, true, classId)
  }
  assert.equal(policy.radarPolicySafety.doNotAutoAssignX, true)
  assert.equal(policy.radarPolicySafety.machineXForbidden, true)
})

test('setting profiles are separate from core-grade classes', () => {
  assert.deepEqual(policy.radarPreferenceProfileKeys, [
    'ts',
    'futa',
    'abo',
    'otokonoko_or_crossdressing',
    'queer_general',
  ])
  assert.equal(policy.radarPolicySafety.settingProfilesDoNotAutomaticallyChangeCoreGrade, true)
})

test('policy activation status remains pending until every gate passes', () => {
  const status = JSON.parse(fs.readFileSync('config/radar-policy-status-registry-v05.json', 'utf8'))
  const websiteBundle = JSON.parse(fs.readFileSync('config/radar-policy-bundle-v05.json', 'utf8'))
  assert.equal(status.status, 'approved_pending_activation_gates')
  assert.equal(status.productionAuthorization, false)
  assert.equal(websiteBundle.status, 'approved_pending_activation_gates')
  assert.equal(websiteBundle.databaseMigrationAuthorized, false)
  assert.equal(websiteBundle.payloadWriteAuthorized, false)
  assert.equal(websiteBundle.postgresqlWriteAuthorized, false)
  assert.equal(websiteBundle.productionAuthorization, false)
})
