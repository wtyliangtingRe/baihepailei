#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_PATHS = {
  planJson: 'data_local/payload/bgm-work-entity-link-plan.json',
  auditJson: 'data_local/reports/bgm-work-entity-link-plan-audit.json',
  auditMarkdown: 'data_local/reports/bgm-work-entity-link-plan-audit.md',
};

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function resolveFromRoot(repoRoot, maybeRelative) {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.resolve(repoRoot, maybeRelative);
}

function argValue(name, fallback) {
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

function duplicateValues(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) dupes.add(value);
    seen.add(key);
  }
  return [...dupes];
}

function addIssue(bucket, code, message, extra = {}) {
  bucket.push({ code, message, ...extra });
}

export function auditWorkEntityLinkPlan(plan) {
  const errors = [];
  const warnings = [];
  const infos = [];

  if (plan?.schemaVersion !== 1) {
    addIssue(errors, 'schema_version', `Expected schemaVersion=1, got ${plan?.schemaVersion ?? 'missing'}.`);
  }

  if (plan?.mode !== 'local-plan-only/no-payload-reads/no-payload-writes/no-relation-patch/no-cover-upload') {
    addIssue(errors, 'mode_boundary', 'Plan mode does not match #126 local-only boundary.');
  }

  const items = asArray(plan?.items);
  const counts = {
    plannedWorksTotal: items.length,
    worksMissingPayloadIdTotal: 0,
    worksWithNoCreatorLinksTotal: 0,
    worksWithNoOrganizationLinksTotal: 0,
    duplicateCreatorRelationshipIdsTotal: 0,
    duplicateOrganizationRelationshipIdsTotal: 0,
    creatorCreditMissingCreatorIdTotal: 0,
    organizationCreditMissingOrganizationIdTotal: 0,
    unresolvedCreatorRefsTotal: 0,
    unresolvedOrganizationRefsTotal: 0,
    ambiguousCreatorRefsTotal: 0,
    ambiguousOrganizationRefsTotal: 0,
    itemErrorsTotal: 0,
    itemWarningsTotal: 0,
  };

  if (items.length === 0) {
    addIssue(errors, 'empty_plan', 'Plan has no work items.');
  }

  items.forEach((item, index) => {
    const label = `${index + 1}: ${item?.work?.title ?? '(untitled)'}`;

    if (!hasValue(item?.work?.payloadId)) {
      counts.worksMissingPayloadIdTotal += 1;
      addIssue(errors, 'work_payload_id_missing', `Missing Payload work id for ${label}.`, { index });
    }

    const creatorIds = asArray(item?.links?.creators);
    const organizationIds = asArray(item?.links?.organizations);
    const creatorCredits = asArray(item?.links?.creatorCredits);
    const organizationCredits = asArray(item?.links?.organizationCredits);

    if (creatorIds.length === 0 && creatorCredits.length === 0) {
      counts.worksWithNoCreatorLinksTotal += 1;
      addIssue(warnings, 'work_has_no_creator_links', `No creator links planned for ${label}.`, { index });
    }

    if (organizationIds.length === 0) {
      counts.worksWithNoOrganizationLinksTotal += 1;
      addIssue(warnings, 'work_has_no_organization_links', `No organization links planned for ${label}.`, { index });
    }

    const duplicateCreatorIds = duplicateValues(creatorIds);
    if (duplicateCreatorIds.length > 0) {
      counts.duplicateCreatorRelationshipIdsTotal += duplicateCreatorIds.length;
      addIssue(errors, 'duplicate_creator_relationship_ids', `Duplicate creator relationship ids for ${label}.`, { index, duplicateCreatorIds });
    }

    const duplicateOrganizationIds = duplicateValues(organizationIds);
    if (duplicateOrganizationIds.length > 0) {
      counts.duplicateOrganizationRelationshipIdsTotal += duplicateOrganizationIds.length;
      addIssue(errors, 'duplicate_organization_relationship_ids', `Duplicate organization relationship ids for ${label}.`, { index, duplicateOrganizationIds });
    }

    for (const [creditIndex, credit] of creatorCredits.entries()) {
      if (!hasValue(credit?.creator) && !hasValue(credit?.creatorId)) {
        counts.creatorCreditMissingCreatorIdTotal += 1;
        addIssue(errors, 'creator_credit_missing_creator_id', `creatorCredits[${creditIndex}] has no creator id for ${label}.`, { index, creditIndex });
      }
    }

    for (const [creditIndex, credit] of organizationCredits.entries()) {
      if (!hasValue(credit?.organization) && !hasValue(credit?.organizationId)) {
        counts.organizationCreditMissingOrganizationIdTotal += 1;
        addIssue(errors, 'organization_credit_missing_organization_id', `organizationCredits[${creditIndex}] has no organization id for ${label}.`, { index, creditIndex });
      }
    }

    counts.unresolvedCreatorRefsTotal += asArray(item?.unresolvedRefs?.creators).length;
    counts.unresolvedOrganizationRefsTotal += asArray(item?.unresolvedRefs?.organizations).length;
    counts.ambiguousCreatorRefsTotal += asArray(item?.ambiguousRefs?.creators).length;
    counts.ambiguousOrganizationRefsTotal += asArray(item?.ambiguousRefs?.organizations).length;
    counts.itemErrorsTotal += asArray(item?.errors).length;
    counts.itemWarningsTotal += asArray(item?.warnings).length;
  });

  if (counts.unresolvedCreatorRefsTotal > 0) addIssue(errors, 'unresolved_creator_refs', `${counts.unresolvedCreatorRefsTotal} creator refs are unresolved.`);
  if (counts.unresolvedOrganizationRefsTotal > 0) addIssue(errors, 'unresolved_organization_refs', `${counts.unresolvedOrganizationRefsTotal} organization refs are unresolved.`);
  if (counts.ambiguousCreatorRefsTotal > 0) addIssue(errors, 'ambiguous_creator_refs', `${counts.ambiguousCreatorRefsTotal} creator refs are ambiguous.`);
  if (counts.ambiguousOrganizationRefsTotal > 0) addIssue(errors, 'ambiguous_organization_refs', `${counts.ambiguousOrganizationRefsTotal} organization refs are ambiguous.`);
  if (counts.itemErrorsTotal > 0) addIssue(errors, 'item_errors_present', `${counts.itemErrorsTotal} item-level errors are present.`);
  if (counts.itemWarningsTotal > 0) addIssue(warnings, 'item_warnings_present', `${counts.itemWarningsTotal} item-level warnings are present.`);

  if (plan?.counts?.packageWorksTotal !== undefined && plan.counts.packageWorksTotal !== items.length) {
    addIssue(errors, 'count_mismatch_package_works', `plan.counts.packageWorksTotal=${plan.counts.packageWorksTotal}, actual=${items.length}.`);
  }

  const audit = {
    generatedAt: new Date().toISOString(),
    status: errors.length === 0 ? 'pass' : 'fail',
    counts: {
      ...counts,
      errorsTotal: errors.length,
      warningsTotal: warnings.length,
      infosTotal: infos.length,
    },
    errors,
    warnings,
    infos,
  };

  return audit;
}

