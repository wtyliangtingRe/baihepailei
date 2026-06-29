#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIELD_PLAN_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  normalizedDir: 'data_local/payload/bgm-type-normalized-preview',
  linkPlanJson: 'data_local/payload/bgm-work-entity-link-plan.json',
  outJson: 'data_local/payload/bgm-work-field-plan.json',
  outMarkdown: 'data_local/reports/bgm-work-field-plan.md',
};

export const MODE = 'local-work-field-plan/no-payload-read/no-payload-write';
export const MEDIA_TYPES = ['manga', 'game', 'novel'];

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeText(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase();
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of asArray(values)) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = normalizeText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sourceKeysForSubject(value) {
  if (!hasValue(value)) return [];
  const text = String(value).trim();
  const numeric = text.replace(/^bangumi-|^bgm-|^subject-/i, '');
  return uniqueStrings([text, numeric, `bangumi-${numeric}`, `bgm-${numeric}`, `subject-${numeric}`]);
}

function relationId(value) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') return relationId(value.id ?? value.payloadId ?? value.value);
  const text = String(value).trim();
  if (!text) return undefined;
  return /^\d+$/.test(text) ? Number(text) : text;
}

export function buildWorkLookup(linkPlan) {
  const byKey = new Map();
  const byTitle = new Map();
  const ambiguousTitleKeys = new Set();
  for (const item of asArray(linkPlan?.items)) {
    const payloadId = relationId(item?.work?.payloadId);
    if (payloadId === undefined) continue;
    const sourceKeys = asArray(item?.work?.sourceKeys);
    const keys = uniqueStrings([
      item?.work?.siteId,
      item?.work?.bangumiSubjectId,
      ...sourceKeys,
      ...sourceKeys.flatMap(sourceKeysForSubject),
      ...sourceKeysForSubject(item?.work?.bangumiSubjectId),
      ...sourceKeysForSubject(item?.work?.siteId),
    ]);
    for (const key of keys) byKey.set(normalizeText(key), payloadId);
    if (item?.work?.title) {
      const titleKey = normalizeText(item.work.title);
      const existing = byTitle.get(titleKey);
      if (existing !== undefined && existing !== payloadId) ambiguousTitleKeys.add(titleKey);
      else byTitle.set(titleKey, payloadId);
    }
  }
  for (const titleKey of ambiguousTitleKeys) byTitle.delete(titleKey);
  return { byKey, byTitle, ambiguousTitleKeys };
}

function lookupPayloadId(work, lookup) {
  const keys = uniqueStrings([
    work?.bangumiSubjectId,
    ...sourceKeysForSubject(work?.bangumiSubjectId),
  ]);
  for (const key of keys) {
    const found = lookup.byKey.get(normalizeText(key));
    if (found !== undefined) return found;
  }
  if (work?.title) return lookup.byTitle.get(normalizeText(work.title));
  return undefined;
}

function precisionForDateLabel(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'day';
  if (/^\d{4}-\d{2}$/.test(text)) return 'month';
  if (/^\d{4}$/.test(text)) return 'year';
  return 'unknown';
}

