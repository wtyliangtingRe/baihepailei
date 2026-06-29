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

test('extracts Bangumi credit hint arrays and deduplicates nested sourceWork hints', () => {
  const packagePreview = {
    works: [
      {
        bangumiSubjectId: '21096',
        title: '百合星人奈绪子美眉',
        creatorCreditHints: [
          { name: 'kashmir', role: 'original_creator', originalRole: '作者' },
        ],
        organizationCreditHints: [
          { name: 'メディアワークス→アスキー・メディアワークス→KADOKAWA', role: 'publisher', originalRole: '出版社' },
          { name: '月刊コミック電撃大王', role: 'magazine', originalRole: '连载杂志' },
        ],
        sourceWork: {
          creatorCreditHints: [
            { name: 'kashmir', role: 'original_creator', originalRole: '作者' },
          ],
          organizationCreditHints: [
            { name: 'メディアワークス→アスキー・メディアワークス→KADOKAWA', role: 'publisher', originalRole: '出版社' },
            { name: '月刊コミック電撃大王', role: 'magazine', originalRole: '连载杂志' },
          ],
        },
      },
    ],
  };

  const idMap = {
    works: [{ bangumiSubjectId: '21096', title: '百合星人奈绪子美眉', payloadId: 101 }],
    creators: [{ name: 'kashmir', payloadId: 201 }],
    organizations: [
      { name: 'メディアワークス→アスキー・メディアワークス→KADOKAWA', payloadId: 301 },
      { name: '月刊コミック電撃大王', payloadId: 302 },
    ],
  };

  const creatorRefs = extractEntityRefsFromWork(packagePreview.works[0], 'creators');
  const organizationRefs = extractEntityRefsFromWork(packagePreview.works[0], 'organizations');

  assert.equal(creatorRefs.length, 1);
  assert.equal(creatorRefs[0].name, 'kashmir');
  assert.equal(organizationRefs.length, 2);

  const plan = buildWorkEntityLinkPlan(packagePreview, idMap);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.items[0].links.creators, [201]);
  assert.deepEqual(plan.items[0].links.organizations, [301, 302]);
  assert.equal(plan.items[0].links.creatorCredits.length, 1);
  assert.equal(plan.items[0].links.organizationCredits.length, 2);

  const audit = auditWorkEntityLinkPlan(plan);
  assert.equal(audit.status, 'pass');
});

test('ignores platform-like organization hints and collision metadata', () => {
  const packagePreview = {
    works: [
      {
        bangumiSubjectId: '1',
        title: 'Work A',
        creatorCreditHints: [
          { name: 'kashmir', role: 'original_creator', originalRole: '作者' },
        ],
        organizationCreditHints: [
          { name: '小学館', role: 'publisher', originalRole: '出版社' },
          { name: 'PC', role: 'platform', originalRole: '平台' },
          { name: 'Web', role: 'platform', originalRole: '平台' },
        ],
      },
    ],
  };

  const idMap = {
    works: [{ bangumiSubjectId: '1', title: 'Work A', payloadId: 101 }],
    creators: [{ name: 'kashmir', payloadId: 201 }],
    organizations: [{ name: '小学館', payloadId: 301 }],
    entityNameCollisionRows: [
      { collection: 'creators', name: 'kashmir', payloadId: 999 },
      { collection: 'organizations', name: '小学館', payloadId: 998 },
    ],
  };

  const plan = buildWorkEntityLinkPlan(packagePreview, idMap);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.items[0].links.creators, [201]);
  assert.deepEqual(plan.items[0].links.organizations, [301]);
  assert.equal(plan.counts.unresolvedOrganizationRefsTotal, 0);
  assert.equal(plan.counts.ambiguousCreatorRefsTotal, 0);
  assert.equal(plan.counts.ambiguousOrganizationRefsTotal, 0);

  const audit = auditWorkEntityLinkPlan(plan);
  assert.equal(audit.status, 'pass');
});
