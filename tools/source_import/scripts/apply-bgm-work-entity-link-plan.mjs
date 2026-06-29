#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPLY_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-entity-link-plan.json',
  backupJson: 'data_local/payload/bgm-work-entity-link-apply-backup.json',
  reportJson: 'data_local/reports/bgm-work-entity-link-apply-report.json',
  reportMarkdown: 'data_local/reports/bgm-work-entity-link-apply-report.md',
};

export const APPLY_MODE = 'guarded-payload-relation-apply/dry-run-default/read-before-write/relation-fields-only/no-cover-upload';

const RELATION_PATCH_FIELDS = ['creators', 'creatorCredits', 'organizations'];

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

function argvFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
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

function relationId(value) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text) return undefined;
  return /^\d+$/.test(text) ? Number(text) : text;
}

function uniqueIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = relationId(value);
    if (id === undefined) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(id);
  }
  return result;
}

function sanitizeCreatorCredit(credit, index) {
  const creator = relationId(credit?.creator ?? credit?.creatorId);
  if (creator === undefined) return undefined;
  return {
    creator,
    creatorId: creator,
    name: hasValue(credit?.name) ? String(credit.name) : undefined,
    roles: asArray(credit?.roles).map((role) => String(role)).filter(Boolean),
    order: Number.isFinite(Number(credit?.order)) ? Number(credit.order) : index + 1,
    sourcePath: hasValue(credit?.sourcePath) ? String(credit.sourcePath) : undefined,
    matchBy: hasValue(credit?.matchBy) ? String(credit.matchBy) : undefined,
    matchKey: hasValue(credit?.matchKey) ? String(credit.matchKey) : undefined,
  };
}

function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

export function buildWorkRelationPatch(item) {
  const links = item?.links ?? {};
  const creators = uniqueIds(links.creators);
  const organizations = uniqueIds(links.organizations);
  const creatorCredits = asArray(links.creatorCredits)
    .map((credit, index) => sanitizeCreatorCredit(credit, index))
    .filter(Boolean)
    .map(compactObject);

  return { creators, creatorCredits, organizations };
}

export function validateApplyPlan(plan) {
  const errors = [];
  const items = asArray(plan?.items);

  if (plan?.schemaVersion !== 1) errors.push({ code: 'schema_version', message: `Expected schemaVersion=1, got ${plan?.schemaVersion ?? 'missing'}.` });
  if (plan?.status !== 'ready') errors.push({ code: 'plan_not_ready', message: `Expected plan.status=ready, got ${plan?.status ?? 'missing'}.` });
  if (items.length === 0) errors.push({ code: 'empty_plan', message: 'Plan has no items.' });

  items.forEach((item, index) => {
    const label = `${index + 1}: ${item?.work?.title ?? '(untitled)'}`;
    if (!hasValue(item?.work?.payloadId)) errors.push({ code: 'work_payload_id_missing', message: `Missing Payload work id for ${label}.`, index });
    if (asArray(item?.errors).length > 0) errors.push({ code: 'item_errors_present', message: `Item has errors for ${label}.`, index });
    if (asArray(item?.unresolvedRefs?.creators).length > 0 || asArray(item?.unresolvedRefs?.organizations).length > 0) errors.push({ code: 'unresolved_refs_present', message: `Item has unresolved refs for ${label}.`, index });
    if (asArray(item?.ambiguousRefs?.creators).length > 0 || asArray(item?.ambiguousRefs?.organizations).length > 0) errors.push({ code: 'ambiguous_refs_present', message: `Item has ambiguous refs for ${label}.`, index });
  });

  return { status: errors.length === 0 ? 'pass' : 'fail', errors };
}

export function buildApplyOperations(plan) {
  return asArray(plan?.items).map((item, index) => ({
    index,
    work: {
      payloadId: relationId(item?.work?.payloadId),
      title: item?.work?.title ?? '',
      bangumiSubjectId: item?.work?.bangumiSubjectId ?? item?.work?.siteId,
    },
    patch: buildWorkRelationPatch(item),
  }));
}

function ensureToken(token) {
  const clean = token?.trim();
  if (!clean) throw new Error('PAYLOAD_TOKEN is required when --apply is used. Login first and set Authorization token as JWT.');
  return clean;
}

function payloadUrl(baseUrl, workId) {
  const base = String(baseUrl).replace(/\/$/, '');
  return `${base}/api/works/${encodeURIComponent(workId)}?depth=0&draft=true`;
}

async function readPayloadWork(fetchImpl, baseUrl, token, workId) {
  const response = await fetchImpl(payloadUrl(baseUrl, workId), {
    method: 'GET',
    headers: { Authorization: `JWT ${token}` },
  });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(`GET work ${workId} failed: ${response.status} ${body?.message ?? ''}`.trim());
  return body;
}

