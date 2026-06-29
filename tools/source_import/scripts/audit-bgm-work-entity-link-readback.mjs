#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildWorkRelationPatch } from './apply-bgm-work-entity-link-plan.mjs';

export const READBACK_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-entity-link-plan.json',
  auditJson: 'data_local/reports/bgm-work-entity-link-readback-audit.json',
  auditMarkdown: 'data_local/reports/bgm-work-entity-link-readback-audit.md',
};

export const READBACK_MODE = 'payload-readback-audit/read-only/no-payload-writes/no-relation-patch/no-cover-upload';

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

function relationId(value) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return undefined;
    return /^\d+$/.test(text) ? Number(text) : text;
  }
  if (typeof value === 'object') return relationId(value.id ?? value.payloadId ?? value.doc?.id ?? value.value);
  return undefined;
}

function normalizeIds(values) {
  return asArray(values).map(relationId).filter((id) => id !== undefined);
}

function normalizeRoles(value) {
  return asArray(value).map((role) => String(role).trim()).filter(Boolean).sort();
}

function normalizeCreatorCredits(value) {
  return asArray(value)
    .map((credit, index) => ({
      creator: relationId(credit?.creator ?? credit?.creatorId),
      roles: normalizeRoles(credit?.roles),
      order: Number.isFinite(Number(credit?.order)) ? Number(credit.order) : index + 1,
    }))
    .filter((credit) => credit.creator !== undefined)
    .sort((a, b) => String(a.creator).localeCompare(String(b.creator)) || a.order - b.order || a.roles.join('|').localeCompare(b.roles.join('|')));
}

function stable(value) {
  return JSON.stringify(value);
}

function compareField(field, expected, actual) {
  const pass = stable(expected) === stable(actual);
  return pass ? undefined : { field, expected, actual };
}

export function expectedReadbackFieldsFromPlanItem(item) {
  const patch = buildWorkRelationPatch(item);
  return {
    creators: normalizeIds(patch.creators),
    organizations: normalizeIds(patch.organizations),
    creatorCredits: normalizeCreatorCredits(patch.creatorCredits),
  };
}

export function actualReadbackFieldsFromPayloadWork(work) {
  return {
    creators: normalizeIds(work?.creators),
    organizations: normalizeIds(work?.organizations),
    creatorCredits: normalizeCreatorCredits(work?.creatorCredits),
  };
}

export function compareReadbackItem(item, payloadWork) {
  const expected = expectedReadbackFieldsFromPlanItem(item);
  const actual = actualReadbackFieldsFromPayloadWork(payloadWork);
  const mismatches = [
    compareField('creators', expected.creators, actual.creators),
    compareField('organizations', expected.organizations, actual.organizations),
    compareField('creatorCredits', expected.creatorCredits, actual.creatorCredits),
  ].filter(Boolean);

  return {
    status: mismatches.length === 0 ? 'pass' : 'fail',
    work: {
      payloadId: relationId(item?.work?.payloadId),
      title: item?.work?.title ?? payloadWork?.title ?? '',
      bangumiSubjectId: item?.work?.bangumiSubjectId ?? item?.work?.siteId,
    },
    mismatches,
  };
}

export function validateReadbackPlan(plan) {
  const errors = [];
  const items = asArray(plan?.items);
  if (plan?.schemaVersion !== 1) errors.push({ code: 'schema_version', message: `Expected schemaVersion=1, got ${plan?.schemaVersion ?? 'missing'}.` });
  if (plan?.status !== 'ready') errors.push({ code: 'plan_not_ready', message: `Expected plan.status=ready, got ${plan?.status ?? 'missing'}.` });
  if (items.length === 0) errors.push({ code: 'empty_plan', message: 'Plan has no items.' });
  items.forEach((item, index) => {
    if (!hasValue(item?.work?.payloadId)) errors.push({ code: 'work_payload_id_missing', message: `Missing Payload work id for item ${index + 1}.`, index });
    if (asArray(item?.errors).length > 0) errors.push({ code: 'item_errors_present', message: `Plan item ${index + 1} still has item errors.`, index });
  });
  return { status: errors.length === 0 ? 'pass' : 'fail', errors };
}

