#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLY_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-field-plan.json',
  backupJson: 'data_local/payload/bgm-work-field-apply-backup.json',
  reportJson: 'data_local/reports/bgm-work-field-apply-report.json',
  reportMarkdown: 'data_local/reports/bgm-work-field-apply-report.md',
};

export const MODE = 'guarded-work-field-apply/dry-run-default/read-before-write';
export const FIELD_ALLOWLIST = ['mediaGroup', 'mediaType', 'format', 'firstPublishedAt', 'firstPublishedPrecision', 'firstPublishedLabel', 'externalIds', 'candidateSources', 'aliases', 'searchText'];

function repoRootFromScript() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); }
function resolveFromRoot(repoRoot, maybeRelative) { return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(repoRoot, maybeRelative); }
function argvValue(name, fallback) {
  const argv = process.argv.slice(2);
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return fallback;
}
function argvFlag(name) { return process.argv.slice(2).includes(`--${name}`); }
async function readJson(filePath) { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
async function writeJson(filePath, value) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function writeText(filePath, value) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, value.endsWith('\n') ? value : `${value}\n`, 'utf8'); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function hasValue(value) { return value !== undefined && value !== null && value !== ''; }
function relationId(value) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') return relationId(value.id ?? value.payloadId ?? value.value);
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}
function pickAllowedFields(patch) {
  const result = {};
  for (const key of FIELD_ALLOWLIST) if (Object.prototype.hasOwnProperty.call(patch ?? {}, key)) result[key] = patch[key];
  return result;
}
export function validateWorkFieldApplyPlan(plan) {
  const errors = [];
  const items = asArray(plan?.items);
  if (plan?.schemaVersion !== 1) errors.push({ code: 'schema_version', message: `Expected schemaVersion=1, got ${plan?.schemaVersion ?? 'missing'}.` });
  if (plan?.status !== 'ready') errors.push({ code: 'plan_not_ready', message: `Expected plan.status=ready, got ${plan?.status ?? 'missing'}.` });
  if (items.length === 0) errors.push({ code: 'empty_plan', message: 'Plan has no items.' });
  items.forEach((item, index) => {
    if (relationId(item?.work?.payloadId) === undefined) errors.push({ code: 'payload_id_missing', index, message: `Missing work id for item ${index + 1}.` });
    if (asArray(item?.errors).length > 0) errors.push({ code: 'item_errors_present', index, message: `Item ${index + 1} has errors.` });
  });
  return { status: errors.length === 0 ? 'pass' : 'fail', errors };
}
export function buildWorkFieldApplyOperations(plan) {
  return asArray(plan?.items).map((item, index) => ({
    index,
    work: {
      payloadId: relationId(item?.work?.payloadId),
      title: item?.work?.title ?? '',
      mediaType: item?.work?.mediaType ?? '',
      bangumiSubjectId: item?.work?.bangumiSubjectId,
    },
    patch: pickAllowedFields(item?.patch),
  }));
}
function ensureToken(token) {
  const clean = token?.trim();
  if (!clean) throw new Error('PAYLOAD_TOKEN is required when --apply is used.');
  return clean;
}
function workUrl(baseUrl, workId) { return `${String(baseUrl).replace(/\/$/, '')}/api/works/${encodeURIComponent(workId)}?depth=0&draft=true`; }
async function safeJson(response) { try { return await response.json(); } catch { return undefined; } }
async function readWork(fetchImpl, baseUrl, token, workId) {
  const response = await fetchImpl(workUrl(baseUrl, workId), { method: 'GET', headers: { Authorization: `JWT ${token}` } });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(`GET work ${workId} failed: ${response.status} ${body?.message ?? ''}`.trim());
  return body;
}
async function updateWork(fetchImpl, baseUrl, token, workId, patch) {
  const response = await fetchImpl(workUrl(baseUrl, workId), { method: 'PATCH', headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(`PATCH work ${workId} failed: ${response.status} ${body?.message ?? ''}`.trim());
  return body;
}
export async function applyBgmWorkFieldPlan(plan, options = {}) {
  const apply = options.apply === true;
  const validation = validateWorkFieldApplyPlan(plan);
  const operations = buildWorkFieldApplyOperations(plan);
  const report = { schemaVersion: APPLY_SCHEMA_VERSION, generatedAt: new Date().toISOString(), mode: MODE, apply, status: 'ready', counts: { plannedWorksTotal: operations.length, payloadReadsTotal: 0, payloadWritesTotal: 0, skippedWritesTotal: 0, errorsTotal: 0 }, errors: [], operations: [] };
  if (validation.status !== 'pass') {
    report.status = 'blocked';
    report.errors = validation.errors;
    report.counts.errorsTotal = validation.errors.length;
    report.counts.skippedWritesTotal = operations.length;
    return { report, backup: { generatedAt: report.generatedAt, mode: MODE, items: [] } };
  }
  if (!apply) {
    report.status = 'dry-run';
    report.counts.skippedWritesTotal = operations.length;
    report.operations = operations.map((operation) => ({ index: operation.index, work: operation.work, status: 'dry-run', patchFields: Object.keys(operation.patch), patch: operation.patch }));
    return { report, backup: { generatedAt: report.generatedAt, mode: MODE, items: [] } };
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available.');
  const token = ensureToken(options.token ?? process.env.PAYLOAD_TOKEN);
  const baseUrl = options.payloadBaseUrl ?? process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000';
  const backup = { generatedAt: report.generatedAt, mode: MODE, payloadBaseUrl: baseUrl, items: [] };
  for (const operation of operations) {
    try {
      const current = await readWork(fetchImpl, baseUrl, token, operation.work.payloadId);
      report.counts.payloadReadsTotal += 1;
      backup.items.push({ index: operation.index, work: operation.work, current });
      const updated = await updateWork(fetchImpl, baseUrl, token, operation.work.payloadId, operation.patch);
      report.counts.payloadWritesTotal += 1;
      report.operations.push({ index: operation.index, work: operation.work, status: 'updated', patchFields: Object.keys(operation.patch), result: { id: updated?.id ?? operation.work.payloadId, title: updated?.title ?? operation.work.title } });
    } catch (error) {
      report.status = 'failed';
      report.errors.push({ code: 'payload_write_error', message: error.message, index: operation.index, work: operation.work });
      report.operations.push({ index: operation.index, work: operation.work, status: 'failed', error: error.message });
      break;
    }
  }
  if (report.errors.length === 0) report.status = 'applied';
  report.counts.errorsTotal = report.errors.length;
  report.counts.skippedWritesTotal = operations.length - report.counts.payloadWritesTotal;
  return { report, backup };
}
export function renderWorkFieldApplyReportMarkdown(report) {
  const lines = ['# BGM Work Field Apply Report', '', `- generatedAt: ${report.generatedAt}`, `- mode: ${report.mode}`, `- apply: ${report.apply}`, `- status: ${report.status}`, '', '## Counts', '', '| key | value |', '| --- | ---: |'];
  for (const [key, value] of Object.entries(report.counts)) lines.push(`| ${key} | ${value} |`);
  if (report.errors.length > 0) { lines.push('', '## Errors'); for (const error of report.errors) lines.push(`- ${error.code}: ${error.message}`); }
  lines.push('', '## Field allowlist', '');
  for (const field of FIELD_ALLOWLIST) lines.push(`- ${field}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}
async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const planPath = resolveFromRoot(repoRoot, argvValue('plan', DEFAULT_PATHS.planJson));
  const backupPath = resolveFromRoot(repoRoot, argvValue('backup', DEFAULT_PATHS.backupJson));
  const reportJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.reportJson));
  const reportMdPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.reportMarkdown));
  const payloadBaseUrl = argvValue('payload-url', process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000');
  const token = argvValue('token', process.env.PAYLOAD_TOKEN);
  const apply = argvFlag('apply');
  const plan = await readJson(planPath);
  const { report, backup } = await applyBgmWorkFieldPlan(plan, { apply, payloadBaseUrl, token });
  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, renderWorkFieldApplyReportMarkdown(report));
  if (apply) await writeJson(backupPath, backup);
  console.log(`Work field apply status: ${report.status}`);
  console.log(`apply=${report.apply}; planned=${report.counts.plannedWorksTotal}; reads=${report.counts.payloadReadsTotal}; writes=${report.counts.payloadWritesTotal}; errors=${report.counts.errorsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportMdPath)}`);
  if (apply) console.log(`Wrote ${path.relative(repoRoot, backupPath)}`);
  if (report.status === 'blocked' || report.status === 'failed') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; });
