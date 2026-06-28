import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertRealPreparationAllowed,
  planTargetCollections,
  shouldRunRealPreparation,
} from '../scripts/import/prepare-target-content.mjs'

test('target preparation defaults to content collections only', () => {
  assert.deepEqual(planTargetCollections(), [
    'comments',
    'evidence',
    'works',
    'creators',
    'organizations',
  ])
})

test('target preparation can be limited to a safe subset', () => {
  assert.deepEqual(planTargetCollections('works,creators,organizations'), [
    'works',
    'creators',
    'organizations',
  ])
})

test('target preparation refuses protected rules and taxonomy collections', () => {
  assert.throws(() => planTargetCollections('works,rules'), /Protected collections/u)
  assert.throws(() => planTargetCollections('terms'), /Protected collections/u)
  assert.throws(() => planTargetCollections('media'), /Protected collections/u)
})

test('target preparation refuses unsupported collections', () => {
  assert.throws(() => planTargetCollections('works,unknownCollection'), /Unsupported target collection/u)
})

test('real target preparation requires explicit confirmation and no dry-run', () => {
  assert.equal(shouldRunRealPreparation({}), false)
  assert.equal(shouldRunRealPreparation({ 'dry-run': true }), false)
  assert.equal(shouldRunRealPreparation({ 'confirm-reset-content': true, 'dry-run': true }), false)
  assert.equal(shouldRunRealPreparation({ 'confirm-reset-content': true }), true)

  assert.throws(() => assertRealPreparationAllowed({}), /requires --confirm-reset-content/u)
  assert.throws(() => assertRealPreparationAllowed({ 'confirm-reset-content': true, 'dry-run': true }), /requires --confirm-reset-content/u)
  assert.doesNotThrow(() => assertRealPreparationAllowed({ 'confirm-reset-content': true }))
})
