import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkEntityLinkPlan,
  extractEntityRefsFromWork,
  extractPackageWorks,
} from '../tools/source_import/scripts/build-bgm-work-entity-link-plan.mjs';
import { auditWorkEntityLinkPlan } from '../tools/source_import/scripts/audit-bgm-work-entity-link-plan.mjs';

test('extracts package works from the standard preview shape', () => {
  const preview = {
    works: [
      { siteId: 'bangumi-1', title: 'Work A', creators: [{ name: 'Alice' }] },
      { note: 'not a work' },
    ],
  };

  const works = extractPackageWorks(preview);
  assert.equal(works.length, 1);
  assert.equal(works[0].title, 'Work A');
});

test('extracts creator and organization refs from a work', () => {
  const work = {
    siteId: 'bangumi-1',
    title: 'Work A',
    creators: [{ name: 'Alice', role: '原作' }],
    organizations: [{ name: 'Pub', role: '出版社' }],
  };

  const creators = extractEntityRefsFromWork(work, 'creators');
  const organizations = extractEntityRefsFromWork(work, 'organizations');

  assert.equal(creators.length, 1);
  assert.equal(creators[0].name, 'Alice');
  assert.deepEqual(creators[0].roles, ['原作']);
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].name, 'Pub');
});

test('builds a local-only work entity link plan and passes audit', () => {
  const packagePreview = {
    works: [
      {
        siteId: 'bangumi-1',
        title: 'Work A',
        creators: [
          { name: 'Alice', role: '原作' },
          { name: 'Bob', roles: ['作画'] },
        ],
        organizations: [{ name: 'Pub', role: '出版社' }],
      },
    ],
  };

  const idMap = {
    works: [{ siteId: 'bangumi-1', title: 'Work A', payloadId: 101 }],
    creators: [
      { name: 'Alice', payloadId: 201 },
      { name: 'Bob', payloadId: 202 },
    ],
    organizations: [{ name: 'Pub', payloadId: 301 }],
  };

  const plan = buildWorkEntityLinkPlan(packagePreview, idMap);
  assert.equal(plan.mode, 'local-plan-only/no-payload-reads/no-payload-writes/no-relation-patch/no-cover-upload');
  assert.equal(plan.status, 'ready');
  assert.equal(plan.counts.packageWorksTotal, 1);

  const item = plan.items[0];
  assert.equal(item.work.payloadId, 101);
  assert.deepEqual(item.links.creators, [201, 202]);
  assert.deepEqual(item.links.organizations, [301]);
  assert.equal(item.links.creatorCredits[0].creator, 201);
  assert.equal(item.links.creatorCredits[0].roles[0], '原作');

  const audit = auditWorkEntityLinkPlan(plan);
  assert.equal(audit.status, 'pass');
  assert.equal(audit.counts.errorsTotal, 0);
});

test('missing entity refs become review-blocking audit errors', () => {
  const packagePreview = {
    works: [
      {
        siteId: 'bangumi-1',
        title: 'Work A',
        creators: [{ name: 'Missing Creator', role: '原作' }],
        organizations: [{ name: 'Pub', role: '出版社' }],
      },
    ],
  };

  const idMap = {
    works: [{ siteId: 'bangumi-1', title: 'Work A', payloadId: 101 }],
    creators: [],
    organizations: [{ name: 'Pub', payloadId: 301 }],
  };

  const plan = buildWorkEntityLinkPlan(packagePreview, idMap);
  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.counts.unresolvedCreatorRefsTotal, 1);

  const audit = auditWorkEntityLinkPlan(plan);
  assert.equal(audit.status, 'fail');
  assert.ok(audit.errors.some((error) => error.code === 'unresolved_creator_refs'));
});
