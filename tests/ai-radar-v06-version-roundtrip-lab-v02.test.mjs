import assert from 'node:assert/strict'
import test from 'node:test'

import {
  matchingExactVersions,
  matchingPublishedBaselineVersions,
  normalizedDocumentStateIgnoringRootStatus,
} from '../scripts/radar/lab-ai-radar-v06-version-roundtrip-v02.mjs'

function published() {
  return {
    id: '3839',
    siteId: 'work:test',
    title: 'Fixture',
    _status: 'published',
    rank: 'unknown',
    reviewReasons: [],
    humanAssessment: {
      status: 'pending',
      sourceLinks: [],
    },
    candidateSources: [],
    updatedAt: '2026-07-21T09:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function draftOnlyStatus() {
  return {
    ...published(),
    _status: 'draft',
  }
}

test('published baseline matching ignores only the root _status field', () => {
  const current = published()
  const versions = [
    {
      id: 'status-only-old',
      createdAt: '2026-07-20T01:00:00.000Z',
      version: draftOnlyStatus(),
    },
    {
      id: 'status-only-new',
      createdAt: '2026-07-21T01:00:00.000Z',
      version: draftOnlyStatus(),
    },
  ]

  assert.deepEqual(
    matchingPublishedBaselineVersions(versions, current).map((row) => row.id),
    ['status-only-new', 'status-only-old'],
  )
})

test('published baseline matching rejects any non-status content change', () => {
  const changedTitle = {
    ...draftOnlyStatus(),
    title: 'Different',
  }
  const changedNested = {
    ...draftOnlyStatus(),
    humanAssessment: {
      ...draftOnlyStatus().humanAssessment,
      status: 'reviewed',
    },
  }
  const missingField = draftOnlyStatus()
  delete missingField.reviewReasons

  const versions = [
    { id: 'changed-title', createdAt: '2026-07-21T03:00:00.000Z', version: changedTitle },
    { id: 'changed-nested', createdAt: '2026-07-21T02:00:00.000Z', version: changedNested },
    { id: 'missing-field', createdAt: '2026-07-21T01:00:00.000Z', version: missingField },
  ]

  assert.deepEqual(matchingPublishedBaselineVersions(versions, published()), [])
})

test('only root _status is ignored, nested status values remain significant', () => {
  const current = published()
  const changed = {
    ...draftOnlyStatus(),
    humanAssessment: {
      ...draftOnlyStatus().humanAssessment,
      status: 'reviewed',
    },
  }

  assert.notDeepEqual(
    normalizedDocumentStateIgnoringRootStatus(changed),
    normalizedDocumentStateIgnoringRootStatus(current),
  )
})

test('original latest draft matching remains exact including root status', () => {
  const currentDraft = {
    ...draftOnlyStatus(),
    mediaType: 'manga',
  }
  const versions = [
    {
      id: 'published-shape',
      createdAt: '2026-07-21T01:00:00.000Z',
      version: {
        ...currentDraft,
        _status: 'published',
      },
    },
    {
      id: 'exact-draft',
      createdAt: '2026-07-21T02:00:00.000Z',
      version: currentDraft,
    },
  ]

  assert.deepEqual(
    matchingExactVersions(versions, currentDraft).map((row) => row.id),
    ['exact-draft'],
  )
})
