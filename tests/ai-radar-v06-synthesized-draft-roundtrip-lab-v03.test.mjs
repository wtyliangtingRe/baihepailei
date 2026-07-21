import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { documentForDraftOnlyWrite } from '../scripts/radar/lab-ai-radar-v06-synthesized-draft-roundtrip-v03.mjs'
import { normalizedDocumentState } from '../scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs'

function publishedFixture() {
  return {
    id: '3839',
    title: 'Fixture',
    siteId: 'work:test',
    _status: 'published',
    rank: 'unknown',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-21T12:00:00.000Z',
    publishedAt: '2026-07-04T00:00:00.000Z',
    humanAssessment: {
      status: 'pending',
      sourceLinks: [],
    },
    localizedTitles: [
      {
        id: 'nested-row-id',
        title: '原題',
        language: 'ja',
      },
    ],
  }
}

test('draft-only write body removes only root generated metadata and forces draft status', () => {
  const body = documentForDraftOnlyWrite(publishedFixture())
  assert.equal('id' in body, false)
  assert.equal('createdAt' in body, false)
  assert.equal('updatedAt' in body, false)
  assert.equal('publishedAt' in body, false)
  assert.equal(body._status, 'draft')
  assert.equal(body.title, 'Fixture')
  assert.equal(body.siteId, 'work:test')
  assert.equal(body.localizedTitles[0].id, 'nested-row-id')
})

test('draft-only clean body remains semantically equal to published content except root status', () => {
  const published = publishedFixture()
  const draftBody = documentForDraftOnlyWrite(published)
  const publishedState = normalizedDocumentState(published)
  const draftState = normalizedDocumentState(draftBody)
  delete publishedState._status
  delete draftState._status
  assert.deepEqual(draftState, publishedState)
})

test('original draft body preserves all nonvolatile draft content', () => {
  const draft = {
    ...publishedFixture(),
    _status: 'draft',
    mediaType: 'manga',
    radarAssessment: {
      suggestedGrade: 'D',
      matchedRules: [{ id: 'row-id', code: 'D-GENERAL' }],
    },
  }
  const body = documentForDraftOnlyWrite(draft)
  assert.equal(body._status, 'draft')
  assert.equal(body.mediaType, 'manga')
  assert.equal(body.radarAssessment.suggestedGrade, 'D')
  assert.equal(body.radarAssessment.matchedRules[0].id, 'row-id')
})

test('v0.3 uses two draft-only writes and no generic version restore request', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/lab-ai-radar-v06-synthesized-draft-roundtrip-v03.mjs', import.meta.url),
    'utf8',
  )
  assert.match(source, /draft=true&depth=0/u)
  assert.match(source, /genericVersionRestoreRequests:\s*0/u)
  assert.doesNotMatch(source, /method:\s*['"]POST['"][\s\S]{0,200}\/versions\//u)
})

test('v0.3 requires a distinct exact confirmation string', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/lab-ai-radar-v06-synthesized-draft-roundtrip-v03.mjs', import.meta.url),
    'utf8',
  )
  assert.match(source, /EXECUTE-V06-SYNTHESIZED-DRAFT-ROUNDTRIP-LAB-V03-ONLY/u)
})