function payloadUrl(baseUrl, workId) {
  const base = String(baseUrl).replace(/\/$/, '');
  return `${base}/api/works/${encodeURIComponent(workId)}?depth=0&draft=true`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
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

export async function auditBgmWorkEntityLinkReadback(plan, options = {}) {
  const validation = validateReadbackPlan(plan);
  const items = asArray(plan?.items);
  const audit = {
    schemaVersion: READBACK_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: READBACK_MODE,
    status: 'pass',
    counts: {
      plannedWorksTotal: items.length,
      payloadReadsTotal: 0,
      matchedWorksTotal: 0,
      mismatchedWorksTotal: 0,
      errorsTotal: 0,
    },
    errors: [],
    items: [],
  };

  if (validation.status !== 'pass') {
    audit.status = 'blocked';
    audit.errors = validation.errors;
    audit.counts.errorsTotal = validation.errors.length;
    return audit;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available. Use Node.js 18+ or pass fetchImpl.');
  const token = options.token ?? process.env.PAYLOAD_TOKEN;
  if (!token?.trim()) throw new Error('PAYLOAD_TOKEN is required for readback audit.');
  const baseUrl = options.payloadBaseUrl ?? process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000';

  for (const [index, item] of items.entries()) {
    const workId = relationId(item?.work?.payloadId);
    try {
      const payloadWork = await readPayloadWork(fetchImpl, baseUrl, token, workId);
      audit.counts.payloadReadsTotal += 1;
      const result = compareReadbackItem(item, payloadWork);
      audit.items.push({ index, ...result });
      if (result.status === 'pass') audit.counts.matchedWorksTotal += 1;
      else audit.counts.mismatchedWorksTotal += 1;
    } catch (error) {
      audit.status = 'fail';
      audit.errors.push({ code: 'payload_read_error', message: error.message, index, workId });
    }
  }

  if (audit.counts.mismatchedWorksTotal > 0) audit.status = 'fail';
  if (audit.errors.length > 0) audit.status = 'fail';
  audit.counts.errorsTotal = audit.errors.length;
  return audit;
}

export function renderReadbackAuditMarkdown(audit) {
  const lines = [];
  lines.push('# BGM Work Entity Link Readback Audit');
  lines.push('');
  lines.push(`- generatedAt: ${audit.generatedAt}`);
  lines.push(`- mode: ${audit.mode}`);
  lines.push(`- status: ${audit.status}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| key | value |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(audit.counts)) lines.push(`| ${key} | ${value} |`);

  const failed = audit.items.filter((item) => item.status === 'fail');
  if (failed.length > 0) {
    lines.push('');
    lines.push('## Mismatches');
    for (const item of failed) {
      lines.push(`- ${item.index + 1}: ${item.work.title || item.work.payloadId}`);
      for (const mismatch of item.mismatches) lines.push(`  - ${mismatch.field}: expected ${stable(mismatch.expected)}, actual ${stable(mismatch.actual)}`);
    }
  }

  if (audit.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const error of audit.errors) lines.push(`- ${error.code}: ${error.message}`);
  }

  lines.push('');
  lines.push('## Boundary');
  lines.push('');
  lines.push('- read-only Payload GET');
  lines.push('- no Payload writes');
  lines.push('- no relation PATCH');
  lines.push('- no cover upload');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const repoRoot = path.resolve(argvValue('repo-root', repoRootFromScript()));
  const planPath = resolveFromRoot(repoRoot, argvValue('plan', DEFAULT_PATHS.planJson));
  const auditJsonPath = resolveFromRoot(repoRoot, argvValue('out-json', DEFAULT_PATHS.auditJson));
  const auditMdPath = resolveFromRoot(repoRoot, argvValue('out-md', DEFAULT_PATHS.auditMarkdown));
  const payloadBaseUrl = argvValue('payload-url', process.env.PAYLOAD_URL ?? 'http://127.0.0.1:3000');
  const token = argvValue('token', process.env.PAYLOAD_TOKEN);

  const plan = await readJson(planPath);
  const audit = await auditBgmWorkEntityLinkReadback(plan, { payloadBaseUrl, token });
  await writeJson(auditJsonPath, audit);
  await writeText(auditMdPath, renderReadbackAuditMarkdown(audit));

  console.log(`Readback audit status: ${audit.status}`);
  console.log(`planned=${audit.counts.plannedWorksTotal}; reads=${audit.counts.payloadReadsTotal}; matched=${audit.counts.matchedWorksTotal}; mismatched=${audit.counts.mismatchedWorksTotal}; errors=${audit.counts.errorsTotal}`);
  console.log(`Wrote ${path.relative(repoRoot, auditJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, auditMdPath)}`);
  if (audit.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