export function renderAuditMarkdown(audit) {
  const lines = [];
  lines.push('# BGM Work Entity Link Plan Audit');
  lines.push('');
  lines.push(`- generatedAt: ${audit.generatedAt}`);
  lines.push(`- status: ${audit.status}`);
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| key | value |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(audit.counts)) lines.push(`| ${key} | ${value} |`);

  if (audit.errors.length > 0) {
    lines.push('');
    lines.push('## Errors');
    for (const error of audit.errors) lines.push(`- ${error.code}: ${error.message}`);
  }

  if (audit.warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    for (const warning of audit.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
  }

  if (audit.infos.length > 0) {
    lines.push('');
    lines.push('## Infos');
    for (const info of audit.infos) lines.push(`- ${info.code}: ${info.message}`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const repoRoot = resolveFromRoot(process.cwd(), argValue('repo-root', repoRootFromScript()));
  const planPath = resolveFromRoot(repoRoot, argValue('plan', DEFAULT_PATHS.planJson));
  const auditJsonPath = resolveFromRoot(repoRoot, argValue('out-json', DEFAULT_PATHS.auditJson));
  const auditMdPath = resolveFromRoot(repoRoot, argValue('out-md', DEFAULT_PATHS.auditMarkdown));

  const plan = await readJson(planPath);
  const audit = auditWorkEntityLinkPlan(plan);

  await writeJson(auditJsonPath, audit);
  await writeText(auditMdPath, renderAuditMarkdown(audit));

  console.log(`Audit status: ${audit.status}; errors=${audit.counts.errorsTotal}; warnings=${audit.counts.warningsTotal}; infos=${audit.counts.infosTotal}`);
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
