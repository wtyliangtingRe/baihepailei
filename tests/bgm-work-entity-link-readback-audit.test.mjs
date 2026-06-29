import test from 'node:test';
import assert from 'node:assert/strict';

import {
  actualReadbackFieldsFromPayloadWork,
  auditBgmWorkEntityLinkReadback,
  compareReadbackItem,
  expectedReadbackFieldsFromPlanItem,
  validateReadbackPlan,
} from '../tools/source_import/scripts/audit-bgm-work-entity-link-readback.mjs';

function readyPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    status: 'ready',
    items: [
      {
        work: { payloadId: 101, title: 'Work A', bangumiSubjectId: '1' },
        links: {
          creators: [201, '202'],
          creatorCredits: [
            { creator: 201, roles: ['原作'] },
            { creatorId: '202', roles: ['作画'] },
          ],
          organizations: [301, 302],
          organizationCredits: [{ organization: 301, roles: ['出版社'] }],
        },
        errors: [],
        unresolvedRefs: { creators: [], organizations: [] },
        ambiguousRefs: { creators: [], organizations: [] },
      },
    ],
    ...overrides,
  };
}

function matchingPayloadWork() {
  return {
    id: 101,
    title: 'Work A',
    creators: [201, 202],
    organizations: [
      { organization: 301, role: 'publisher', originalRole: '出版社', source: 'bangumi' },
      { organization: 302, role: 'other', source: 'bangumi' },
    ],
    creatorCredits: [
      { creator: 201, role: 'original_creator', originalRole: '原作', source: 'bangumi' },
      { creator: 202, role: 'other', originalRole: '作画', source: 'bangumi' },
    ],
  };
}

test('normalizes expected relation fields from a plan item', () => {
  const expected = expectedReadbackFieldsFromPlanItem(readyPlan().items[0]);

  assert.deepEqual(expected.creators, [201, 202]);
  assert.deepEqual(expected.organizations, [
    { organization: 301, role: 'publisher', originalRole: '出版社', source: 'bangumi' },
    { organization: 302, role: 'other', source: 'bangumi' },
  ]);
  assert.deepEqual(expected.creatorCredits, [
    { creator: 201, role: 'original_creator', originalRole: '原作', source: 'bangumi' },
    { creator: 202, role: 'other', originalRole: '作画', source: 'bangumi' },
  ]);
});

test('normalizes actual relation fields from Payload rows', () => {
  const actual = actualReadbackFieldsFromPayloadWork({
    ...matchingPayloadWork(),
    creators: [{ id: 201 }, 202],
    organizations: [
      { organization: { id: 301 }, role: 'publisher', originalRole: '出版社', source: 'bangumi' },
      { organization: 302, role: 'other', source: 'bangumi' },
    ],
  });

  assert.deepEqual(actual.creators, [201, 202]);
  assert.deepEqual(actual.organizations[0], { organization: 301, role: 'publisher', originalRole: '出版社', source: 'bangumi' });
  assert.deepEqual(actual.creatorCredits[1], { creator: 202, role: 'other', originalRole: '作画', source: 'bangumi' });
});

test('detects relation mismatches for a single item', () => {
  const result = compareReadbackItem(readyPlan().items[0], {
    ...matchingPayloadWork(),
    creators: [201],
    organizations: [{ organization: 301, role: 'publisher', originalRole: '出版社', source: 'bangumi' }],
    creatorCredits: [{ creator: 201, role: 'original_creator', originalRole: '原作', source: 'bangumi' }],
  });

  assert.equal(result.status, 'fail');
  assert.deepEqual(result.mismatches.map((mismatch) => mismatch.field), ['creators', 'organizations', 'creatorCredits']);
});

test('blocks readback audit when the plan is not ready', async () => {
  const audit = await auditBgmWorkEntityLinkReadback(readyPlan({ status: 'needs-review' }), {
    token: 'token',
    fetchImpl: async () => assert.fail('fetch should not be called'),
  });

  assert.equal(audit.status, 'blocked');
  assert.equal(audit.counts.payloadReadsTotal, 0);
  assert.equal(validateReadbackPlan(readyPlan()).status, 'pass');
});

test('reads works and passes when readback matches plan', async () => {
  const calls = [];
  const audit = await auditBgmWorkEntityLinkReadback(readyPlan(), {
    token: 'token',
    payloadBaseUrl: 'http://local.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => matchingPayloadWork() };
    },
  });

  assert.equal(audit.status, 'pass');
  assert.equal(audit.counts.payloadReadsTotal, 1);
  assert.equal(audit.counts.matchedWorksTotal, 1);
  assert.equal(audit.counts.mismatchedWorksTotal, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
});
