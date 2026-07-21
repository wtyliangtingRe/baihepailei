import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  matchingVersions,
  normalizePayloadValue,
  normalizedDocumentState,
  sha256,
  unrelatedPublishedState,
} from '../scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs'

function published() {
  return {
    id: '3839',
    siteId: 'work:test',
    title: 'Fixture',
    _status: 'published',
    rank: 'unknown',
    radarAssessment: {},
    humanAssessment: {
      status: 'pending',
      sourceLinks: [],
    },
    localizedTitles: [],
    candidateSources: [],
    updatedAt: '2026-07-21T09:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function draft() {
  return {
    ...published(),
    _status: 'draft',
    mediaType: 'manga',
    localizedTitles: [
      {
        id: 'payload-row-id',
        title: '原題',
        language: 'ja',
      },
    ],
    radarAssessment: {
      suggestedGrade: 'D',
      assessedAt: '2026-07-14T18:11:01.252188+00:00',
      matchedRules: [
        {
          id: 'payload-rule-id',
          code: 'D-GENERAL',
          grade: 'D',
        },
      ],
    },
  }
}

test('normalizes Payload row IDs and timestamps', () => {
  const value = normalizePayloadValue({
    id: 'row-id',
    assessedAt: '2026-07-14T18:11:01.252188+00:00',
    nested: [{ id: 'child-id', value: 1 }],
  })
  assert.deepEqual(value, {
    assessedAt: '2026-07-14T18:11:01.252Z',
    nested: [{ value: 1 }],
  })
})

test('removes only root document metadata from normalized state', () => {
  const state = normalizedDocumentState(published())
  assert.equal('id' in state, false)
  assert.equal('createdAt' in state, false)
  assert.equal('updatedAt' in state, false)
  assert.equal(state.siteId, 'work:test')
  assert.equal(state._status, 'published')
})

test('finds versions matching published and draft documents', () => {
  const currentPublished = published()
  const currentDraft = draft()
  const versions = [
    {
      id: 'v-draft',
      parent: '3839',
      createdAt: '2026-07-21T02:00:00.000Z',
      version: currentDraft,
    },
    {
      id: 'v-published-old',
      parent: '3839',
      createdAt: '2026-07-20T01:00:00.000Z',
      version: currentPublished,
    },
    {
      id: 'v-published-new',
      parent: '3839',
      createdAt: '2026-07-21T01:00:00.000Z',
      version: currentPublished,
    },
  ]
  assert.deepEqual(
    matchingVersions(versions, currentPublished).map((row) => row.id),
    ['v-published-new', 'v-published-old'],
  )
  assert.deepEqual(
    matchingVersions(versions, currentDraft).map((row) => row.id),
    ['v-draft'],
  )
})

test('unrelated published hash ignores only patch and volatile fields', () => {
  const before = published()
  const patch = {
    _status: 'published',
    rank: 'D',
    radarAssessment: { suggestedGrade: 'D' },
  }
  const afterExpected = {
    ...before,
    ...patch,
    updatedAt: '2026-07-21T10:00:00.000Z',
  }
  assert.equal(
    sha256(unrelatedPublishedState(before, patch)),
    sha256(unrelatedPublishedState(afterExpected, patch)),
  )

  const afterUnsafe = {
    ...afterExpected,
    mediaType: 'manga',
  }
  assert.notEqual(
    sha256(unrelatedPublishedState(before, patch)),
    sha256(unrelatedPublishedState(afterUnsafe, patch)),
  )
})

test('obsolete single-publication executor is hard disabled', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/run-ai-radar-v06-single-targeted-publication-once-v01.mjs', import.meta.url),
    'utf8',
  )
  assert.match(source, /permanently disabled/u)
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
})
