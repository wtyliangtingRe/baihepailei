import assert from 'node:assert/strict'
import test from 'node:test'

import { payloadDocument } from '../scripts/radar/run-unified-release-lab-import-lib-0575-v01.mjs'

const optionalFields = [
  'reviewerIdentity',
  'reviewedAt',
  'decision',
  'proposedCoreGrade',
  'reasoning',
  'moderationState',
]

test('Payload document preserves optional human review empties as null', () => {
  const source = {
    work: '42',
    publicationKey: 'work:42',
    humanReview: {
      status: 'unreviewed',
      reviewerIdentity: '',
      reviewedAt: null,
      decision: '   ',
      proposedCoreGrade: '',
      reasoning: undefined,
      moderationState: '',
      proposedProfileChanges: [],
      additionalEvidenceRefs: [],
      blocksAnalysis: false,
      blocksPublication: false,
    },
  }

  const document = payloadDocument(source)

  assert.equal(document.work, 42)
  for (const field of optionalFields) assert.equal(document.humanReview[field], null)
  assert.equal(source.humanReview.proposedCoreGrade, '')
})

test('Payload document keeps a valid proposed grade', () => {
  const document = payloadDocument({
    work: 42,
    humanReview: {
      proposedCoreGrade: 'B',
    },
  })

  assert.equal(document.humanReview.proposedCoreGrade, 'B')
})
