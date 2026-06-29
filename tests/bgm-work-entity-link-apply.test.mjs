import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyBgmWorkEntityLinkPlan,
  buildApplyOperations,
  buildWorkRelationPatch,
  validateApplyPlan,
} from '../tools/source_import/scripts/apply-bgm-work-entity-link-plan.mjs';

function readyPlan() {
  return {
    schemaVersion: 1,
    status: 'ready',
    items: [
      {
        work: { payloadId: 101, title: 'Work A', bangumiSubjectId: '1' },
        links: {
          creators: [201, 201, '202'],
          creatorCredits: [
            { creator: 201, name: 'Alice', roles: ['原作'], order: 1, sourcePath: 'creatorCreditHints.0', matchBy: 'name', matchKey: 'Alice' },
            { creatorId: '202', name: 'Bob', roles: ['作画'] },
          ],
          organizations: [301, '301', 302],
          organizationCredits: [
            { organization: 301, name: 'Pub', roles: ['出版社'] },
          ],
        },
        errors: [],
        unresolvedRefs: { creators: [], organizations: [] },
        ambiguousRefs: { creators: [], organizations: [] },
      },
    ],
  };
}

test('builds a relation-only PATCH payload', () => {
  const patch = buildWorkRelationPatch(readyPlan().items[0]);
  assert.deepEqual(Object.keys(patch), ['creators', 'creatorCredits', 'organizations']);
  assert.deepEqual(patch.creators, [201, 202]);
  assert.deepEqual(patch.organizations, [301, 302]);
  assert.equal(patch.creatorCredits.length, 2);
  assert.equal(patch.creatorCredits[0].creator, 201);
  assert.equal(patch.creatorCredits[1].creator, 202);
  assert.equal('organizationCredits' in patch, false);
});

test('blocks apply when the plan is not ready', () => {
  const plan = readyPlan();
  plan.status = 'needs-review';
  const validation = validateApplyPlan(plan);
  assert.equal(validation.status, 'fail');
  assert.equal(validation.errors[0].code, 'plan_not_ready');
});

test('dry-run plans operations without reading or writing Payload', async () => {
  let fetchCalls = 0;
  const result = await applyBgmWorkEntityLinkPlan(readyPlan(), {
    apply: false,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('fetch should not be called in dry-run');
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.report.status, 'dry-run');
  assert.equal(result.report.counts.payloadReadsTotal, 0);
  assert.equal(result.report.counts.payloadWritesTotal, 0);
  assert.equal(result.report.operations[0].status, 'dry-run');
});

test('apply mode reads before writing and PATCHes only relation fields with JWT auth', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ id: 101, title: 'Work A', creators: [] }) };
    }
    if (options.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ id: 101, title: 'Work A' }) };
    }
    throw new Error(`unexpected method ${options.method}`);
  };

  const result = await applyBgmWorkEntityLinkPlan(readyPlan(), {
    apply: true,
    fetchImpl,
    token: 'test-token',
    payloadBaseUrl: 'http://payload.local',
  });

  assert.equal(result.report.status, 'applied');
  assert.equal(result.report.counts.payloadReadsTotal, 1);
  assert.equal(result.report.counts.payloadWritesTotal, 1);
  assert.equal(result.backup.items.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[0].options.headers.Authorization, 'JWT test-token');
  assert.equal(calls[1].options.headers.Authorization, 'JWT test-token');

  const patch = JSON.parse(calls[1].options.body);
  assert.deepEqual(Object.keys(patch), ['creators', 'creatorCredits', 'organizations']);
  assert.deepEqual(patch.creators, [201, 202]);
  assert.deepEqual(patch.organizations, [301, 302]);
});

test('buildApplyOperations preserves work metadata and patch', () => {
  const [operation] = buildApplyOperations(readyPlan());
  assert.equal(operation.work.payloadId, 101);
  assert.equal(operation.work.title, 'Work A');
  assert.equal(operation.work.bangumiSubjectId, '1');
  assert.deepEqual(operation.patch.creators, [201, 202]);
});
