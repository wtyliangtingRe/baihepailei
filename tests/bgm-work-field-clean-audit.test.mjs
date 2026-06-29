import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanWorkFieldPlan } from '../tools/source_import/scripts/clean-bgm-work-field-plan-text.mjs';
import { compareFieldReadbackItem } from '../tools/source_import/scripts/audit-bgm-work-field-readback.mjs';

function planItem() {
  return {
    work: { payloadId: 101, title: 'Manga A', mediaType: 'manga', bangumiSubjectId: '1' },
    patch: {
      mediaGroup: 'manga',
      mediaType: 'manga',
      format: 'manga_series',
      firstPublishedAt: '2020-05-01T00:00:00.000Z',
      firstPublishedPrecision: 'month',
      firstPublishedLabel: '2020-05',
      externalIds: { bangumiSubjectId: '1' },
      candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1' }],
      aliases: [{ value: { value: 'Alias A' } }, '[object Object]', { name: 'Alias B' }],
      searchText: 'Manga A\n[object Object]\nAlias A',
    },
  };
}

test('cleans object-like alias rows in field plan', () => {
  const { cleaned, report } = cleanWorkFieldPlan({ schemaVersion: 1, status: 'ready', items: [planItem()] });

  assert.equal(report.status, 'pass');
  assert.equal(report.counts.changedItemsTotal, 1);
  assert.deepEqual(cleaned.items[0].patch.aliases, [{ value: 'Alias A' }, { value: 'Alias B' }]);
  assert.equal(cleaned.items[0].patch.searchText, 'Manga A\nAlias A');
  assert.equal(JSON.stringify(cleaned).includes('[object Object]'), false);
});

test('field readback comparison detects object string issues', () => {
  const item = planItem();
  item.patch.aliases = [{ value: 'Alias A' }];
  item.patch.searchText = 'Manga A\nAlias A';

  const result = compareFieldReadbackItem(item, {
    mediaGroup: 'manga',
    mediaType: 'manga',
    format: 'manga_series',
    firstPublishedAt: '2020-05-01T00:00:00.000Z',
    firstPublishedPrecision: 'month',
    firstPublishedLabel: '2020-05',
    externalIds: { bangumiSubjectId: '1' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1' }],
    aliases: [{ value: '[object Object]' }],
    searchText: 'Manga A\n[object Object]',
  });

  assert.equal(result.matched, false);
  assert.deepEqual(result.objectIssues.sort(), ['alias_object_string', 'searchText_object_string']);
});

test('field readback comparison treats missing precision as Payload unknown default', () => {
  const item = planItem();
  delete item.patch.firstPublishedAt;
  delete item.patch.firstPublishedPrecision;
  delete item.patch.firstPublishedLabel;
  item.patch.aliases = [{ value: 'Alias A' }];
  item.patch.searchText = 'Manga A\nAlias A';

  const result = compareFieldReadbackItem(item, {
    mediaGroup: 'manga',
    mediaType: 'manga',
    format: 'manga_series',
    firstPublishedAt: null,
    firstPublishedPrecision: 'unknown',
    firstPublishedLabel: null,
    externalIds: { bangumiSubjectId: '1' },
    candidateSources: [{ source: 'bangumi', label: 'Bangumi', externalId: '1' }],
    aliases: [{ value: 'Alias A' }],
    searchText: 'Manga A\nAlias A',
  });

  assert.equal(result.matched, true);
  assert.deepEqual(result.mismatches, []);
});
