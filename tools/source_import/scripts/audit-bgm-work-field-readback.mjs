#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AUDIT_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-field-plan.json',
  auditJson: 'data_local/reports/bgm-work-field-readback-audit.json',
  auditMarkdown: 'data_local/reports/bgm-work-field-readback-audit.md',
};

export const MODE = 'work-field-readback-audit/read-only/no-remote-write';
export const FIELD_KEYS = ['mediaGroup', 'mediaType', 'format', 'firstPublishedAt', 'firstPublishedPrecision', 'firstPublishedLabel', 'externalIds', 'candidateSources', 'aliases', 'searchText'];

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

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toISOString();
}

function normalizePrecision(value) {
  return hasValue(value) ? String(value).trim() : 'unknown';
}

function relationId(value) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') return relationId(value.id ?? value.value ?? value.doc?.id);
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}

function aliasValues(value) {
  return asArray(value).map((row) => String(row?.value ?? row ?? '').trim()).filter(Boolean).sort();
}

function sourceRows(value) {
  return asArray(value).map((row) => ({
    source: String(row?.source ?? '').trim(),
    label: String(row?.label ?? '').trim(),
    externalId: String(row?.externalId ?? '').trim(),
  })).filter((row) => row.source || row.label || row.externalId).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function expectedFieldsFromPlanItem(item) {
  const patch = item?.patch ?? {};
  return {
    mediaGroup: patch.mediaGroup ?? null,
    mediaType: patch.mediaType ?? null,
    format: patch.format ?? null,
    firstPublishedAt: normalizeDate(patch.firstPublishedAt),
    firstPublishedPrecision: normalizePrecision(patch.firstPublishedPrecision),
    firstPublishedLabel: patch.firstPublishedLabel ?? null,
    externalIds: { bangumiSubjectId: String(patch.externalIds?.bangumiSubjectId ?? '') },
    candidateSources: sourceRows(patch.candidateSources),
    aliases: aliasValues(patch.aliases),
    searchText: String(patch.searchText ?? ''),
  };
}

export function actualFieldsFromPayloadWork(work) {
  return {
    mediaGroup: work?.mediaGroup ?? null,
    mediaType: work?.mediaType ?? null,
    format: work?.format ?? null,
    firstPublishedAt: normalizeDate(work?.firstPublishedAt),
    firstPublishedPrecision: normalizePrecision(work?.firstPublishedPrecision),
    firstPublishedLabel: work?.firstPublishedLabel ?? null,
    externalIds: { bangumiSubjectId: String(work?.externalIds?.bangumiSubjectId ?? '') },
    candidateSources: sourceRows(work?.candidateSources),
    aliases: aliasValues(work?.aliases),
    searchText: String(work?.searchText ?? ''),
  };
}

function compareJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function objectStringIssues(fields) {
  const issues = [];
  if (fields.searchText.includes('[object Object]')) issues.push('searchText_object_string');
  if (fields.aliases.some((alias) => alias === '[object Object]')) issues.push('alias_object_string');
  return issues;
}

export function compareFieldReadbackItem(item, payloadWork) {
  const expected = expectedFieldsFromPlanItem(item);
  const actual = actualFieldsFromPayloadWork(payloadWork);
  const mismatches = [];
  for (const key of FIELD_KEYS) {
    if (!compareJson(expected[key], actual[key])) mismatches.push({ field: key, expected: expected[key], actual: actual[key] });
  }
  const objectIssues = objectStringIssues(actual);
  return {
    work: item.work,
    matched: mismatches.length === 0 && objectIssues.length === 0,
    mismatches,
    objectIssues,
  };
}

function workUrl(baseUrl, id) {
  return `${String(baseUrl).replace(/\/$/, '')}/api/works/${encodeURIComponent(id)}?depth=0&draft=true`;
}

async function safeJson(response) {
  try { return await response.json(); } catch { return undefined; }
}

async function readWork(fetchImpl, baseUrl, token, id) {
  const response = await fetchImpl(workUrl(baseUrl, id), { method: 'GET', headers: { Authorization: `JWT ${token}` } });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(`GET work ${id} failed: ${response.status} ${body?.message ?? ''}`.trim());
  return body;
}

export async function auditBgmWorkFieldReadback(plan, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available.');
  const token = options.token ?? process.env.PAYLOAD_TOKEN ?? '';
  if (!token) throw new Error('PAYLOAD_TOKEN is required.');
  const baseUrl = options.payloadBaseUrl ?? process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000';

  const items = asArray(plan?.items);
  const results = [];
  const errors = [];
  let reads = 0;
  for (const [index, item] of items.entries()) {
    const id = relationId(item?.work?.payloadId);
    try {
      const work = await readWork(fetchImpl, baseUrl, token, id);
      reads += 1;
      const result = compareFieldReadbackItem(item, work);
      results.push({ index, ...result });
    } catch (error) {
      errors.push({ code: 'read_error', index, workId: id, message: error.message });
    }
  }

  const matched = results.filter((result) => result.matched);
  const mismatched = results.filter((result) => !result.matched);
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: MODE,
    status: errors.length === 0 && mismatched.length === 0 ? 'pass' : 'fail',
    counts: {
      plannedWorksTotal: items.length,
      payloadReadsTotal: reads,
      matchedTotal: matched.length,
      mismatchedTotal: mismatched.length,
      errorsTotal: errors.length,
      objectStringIssuesTotal: results.reduce((sum, result) => sum + result.objectIssues.length, 0),
    },
    results,
    errors,
  };
}

export function renderFieldReadbackAuditMarkdown(audit) {
  const lines = ['# BGM Work Field Readback Audit', '', `- generatedAt: ${audit.generatedAt}`, `- mode: ${audit.mode}`, `- status: ${audit.status}`, '', '## Counts', '', '| key | value |', '| --- | ---: |'];
  for (const [key, value] of Object.entries(audit.counts)) lines.push(`| ${key} | ${value} |`);
  const bad = audit.results.filter((result) => !result.matched).slice(0, 100);
  lines.push('', '## Mismatches', '');
  if (bad.length === 0) lines.push('- none');
  else for (const result of bad) lines.push(`- ${result.index}: ${result.work?.title ?? ''} mismatches=${result.mismatches.length} objectIssues=${result.objectIssues.length}`);
  if (audit.errors.length > 0) {
    lines.push('', '## Errors', '');
    for (const error of audit.errors.slice(0, 100)) lines.push(`- ${error.index}: ${error.message}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const planPath = resolveFromRoot(repoRoot, argvValue('plan', DEFAULT_PATHS.planJson));
  const outJson = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.auditJson));
  const outMd = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.auditMarkdown));
  const baseUrl = argvValue('payload-url', process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000');
  const token = argvValue('token', process.env.PAYLOAD_TOKEN ?? '');

  const plan = await readJson(planPath);
  const audit = await auditBgmWorkFieldReadback(plan, { payloadBaseUrl: baseUrl, token });
  await writeJson(outJson, audit);
  await writeText(outMd, renderFieldReadbackAuditMarkdown(audit));

  console.log(`Work field readback audit status: ${audit.status}`);
  console.log(`planned=${audit.counts.plannedWorksTotal}; reads=${audit.counts.payloadReadsTotal}; matched=${audit.counts.matchedTotal}; mismatched=${audit.counts.mismatchedTotal}; objectIssues=${audit.counts.objectStringIssuesTotal}; errors=${audit.counts.errorsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, outJson)}`);
  console.log(`Wrote ${path.relative(repoRoot, outMd)}`);
  if (audit.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
