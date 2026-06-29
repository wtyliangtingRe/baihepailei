import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMediaTypePackages,
  classifyMediaType,
  renderMediaTypePackageReport,
} from '../tools/source_import/scripts/build-bgm-media-type-packages.mjs';

test('classifies common media types', () => {
  assert.equal(classifyMediaType({ mediaGroup: 'manga' }), 'manga');
  assert.equal(classifyMediaType({ mediaType: '小说' }), 'novel');
  assert.equal(classifyMediaType({ mediaType: 'game' }), 'game');
  assert.equal(classifyMediaType({ mediaType: '动画' }), 'anime');
  assert.equal(classifyMediaType({ mediaType: 'unknown-kind' }), 'other');
});

test('builds packages from work preview items', () => {
  const preview = {
    works: [
      {
        title: 'Manga A',
        mediaGroup: 'manga',
        bangumiSubjectId: '1',
        creatorCreditHints: [{ name: 'Alice', role: 'author' }],
        organizationCreditHints: [{ name: 'Pub', role: 'publisher' }],
        coverPreview: { available: true },
      },
      { title: 'Novel A', mediaType: '小说', bangumiSubjectId: '2' },
      { title: 'Game A', mediaType: 'game', bangumiSubjectId: '3' },
      { title: 'Anime A', mediaType: 'anime', bangumiSubjectId: '4' },
      { title: 'Other A', mediaType: 'misc', bangumiSubjectId: '5' },
    ],
  };

  const { packages, report } = buildMediaTypePackages(preview);

  assert.equal(report.status, 'ready-with-warnings');
  assert.equal(report.counts.worksTotal, 5);
  assert.equal(report.counts.mangaWorksTotal, 1);
  assert.equal(report.counts.novelWorksTotal, 1);
  assert.equal(report.counts.gameWorksTotal, 1);
  assert.equal(report.counts.animeWorksTotal, 1);
  assert.equal(report.counts.otherWorksTotal, 1);
  assert.equal(report.counts.warningsTotal, 1);

  assert.equal(packages.manga.works[0].title, 'Manga A');
  assert.equal(packages.manga.works[0].packageIndex, 0);
  assert.equal(packages.manga.counts.creatorCreditHintsTotal, 1);
  assert.equal(packages.manga.counts.organizationCreditHintsTotal, 1);
  assert.equal(packages.manga.counts.coverPreviewTotal, 1);
  assert.equal(packages.novel.works[0].bangumiSubjectId, '2');
  assert.equal(packages.game.works[0].title, 'Game A');
  assert.equal(packages.anime.works[0].title, 'Anime A');
  assert.equal(packages.other.works[0].title, 'Other A');
});

test('supports nested sourceWork media type fallback', () => {
  const { packages, report } = buildMediaTypePackages({
    works: [{ title: 'Nested Game', sourceWork: { mediaType: '游戏' } }],
  });

  assert.equal(report.counts.gameWorksTotal, 1);
  assert.equal(packages.game.works[0].title, 'Nested Game');
});

test('renders markdown report with outputs', () => {
  const { report } = buildMediaTypePackages({ works: [{ title: 'Manga A', mediaType: 'manga' }] });
  const markdown = renderMediaTypePackageReport(report);

  assert.match(markdown, /# BGM Media Type Packages/);
  assert.match(markdown, /mangaWorksTotal/);
  assert.match(markdown, /bangumi-manga-package-preview\.json/);
});
