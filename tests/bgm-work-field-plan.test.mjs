import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkFieldPatch,
  buildWorkFieldPlan,
  buildWorkLookup,
  renderWorkFieldPlanMarkdown,
} from '../tools/source_import/scripts/build-bgm-work-field-plan.mjs';

function linkPlan() {
  return {
    schemaVersion: 1,
    status: 'ready',
    items: [
      { work: { payloadId: 101, title: 'Manga A', bangumiSubjectId: '1', siteId: 'bangumi-1' } },
      { work: { payloadId: 102, title: 'Game A', bangumiSubjectId: '2', siteId: 'bangumi-2' } },
    ],
  };
}

function normalizedPackages() {
  return {
    manga: {
      works: [
        {
          title: 'Manga A',
          mediaType: 'manga',
          bangumiSubjectId: '1',
          startDate: '2020-05',
          aliases: ['Alias A'],
          tags: ['百合'],
          authors: ['Alice'],
          publishers: ['Pub'],
          magazines: ['Mag'],
        },
      ],
    },
    game: {
      works: [
        {
          title: 'Game A',
          mediaType: 'game',
          bangumiSubjectId: '2',
          startDate: '2021-06-07',
          aliases: ['Game Alias'],
          developers: ['Dev'],
          platforms: ['PC'],
          scenarioWriters: ['Writer'],
        },
      ],
    },
    novel: { works: [] },
  };
}

test('builds lookup from link plan subject keys and titles', () => {
  const lookup = buildWorkLookup(linkPlan());
  assert.equal(lookup.byKey.get('1'), 101);
  assert.equal(lookup.byKey.get('bangumi-2'), 102);
  assert.equal(lookup.byTitle.get('manga a'), 101);
});

test('builds lookup from link plan source keys and ignores ambiguous duplicate titles', () => {
  const lookup = buildWorkLookup({
    items: [
      { work: { payloadId: 1002, title: '百合少女', sourceKeys: ['215568', 'bangumi-215568'] } },
      { work: { payloadId: 1003, title: '百合少女', sourceKeys: ['215570', 'bangumi-215570'] } },
    ],
  });

  assert.equal(lookup.byKey.get('215568'), 1002);
  assert.equal(lookup.byKey.get('bangumi-215570'), 1003);
  assert.equal(lookup.byTitle.has('百合少女'), false);
});

test('builds a safe field patch for manga work', () => {
  const patch = buildWorkFieldPatch(normalizedPackages().manga.works[0]);

  assert.equal(patch.mediaGroup, 'manga');
  assert.equal(patch.mediaType, 'manga');
  assert.equal(patch.format, 'manga_series');
  assert.equal(patch.firstPublishedPrecision, 'month');
  assert.equal(patch.firstPublishedAt, '2020-05-01T00:00:00.000Z');
  assert.deepEqual(patch.externalIds, { bangumiSubjectId: '1' });
  assert.deepEqual(patch.aliases, [{ value: 'Alias A' }]);
  assert.match(patch.searchText, /Alice/);
  assert.match(patch.searchText, /百合/);
});

test('infers pc game format and day precision', () => {
  const patch = buildWorkFieldPatch(normalizedPackages().game.works[0]);

  assert.equal(patch.mediaGroup, 'game');
  assert.equal(patch.mediaType, 'game');
  assert.equal(patch.format, 'pc_game');
  assert.equal(patch.firstPublishedPrecision, 'day');
  assert.equal(patch.firstPublishedAt, '2021-06-07T00:00:00.000Z');
  assert.match(patch.searchText, /Dev/);
  assert.match(patch.searchText, /PC/);
});

test('builds full field plan with Payload work ids', () => {
  const plan = buildWorkFieldPlan(normalizedPackages(), linkPlan());

  assert.equal(plan.status, 'ready');
  assert.equal(plan.counts.worksTotal, 2);
  assert.equal(plan.counts.mangaWorksTotal, 1);
  assert.equal(plan.counts.gameWorksTotal, 1);
  assert.equal(plan.counts.novelWorksTotal, 0);
  assert.equal(plan.counts.missingPayloadIdTotal, 0);
  assert.equal(plan.items[0].work.payloadId, 101);
  assert.equal(plan.items[1].work.payloadId, 102);
});

test('builds duplicate-title field plan using Bangumi subject source keys', () => {
  const packages = {
    manga: {
      works: [
        { title: '百合少女', mediaType: 'manga', bangumiSubjectId: '215568', publishers: ['コスミック出版'] },
        { title: '百合少女', mediaType: 'manga', bangumiSubjectId: '215570', publishers: ['コスミック出版'] },
      ],
    },
    game: { works: [] },
    novel: { works: [] },
  };
  const plan = buildWorkFieldPlan(packages, {
    items: [
      { work: { payloadId: 1002, title: '百合少女', sourceKeys: ['215568', 'bangumi-215568'] } },
      { work: { payloadId: 1003, title: '百合少女', sourceKeys: ['215570', 'bangumi-215570'] } },
    ],
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.items[0].work.payloadId, 1002);
  assert.equal(plan.items[1].work.payloadId, 1003);
});

test('marks plan needs-review when a work cannot be matched', () => {
  const packages = normalizedPackages();
  packages.game.works[0].bangumiSubjectId = '999';
  packages.game.works[0].title = 'Missing Game';

  const plan = buildWorkFieldPlan(packages, linkPlan());
  assert.equal(plan.status, 'needs-review');
  assert.equal(plan.counts.missingPayloadIdTotal, 1);
  assert.equal(plan.errors[0].code, 'payload_id_missing');
});

test('renders markdown report', () => {
  const markdown = renderWorkFieldPlanMarkdown(buildWorkFieldPlan(normalizedPackages(), linkPlan()));
  assert.match(markdown, /# BGM Work Field Plan/);
  assert.match(markdown, /worksTotal/);
  assert.match(markdown, /searchText/);
});
