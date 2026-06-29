#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CLEAN_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-field-plan.json',
  reportJson: 'data_local/reports/bgm-work-field-plan-text-clean.json',
  reportMarkdown: 'data_local/reports/bgm-work-field-plan-text-clean.md',
};

export const MODE = 'local-field-plan-text-clean/no-remote-read/no-remote-write';

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
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
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

function normalizeText(value) {
  return String(value ?? '').trim().normalize('NFKC').toLowerCase();
}

function textCandidates(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item) => textCandidates(item));
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];
  for (const key of ['value', 'name', 'title', 'label', 'originalTitle', 'slug']) {
    const found = textCandidates(value[key]);
    if (found.length > 0) return found;
  }
  return [];
}

function uniqueTexts(values) {
  const seen = new Set();
  const out = [];
  for (const value of asArray(values)) {
    for (const candidate of textCandidates(value)) {
      const text = String(candidate ?? '').trim();
      if (!text || text === '[object Object]') continue;
      const key = normalizeText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function cleanAliases(aliases) {
  return uniqueTexts(aliases).map((value) => ({ value }));
}

function cleanSearchText(value) {
  return uniqueTexts(String(value ?? '').split(/\r?\n/u)).join('\n');
}

export function cleanWorkFieldPlan(plan) {
  const items = asArray(plan?.items);
  const changes = [];
  const cleanedItems = items.map((item, index) => {
    const patch = { ...(item.patch ?? {}) };
    const beforeAliases = JSON.stringify(patch.aliases ?? []);
    const beforeSearchText = String(patch.searchText ?? '');

    patch.aliases = cleanAliases(patch.aliases);
    patch.searchText = cleanSearchText(patch.searchText);

    const afterAliases = JSON.stringify(patch.aliases ?? []);
    const afterSearchText = String(patch.searchText ?? '');
    if (beforeAliases !== afterAliases || beforeSearchText !== afterSearchText) {
      changes.push({ index, title: item?.work?.title ?? '', beforeAliases, afterAliases, searchTextChanged: beforeSearchText !== afterSearchText });
    }
    return { ...item, patch };
  });

  const cleaned = {
    ...plan,
    generatedAt: new Date().toISOString(),
    items: cleanedItems,
  };
  const objectStringItems = cleanedItems.filter((item) => JSON.stringify(item.patch ?? {}).includes('[object Object]'));
  cleaned.counts = {
    ...(cleaned.counts ?? {}),
    textCleanChangesTotal: changes.length,
    objectStringItemsTotal: objectStringItems.length,
  };
  cleaned.status = objectStringItems.length === 0 && asArray(cleaned.errors).length === 0 ? 'ready' : 'needs-review';

  return {
    cleaned,
    report: {
      schemaVersion: CLEAN_SCHEMA_VERSION,
      generatedAt: cleaned.generatedAt,
      mode: MODE,
      status: objectStringItems.length === 0 ? 'pass' : 'fail',
      counts: {
        itemsTotal: cleanedItems.length,
        changedItemsTotal: changes.length,
        objectStringItemsTotal: objectStringItems.length,
      },
      changes,
    },
  };
}

export function renderCleanReportMarkdown(report) {
  const lines = ['# BGM Work Field Plan Text Clean', '', `- generatedAt: ${report.generatedAt}`, `- mode: ${report.mode}`, `- status: ${report.status}`, '', '## Counts', '', '| key | value |', '| --- | ---: |'];
  for (const [key, value] of Object.entries(report.counts)) lines.push(`| ${key} | ${value} |`);
  lines.push('', '## Changed items', '');
  if (report.changes.length === 0) lines.push('- none');
  else for (const change of report.changes.slice(0, 100)) lines.push(`- ${change.index}: ${change.title}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const planPath = resolveFromRoot(repoRoot, argvValue('plan', DEFAULT_PATHS.planJson));
  const reportJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.reportJson));
  const reportMdPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.reportMarkdown));

  const plan = await readJson(planPath);
  const { cleaned, report } = cleanWorkFieldPlan(plan);
  await writeJson(planPath, cleaned);
  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, renderCleanReportMarkdown(report));

  console.log(`Field plan text clean status: ${report.status}`);
  console.log(`items=${report.counts.itemsTotal}; changed=${report.counts.changedItemsTotal}; objectStringItems=${report.counts.objectStringItemsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, planPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportMdPath)}`);
  if (report.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