async function patchPayloadWork(fetchImpl, baseUrl, token, workId, patch) {
  const response = await fetchImpl(payloadUrl(baseUrl, workId), {
    method: 'PATCH',
    headers: {
      Authorization: `JWT ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(`PATCH work ${workId} failed: ${response.status} ${body?.message ?? ''}`.trim());
  return body;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function applyBgmWorkEntityLinkPlan(plan, options = {}) {
  const apply = options.apply === true;
  const validation = validateApplyPlan(plan);
  const operations = buildApplyOperations(plan);
  const report = {
    schemaVersion: APPLY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: APPLY_MODE,
    apply,
    status: 'ready',
    counts: {
      plannedWorksTotal: operations.length,
      payloadReadsTotal: 0,
      payloadWritesTotal: 0,
      skippedWritesTotal: 0,
      errorsTotal: 0,
    },
    errors: [],
    operations: [],
  };

  if (validation.status !== 'pass') {
    report.status = 'blocked';
    report.errors = validation.errors;
    report.counts.errorsTotal = validation.errors.length;
    report.counts.skippedWritesTotal = operations.length;
    return { report, backup: { generatedAt: report.generatedAt, mode: APPLY_MODE, items: [] } };
  }

  if (!apply) {
    report.status = 'dry-run';
    report.counts.skippedWritesTotal = operations.length;
    report.operations = operations.map((operation) => ({
      index: operation.index,
      work: operation.work,
      status: 'dry-run',
      patchFields: RELATION_PATCH_FIELDS,
      patch: operation.patch,
    }));
    return { report, backup: { generatedAt: report.generatedAt, mode: APPLY_MODE, items: [] } };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available. Use Node.js 18+ or pass fetchImpl.');
  const token = ensureToken(options.token ?? process.env.PAYLOAD_TOKEN);
  const baseUrl = options.payloadBaseUrl ?? process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000';
  const backup = { generatedAt: report.generatedAt, mode: APPLY_MODE, payloadBaseUrl: baseUrl, items: [] };

  for (const operation of operations) {
    try {
      const current = await readPayloadWork(fetchImpl, baseUrl, token, operation.work.payloadId);
      report.counts.payloadReadsTotal += 1;
      backup.items.push({ index: operation.index, work: operation.work, current });

      const patched = await patchPayloadWork(fetchImpl, baseUrl, token, operation.work.payloadId, operation.patch);
      report.counts.payloadWritesTotal += 1;
      report.operations.push({
        index: operation.index,
        work: operation.work,
        status: 'patched',
        patchFields: RELATION_PATCH_FIELDS,
        patch: operation.patch,
        result: { id: patched?.id ?? operation.work.payloadId, title: patched?.title ?? operation.work.title },
      });
    } catch (error) {
      report.status = 'failed';
      report.errors.push({ code: 'payload_write_error', message: error.message, index: operation.index, work: operation.work });
      report.counts.errorsTotal = report.errors.length;
      report.operations.push({ index: operation.index, work: operation.work, status: 'failed', error: error.message });
      break;
    }
  }

  if (report.errors.length === 0) report.status = 'applied';
  report.counts.errorsTotal = report.errors.length;
  report.counts.skippedWritesTotal = operations.length - report.counts.payloadWritesTotal;
  return { report, backup };
}

export function renderApplyReportMarkdown(report) {
  const lines = [];
  lines.push('# BGM Work Entity Link Apply Report');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- apply: ${report.apply}`);
  lines.push(`- status: ${report.status}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| key | value |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(report.counts)) lines.push(`| ${key} | ${value} |`);

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const error of report.errors) lines.push(`- ${error.code}: ${error.message}`);
  }

  lines.push('');
  lines.push('## Boundary');
  lines.push('');
  lines.push('- dry-run by default');
  lines.push('- `--apply` is required before Payload writes');
  lines.push('- read-before-write backup is created in apply mode');
  lines.push('- PATCH is limited to `creators`, `creatorCredits`, and `organizations`');
  lines.push('- no cover upload');
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
  const { report, backup } = await applyBgmWorkEntityLinkPlan(plan, { apply, payloadBaseUrl, token });

  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, renderApplyReportMarkdown(report));
  if (apply) await writeJson(backupPath, backup);

  console.log(`Apply status: ${report.status}`);
  console.log(`apply=${report.apply}; planned=${report.counts.plannedWorksTotal}; reads=${report.counts.payloadReadsTotal}; writes=${report.counts.payloadWritesTotal}; errors=${report.counts.errorsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, reportJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, reportMdPath)}`);
  if (apply) console.log(`Wrote ${path.relative(repoRoot, backupPath)}`);

  if (report.status === 'blocked' || report.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
