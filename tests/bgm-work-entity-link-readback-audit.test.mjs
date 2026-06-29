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
            { creator: 201, roles: ['原作'], order: 1 },
            { creatorId: '202', roles: ['作画'], order: 2 },
          ],
          organizations: [301],
        },
        errors: [],
        unresolvedRefs: { creators: [], organizations: [] },
        ambiguousRefs: { creators: [], organizations: [] },
      },
    ],
    ...overrides,
  };
}

test('normalizes expected relation fields from a plan item', () => {
  const item = readyPlan().items[0];
  const expected = expectedReadbackFieldsFromPlanItem(item);

  assert.deepEqual(expected.creators, [201, 202]);
  assert.deepEqual(expected.organizations, [301]);
  assert.deepEqual(expected.creatorCredits, [
    { creator: 201, roles: ['原作'], order: 1 },
    { creator: 202, roles: ['作画'], order: 2 },
  ]);
});

test('normalizes actual relation fields from Payload readback docs or ids', () => {
  const actual = actualReadbackFieldsFromPayloadWork({
    creators: [{ id: 201 }, 202],
    organizations: [{ id: 301 }],
    creatorCredits: [
      { creator: { id: 201 }, roles: ['原作'], order: 1 },
      { creator: 202, roles: ['作画'], order: 2 },
    ],
  });

  assert.deepEqual(actual.creators, [201, 202]);
  assert.deepEqual(actual.organizations, [301]);
  assert.deepEqual(actual.creatorCredits, [
    { creator: 201, roles: ['原作'], order: 1 },
    { creator: 202, roles: ['作画'], order: 2 },
  ]);
});

test('detects relation mismatches for a single item', () => {
  const result = compareReadbackItem(readyPlan().items[0], {
    id: 101,
    title: 'Work A',
    creators: [201],
    organizations: [301],
    creatorCredits: [{ creator: 201, roles: ['原作'], order: 1 }],
  });

  assert.equal(result.status, 'fail');
  assert.deepEqual(result.mismatches.map((mismatch) => mismatch.field), ['creators', 'creatorCredits']);
});

test('blocks readback audit when the plan is not ready', async () => {
  const audit = await auditBgmWorkEntityLinkReadback(readyPlan({ status: 'needs-review' }), {
    token: 'fake-token',
    fetchImpl: async () => assert.fail('fetch should not be called'),
  });

  assert.equal(audit.status, 'blocked');
  assert.equal(audit.counts.payloadReadsTotal, 0);
  assert.equal(validateReadbackPlan(readyPlan()).status, 'pass');
});

test('reads Payload works and passes when readback matches plan', async () => {
  const calls = [];
  const audit = await auditBgmWorkEntityLinkReadback(readyPlan(), {
    token: 'fake-token',
    payloadBaseUrl: 'http://payload.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 101,
          title: 'Work A',
          creators: [201, 202],
          organizations: [301],
          creatorCredits: [
            { creator: 201, roles: ['原作'], order: 1 },
            { creator: 202, roles: ['作画'], order: 2 },
          ],
        }),
      };
    },
  });

  assert.equal(audit.status, 'pass');
  assert.equal(audit.counts.payloadReadsTotal, 1);
  assert.equal(audit.counts.matchedWorksTotal, 1);
  assert.equal(audit.counts.mismatchedWorksTotal, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'JWT fake-token');
  assert.ok(calls[0].url.includes('/api/works/101?depth=0&draft=true'));
});
