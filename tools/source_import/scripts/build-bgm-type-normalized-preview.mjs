#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NORMALIZED_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  packageDir: 'data_local/payload/bgm-media-type-packages',
  outDir: 'data_local/payload/bgm-type-normalized-preview',
  reportJson: 'data_local/reports/bgm-type-normalized-preview.json',
  reportMarkdown: 'data_local/reports/bgm-type-normalized-preview.md',
};

export const MODE = 'local-type-normalized-preview/no-payload-reads/no-payload-writes/no-external-fetch/no-media-upload';
export const MEDIA_TYPES = ['manga', 'game', 'novel'];

const PLATFORM_NAMES = new Set(['pc', 'web', 'mac os', 'linux', 'psp', 'windows', 'windows pc', 'android', 'ios', 'iphone', 'ipad']);

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '');
  return value === undefined || value === null || value === '' ? undefined : value;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function rolesOf(hint) {
  return uniqueStrings([hint?.role, hint?.originalRole, ...asArray(hint?.roles)]);
}

function hintNamesByRole(hints, patterns) {
  return uniqueStrings(asArray(hints).filter((hint) => {
    const roleText = rolesOf(hint).map(normalizeText).join('|');
    return patterns.some((pattern) => pattern.test(roleText));
  }).map((hint) => hint?.name));
}

function platformNamesFromOrgHints(hints) {
  return uniqueStrings(asArray(hints).filter((hint) => {
    const name = normalizeText(hint?.name);
    const roleText = rolesOf(hint).map(normalizeText).join('|');
    return PLATFORM_NAMES.has(name) || /platform|游戏平台|平台|対応機種/.test(roleText);
  }).map((hint) => hint?.name));
}

function commonFields(work, mediaType) {
  return {
    mediaType,
    packageIndex: work.packageIndex,
    title: work.title ?? '',
    slug: compact(work.slug),
    bangumiSubjectId: compact(work.bangumiSubjectId),
    status: compact(work.status),
    startDate: compact(work.startDate),
    rating: work.rating,
    aliases: uniqueStrings(work.aliases),
    tags: uniqueStrings(work.tags),
    summary: compact(work.summary),
    coverPreview: work.coverPreview,
    sourceCandidate: work.sourceCandidate,
  };
}

export function normalizeMangaWork(work) {
  const creators = work.creatorCreditHints;
  const orgs = work.organizationCreditHints;
  return {
    ...commonFields(work, 'manga'),
    authors: hintNamesByRole(creators, [/author|作者|原作|original/]),
    artists: hintNamesByRole(creators, [/artist|作画|illustrat|绘|畫/]),
    publishers: hintNamesByRole(orgs, [/publisher|出版社/]),
    magazines: hintNamesByRole(orgs, [/magazine|serial|連載|连载|雑誌|杂志/]),
    sourceCreditHints: { creators, organizations: orgs },
  };
}

export function normalizeGameWork(work) {
  const creators = work.creatorCreditHints;
  const orgs = work.organizationCreditHints;
  return {
    ...commonFields(work, 'game'),
    developers: hintNamesByRole(orgs, [/developer|开发|開発|制作|studio/]),
    publishers: hintNamesByRole(orgs, [/publisher|发行|發行|発売/]),
    platforms: platformNamesFromOrgHints(orgs),
    scenarioWriters: hintNamesByRole(creators, [/scenario|writer|剧本|劇本|脚本/]),
    illustrators: hintNamesByRole(creators, [/illustrat|原画|原畫|artist|美术|美術/]),
    sourceCreditHints: { creators, organizations: orgs },
  };
}

export function normalizeNovelWork(work) {
  const creators = work.creatorCreditHints;
  const orgs = work.organizationCreditHints;
  return {
    ...commonFields(work, 'novel'),
    authors: hintNamesByRole(creators, [/author|作者|原作|writer/]),
    illustrators: hintNamesByRole(creators, [/illustrat|插画|插畫|artist/]),
    publishers: hintNamesByRole(orgs, [/publisher|出版社/]),
    labels: hintNamesByRole(orgs, [/label|文库|文庫|レーベル/]),
    sourceCreditHints: { creators, organizations: orgs },
  };
}

export function normalizeWorkByType(work, mediaType) {
  if (mediaType === 'manga') return normalizeMangaWork(work);
  if (mediaType === 'game') return normalizeGameWork(work);
  if (mediaType === 'novel') return normalizeNovelWork(work);
  return commonFields(work, mediaType);
}

export function buildNormalizedTypePreview(mediaPackages) {
  const generatedAt = new Date().toISOString();
  const packages = {};
  const warnings = [];

  for (const mediaType of MEDIA_TYPES) {
    const sourcePackage = mediaPackages[mediaType] ?? { works: [] };
    const works = asArray(sourcePackage.works).map((work) => normalizeWorkByType(work, mediaType));
    const emptyKey = mediaType === 'game' ? 'developers' : 'authors';
    works.forEach((work) => {
      if (asArray(work[emptyKey]).length === 0) warnings.push({ code: `${mediaType}_${emptyKey}_empty`, mediaType, title: work.title, packageIndex: work.packageIndex });
    });

    packages[mediaType] = {
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      generatedAt,
      mode: MODE,
      mediaType,
      counts: {
        worksTotal: works.length,
        withSummaryTotal: works.filter((work) => work.summary).length,
        withCoverPreviewTotal: works.filter((work) => work.coverPreview).length,
      },
      works,
    };
  }

  const report = {
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    generatedAt,
    mode: MODE,
    status: 'ready',
    counts: {
      worksTotal: MEDIA_TYPES.reduce((sum, key) => sum + packages[key].counts.worksTotal, 0),
      mangaWorksTotal: packages.manga.counts.worksTotal,
      gameWorksTotal: packages.game.counts.worksTotal,
      novelWorksTotal: packages.novel.counts.worksTotal,
      warningsTotal: warnings.length,
    },
    warnings,
    outputs: Object.fromEntries(MEDIA_TYPES.map((key) => [key, `data_local/payload/bgm-type-normalized-preview/bangumi-${key}-normalized-preview.json`])),
  };

  return { packages, report };
}

export function renderNormalizedTypeReport(report) {
  const lines = [];
  lines.push('# BGM Type Normalized Preview');
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
    for (const warning of report.warnings.slice(0, 50)) lines.push(`- ${warning.code}: ${warning.title ?? ''}`);
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
  const packageDir = resolveFromRoot(repoRoot, argvValue('package-dir', DEFAULT_PATHS.packageDir));
  const outDir = resolveFromRoot(repoRoot, argvValue('out-dir', DEFAULT_PATHS.outDir));
  const reportJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.reportJson));
  const reportMarkdownPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.reportMarkdown));

  const mediaPackages = {};
  for (const mediaType of MEDIA_TYPES) {
    mediaPackages[mediaType] = await readJson(path.join(packageDir, `bangumi-${mediaType}-package-preview.json`));
  }

  const { packages, report } = buildNormalizedTypePreview(mediaPackages);
  for (const [mediaType, payload] of Object.entries(packages)) {
    await writeJson(path.join(outDir, `bangumi-${mediaType}-normalized-preview.json`), payload);
  }
  await writeJson(reportJsonPath, report);
  await writeText(reportMarkdownPath, renderNormalizedTypeReport(report));

  console.log(`Normalized type preview status: ${report.status}`);
  console.log(`works=${report.counts.worksTotal}; manga=${report.counts.mangaWorksTotal}; game=${report.counts.gameWorksTotal}; novel=${report.counts.novelWorksTotal}; warnings=${report.counts.warningsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportMarkdownPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
