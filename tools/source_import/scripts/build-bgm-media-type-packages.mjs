#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractPackageWorks } from './build-bgm-work-entity-link-plan.mjs';

export const MEDIA_TYPE_PACKAGE_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  packagePreview: 'data_local/payload/bangumi-media-work-package-preview.json',
  outDir: 'data_local/payload/bgm-media-type-packages',
  reportMarkdown: 'data_local/reports/bgm-media-type-packages.md',
  reportJson: 'data_local/reports/bgm-media-type-packages.json',
};

export const MODE = 'local-media-type-package-preview/no-payload-reads/no-payload-writes/no-external-fetch/no-media-upload';

export const MEDIA_TYPE_KEYS = ['manga', 'novel', 'game', 'anime', 'other'];

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function resolveFromRoot(repoRoot, maybeRelative) {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(repoRoot, maybeRelative);
}

function argvValue(name, fallback) {
  const argv = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return fallback;
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
}

function normalizeText(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function classifyMediaType(work) {
  const raw = normalizeText(firstValue(work?.mediaGroup, work?.mediaType, work?.type, work?.sourceWork?.mediaGroup, work?.sourceWork?.mediaType));
  if (!raw) return 'other';

  if (/漫画|manga|comic|コミック/.test(raw)) return 'manga';
  if (/小说|小説|novel|book|literature|light novel|ライトノベル/.test(raw)) return 'novel';
  if (/游戏|遊戲|game|galgame|visual novel|vn/.test(raw)) return 'game';
  if (/动画|動畫|anime|animation|アニメ/.test(raw)) return 'anime';
  return 'other';
}

function compactWork(work, index) {
  return {
    packageIndex: index,
    title: work?.title ?? '',
    slug: work?.slug,
    mediaGroup: work?.mediaGroup,
    mediaType: work?.mediaType,
    bangumiSubjectId: work?.bangumiSubjectId ?? work?.sourceCandidate?.bangumiSubjectId ?? work?.sourceWork?.bangumiSubjectId,
    status: work?.status,
    startDate: work?.startDate,
    rating: work?.rating,
    tags: Array.isArray(work?.tags) ? work.tags : [],
    aliases: Array.isArray(work?.aliases) ? work.aliases : [],
    summary: work?.summary ?? '',
    coverPreview: work?.coverPreview,
    creatorCreditHints: Array.isArray(work?.creatorCreditHints) ? work.creatorCreditHints : [],
    organizationCreditHints: Array.isArray(work?.organizationCreditHints) ? work.organizationCreditHints : [],
    sourceCandidate: work?.sourceCandidate,
    evidence: Array.isArray(work?.evidence) ? work.evidence : [],
  };
}

export function buildMediaTypePackages(packagePreview) {
  const works = extractPackageWorks(packagePreview);
  const buckets = Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [key, []]));
  const warnings = [];

  works.forEach((work, index) => {
    const mediaType = classifyMediaType(work);
    const item = compactWork(work, index);
    buckets[mediaType].push(item);
    if (mediaType === 'other') warnings.push({ code: 'media_type_other', message: `Could not classify media type for ${index + 1}: ${work?.title ?? '(untitled)'}.`, index, title: work?.title ?? '' });
  });

  const generatedAt = new Date().toISOString();
  const packages = Object.fromEntries(Object.entries(buckets).map(([mediaType, items]) => [mediaType, {
    schemaVersion: MEDIA_TYPE_PACKAGE_SCHEMA_VERSION,
    generatedAt,
    mode: MODE,
    mediaType,
    source: DEFAULT_PATHS.packagePreview,
    counts: {
      worksTotal: items.length,
      creatorCreditHintsTotal: items.reduce((sum, item) => sum + item.creatorCreditHints.length, 0),
      organizationCreditHintsTotal: items.reduce((sum, item) => sum + item.organizationCreditHints.length, 0),
      coverPreviewTotal: items.filter((item) => item.coverPreview).length,
    },
    works: items,
  }]));

  const report = {
    schemaVersion: MEDIA_TYPE_PACKAGE_SCHEMA_VERSION,
    generatedAt,
    mode: MODE,
    status: warnings.length === 0 ? 'ready' : 'ready-with-warnings',
    counts: {
      worksTotal: works.length,
      ...Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [`${key}WorksTotal`, packages[key].counts.worksTotal])),
      warningsTotal: warnings.length,
    },
    warnings,
    outputs: Object.fromEntries(MEDIA_TYPE_KEYS.map((key) => [key, `data_local/payload/bgm-media-type-packages/bangumi-${key}-package-preview.json`])),
  };

  return { packages, report };
}

export function renderMediaTypePackageReport(report) {
  const lines = [];
  lines.push('# BGM Media Type Packages');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- status: ${report.status}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| key | value |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(report.counts)) lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push('## Outputs');
  lines.push('');
  for (const [key, value] of Object.entries(report.outputs)) lines.push(`- ${key}: \`${value}\``);

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    for (const warning of report.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
  }

  lines.push('');
  lines.push('## Boundary');
  lines.push('');
  lines.push('- local preview only');
  lines.push('- no Payload reads');
  lines.push('- no Payload writes');
  lines.push('- no external fetch');
  lines.push('- no media upload');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const packagePreviewPath = resolveFromRoot(repoRoot, argvValue('package', DEFAULT_PATHS.packagePreview));
  const outDir = resolveFromRoot(repoRoot, argvValue('out-dir', DEFAULT_PATHS.outDir));
  const reportJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.reportJson));
  const reportMarkdownPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.reportMarkdown));

  const packagePreview = await readJson(packagePreviewPath);
  const { packages, report } = buildMediaTypePackages(packagePreview);

  for (const [mediaType, payload] of Object.entries(packages)) {
    await writeJson(path.join(outDir, `bangumi-${mediaType}-package-preview.json`), payload);
  }
  await writeJson(reportJsonPath, report);
  await writeText(reportMarkdownPath, renderMediaTypePackageReport(report));

  console.log(`Media package status: ${report.status}`);
  console.log(`works=${report.counts.worksTotal}; manga=${report.counts.mangaWorksTotal}; novel=${report.counts.novelWorksTotal}; game=${report.counts.gameWorksTotal}; anime=${report.counts.animeWorksTotal}; other=${report.counts.otherWorksTotal}; warnings=${report.counts.warningsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportMarkdownPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