function machineDateFromLabel(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01T00:00:00.000Z`;
  if (/^\d{4}$/.test(text)) return `${text}-01-01T00:00:00.000Z`;
  return undefined;
}

function inferFormat(work) {
  if (work.mediaType === 'manga') return 'manga_series';
  if (work.mediaType === 'novel') return 'novel_series';
  if (work.mediaType === 'game') {
    const platformText = uniqueStrings(work.platforms).map(normalizeText).join('|');
    if (/pc|windows|mac|linux|web/.test(platformText)) return 'pc_game';
    return 'unknown';
  }
  return 'unknown';
}

function payloadMediaType(mediaType) {
  if (mediaType === 'manga') return 'manga';
  if (mediaType === 'novel') return 'novel';
  if (mediaType === 'game') return 'game';
  return 'unknown';
}

function aliasesRows(values) {
  return uniqueStrings(values).map((value) => ({ value }));
}

function candidateSources(work) {
  if (!hasValue(work.bangumiSubjectId)) return [];
  return [{ source: 'bangumi', label: 'Bangumi', externalId: String(work.bangumiSubjectId), note: 'Generated from local BGM normalized preview.' }];
}

function searchTextFor(work) {
  const names = [
    work.title,
    ...asArray(work.aliases),
    ...asArray(work.tags),
    ...asArray(work.authors),
    ...asArray(work.artists),
    ...asArray(work.illustrators),
    ...asArray(work.publishers),
    ...asArray(work.magazines),
    ...asArray(work.developers),
    ...asArray(work.platforms),
    ...asArray(work.scenarioWriters),
  ];
  return uniqueStrings(names).join('\n');
}

export function buildWorkFieldPatch(work) {
  const firstPublishedLabel = hasValue(work.startDate) ? String(work.startDate) : undefined;
  return compactObject({
    mediaGroup: payloadMediaType(work.mediaType),
    mediaType: payloadMediaType(work.mediaType),
    format: inferFormat(work),
    firstPublishedAt: machineDateFromLabel(firstPublishedLabel),
    firstPublishedPrecision: firstPublishedLabel ? precisionForDateLabel(firstPublishedLabel) : undefined,
    firstPublishedLabel,
    externalIds: hasValue(work.bangumiSubjectId) ? { bangumiSubjectId: String(work.bangumiSubjectId) } : undefined,
    candidateSources: candidateSources(work),
    aliases: aliasesRows(work.aliases),
    searchText: searchTextFor(work),
  });
}

export function buildWorkFieldPlan(normalizedPackages, linkPlan) {
  const lookup = buildWorkLookup(linkPlan);
  const items = [];
  const errors = [];

  for (const mediaType of MEDIA_TYPES) {
    for (const work of asArray(normalizedPackages?.[mediaType]?.works)) {
      const payloadId = lookupPayloadId(work, lookup);
      const item = {
        work: {
          payloadId,
          title: work.title ?? '',
          mediaType,
          bangumiSubjectId: work.bangumiSubjectId,
        },
        patch: buildWorkFieldPatch({ ...work, mediaType }),
        warnings: [],
        errors: [],
      };
      if (payloadId === undefined) {
        item.errors.push({ code: 'payload_id_missing', message: `Could not match Payload work for ${work.title ?? '(untitled)'}.` });
      }
      if (!item.patch.searchText) item.warnings.push({ code: 'search_text_empty', message: 'Search text is empty.' });
      item.errors.forEach((error) => errors.push({ ...error, title: item.work.title, mediaType }));
      items.push(item);
    }
  }

  const counts = {
    worksTotal: items.length,
    mangaWorksTotal: items.filter((item) => item.work.mediaType === 'manga').length,
    gameWorksTotal: items.filter((item) => item.work.mediaType === 'game').length,
    novelWorksTotal: items.filter((item) => item.work.mediaType === 'novel').length,
    missingPayloadIdTotal: items.filter((item) => item.work.payloadId === undefined).length,
    warningsTotal: items.reduce((sum, item) => sum + item.warnings.length, 0),
    errorsTotal: errors.length,
  };

  return {
    schemaVersion: FIELD_PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: MODE,
    status: errors.length === 0 ? 'ready' : 'needs-review',
    counts,
    errors,
    items,
  };
}

export function renderWorkFieldPlanMarkdown(plan) {
  const lines = [];
  lines.push('# BGM Work Field Plan');
  lines.push('');
  lines.push(`- generatedAt: ${plan.generatedAt}`);
  lines.push(`- mode: ${plan.mode}`);
  lines.push(`- status: ${plan.status}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| key | value |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(plan.counts)) lines.push(`| ${key} | ${value} |`);
  if (plan.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const error of plan.errors) lines.push(`- ${error.code}: ${error.title ?? ''}`);
  }
  lines.push('');
  lines.push('## Planned fields');
  lines.push('');
  lines.push('- mediaGroup');
  lines.push('- mediaType');
  lines.push('- format');
  lines.push('- firstPublishedAt / firstPublishedPrecision / firstPublishedLabel');
  lines.push('- externalIds.bangumiSubjectId');
  lines.push('- candidateSources');
  lines.push('- aliases');
  lines.push('- searchText');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function loadNormalizedPackages(normalizedDir) {
  const packages = {};
  for (const mediaType of MEDIA_TYPES) {
    packages[mediaType] = await readJson(path.join(normalizedDir, `bangumi-${mediaType}-normalized-preview.json`));
  }
  return packages;
}

async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const normalizedDir = resolveFromRoot(repoRoot, argvValue('normalized-dir', DEFAULT_PATHS.normalizedDir));
  const linkPlanPath = resolveFromRoot(repoRoot, argvValue('link-plan', DEFAULT_PATHS.linkPlanJson));
  const outJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.outJson));
  const outMarkdownPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.outMarkdown));

  const normalizedPackages = await loadNormalizedPackages(normalizedDir);
  const linkPlan = await readJson(linkPlanPath);
  const plan = buildWorkFieldPlan(normalizedPackages, linkPlan);

  await writeJson(outJsonPath, plan);
  await writeText(outMarkdownPath, renderWorkFieldPlanMarkdown(plan));

  console.log(`Work field plan status: ${plan.status}`);
  console.log(`works=${plan.counts.worksTotal}; manga=${plan.counts.mangaWorksTotal}; game=${plan.counts.gameWorksTotal}; novel=${plan.counts.novelWorksTotal}; missing=${plan.counts.missingPayloadIdTotal}; warnings=${plan.counts.warningsTotal}; errors=${plan.counts.errorsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, outJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMarkdownPath)}`);
  if (plan.status !== 'ready') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
