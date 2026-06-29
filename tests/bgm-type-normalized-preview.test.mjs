import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNormalizedTypePreview,
  normalizeGameWork,
  normalizeMangaWork,
  normalizeNovelWork,
  renderNormalizedTypeReport,
} from '../tools/source_import/scripts/build-bgm-type-normalized-preview.mjs';

test('normalizes manga credit hints into typed fields', () => {
  const work = normalizeMangaWork({
    packageIndex: 0,
    title: 'Manga A',
    bangumiSubjectId: '1',
    creatorCreditHints: [
      { name: 'Alice', role: 'original_creator', originalRole: '作者' },
      { name: 'Bob', role: 'artist', originalRole: '作画' },
    ],
    organizationCreditHints: [
      { name: 'Pub', role: 'publisher', originalRole: '出版社' },
      { name: 'Magazine', role: 'magazine', originalRole: '连载杂志' },
    ],
  });

  assert.deepEqual(work.authors, ['Alice']);
  assert.deepEqual(work.artists, ['Bob']);
  assert.deepEqual(work.publishers, ['Pub']);
  assert.deepEqual(work.magazines, ['Magazine']);
});

test('normalizes game credit hints and platform-like hints', () => {
  const work = normalizeGameWork({
    packageIndex: 1,
    title: 'Game A',
    bangumiSubjectId: '2',
    creatorCreditHints: [
      { name: 'Writer', role: 'scenario' },
      { name: 'Artist', role: 'illustrator' },
    ],
    organizationCreditHints: [
      { name: 'Dev', role: 'developer' },
      { name: 'Pub', role: 'publisher' },
      { name: 'PC', role: 'platform' },
    ],
  });

  assert.deepEqual(work.developers, ['Dev']);
  assert.deepEqual(work.publishers, ['Pub']);
  assert.deepEqual(work.platforms, ['PC']);
  assert.deepEqual(work.scenarioWriters, ['Writer']);
  assert.deepEqual(work.illustrators, ['Artist']);
});

test('normalizes novel credit hints into typed fields', () => {
  const work = normalizeNovelWork({
    packageIndex: 2,
    title: 'Novel A',
    bangumiSubjectId: '3',
    creatorCreditHints: [
      { name: 'Author', role: 'author' },
      { name: 'Illust', role: 'illustrator' },
    ],
    organizationCreditHints: [
      { name: 'Pub', role: 'publisher' },
      { name: 'Label', role: 'label' },
    ],
  });

  assert.deepEqual(work.authors, ['Author']);
  assert.deepEqual(work.illustrators, ['Illust']);
  assert.deepEqual(work.publishers, ['Pub']);
  assert.deepEqual(work.labels, ['Label']);
});

test('builds normalized packages and report counts', () => {
  const { packages, report } = buildNormalizedTypePreview({
    manga: { works: [{ title: 'Manga A', bangumiSubjectId: '1', creatorCreditHints: [{ name: 'Alice', role: 'author' }], organizationCreditHints: [] }] },
    game: { works: [{ title: 'Game A', bangumiSubjectId: '2', organizationCreditHints: [{ name: 'Dev', role: 'developer' }] }] },
    novel: { works: [] },
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.counts.worksTotal, 2);
  assert.equal(report.counts.mangaWorksTotal, 1);
  assert.equal(report.counts.gameWorksTotal, 1);
  assert.equal(report.counts.novelWorksTotal, 0);
  assert.equal(packages.manga.works[0].authors[0], 'Alice');
  assert.equal(packages.game.works[0].developers[0], 'Dev');
});

test('renders normalized report markdown', () => {
  const { report } = buildNormalizedTypePreview({ manga: { works: [] }, game: { works: [] }, novel: { works: [] } });
  const markdown = renderNormalizedTypeReport(report);

  assert.match(markdown, /# BGM Type Normalized Preview/);
  assert.match(markdown, /mangaWorksTotal/);
  assert.match(markdown, /bangumi-manga-normalized-preview\.json/);
});
