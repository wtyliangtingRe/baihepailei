#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLAN_SCHEMA_VERSION = 1;

export const DEFAULT_PATHS = {
  packagePreview: 'data_local/payload/bangumi-media-work-package-preview.json',
  idMap: 'data_local/payload/bgm-id-map.jwt.json',
  planJson: 'data_local/payload/bgm-work-entity-link-plan.json',
  planMarkdown: 'data_local/reports/bgm-work-entity-link-plan.md',
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function compact(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '');
  return value === undefined || value === null || value === '' ? undefined : value;
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().normalize('NFKC').toLowerCase();
}

function getByPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => {
    if (!isPlainObject(acc) && !Array.isArray(acc)) return undefined;
    return acc[key];
  }, obj);
}

function firstValue(obj, dottedPaths) {
  for (const dottedPath of dottedPaths) {
    const value = getByPath(obj, dottedPath);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function bangumiKeyVariants(value) {
  const raw = compact(value);
  if (raw === undefined) return [];
  const s = String(raw).trim();
  const variants = new Set([s, normalizeText(s)]);
  const numberMatch = s.match(/(?:bangumi-|bgm-|subject-)?(\d+)/i);
  if (numberMatch) {
    variants.add(numberMatch[1]);
    variants.add(`bangumi-${numberMatch[1]}`);
    variants.add(`bgm-${numberMatch[1]}`);
    variants.add(`subject-${numberMatch[1]}`);
  }
  return [...variants].filter(Boolean);
}

function numericOrStringId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  return undefined;
}

const PAYLOAD_ID_PATHS = [
  'payloadId',
  'payloadID',
  'payloadDocId',
  'payloadDocID',
  'payload.id',
  'payload.doc.id',
  'payloadDoc.id',
  'doc.id',
  'matched.id',
  'matched.doc.id',
  'existing.id',
  'existing.doc.id',
  'target.id',
  'target.payloadId',
  'result.id',
];

const SOURCE_ID_PATHS = [
  'siteId',
  'sourceId',
  'sourceID',
  'bangumiSiteId',
  'bangumiSubjectId',
  'bangumiId',
  'bgmSiteId',
  'bgmSubjectId',
  'bgmId',
  'subjectId',
  'subjectID',
  'source.siteId',
  'source.id',
  'source.bangumiId',
  'source.bgmId',
  'package.siteId',
  'package.sourceId',
  'input.siteId',
  'input.sourceId',
];

const NAME_PATHS = [
  'name',
  'title',
  'displayName',
  'label',
  'sourceName',
  'sourceTitle',
  'package.name',
  'package.title',
  'input.name',
  'input.title',
  'entity.name',
  'entity.title',
  'payload.name',
  'payload.title',
  'doc.name',
  'doc.title',
  'matched.name',
  'matched.title',
  'existing.name',
  'existing.title',
];

function getPayloadIdFromMapObject(obj) {
  const direct = firstValue(obj, PAYLOAD_ID_PATHS);
  const directId = numericOrStringId(direct);
  if (directId !== undefined) return directId;

  // Some older helper scripts store Payload REST docs directly as { id, title, siteId }.
  // Use bare `id` last because Bangumi source ids are often also called id.
  if (Object.prototype.hasOwnProperty.call(obj, 'id')) {
    const id = numericOrStringId(obj.id);
    const hasPayloadDocShape = ['createdAt', 'updatedAt', 'slug', 'status', '_status'].some((key) => key in obj);
    const hasSourceKey = SOURCE_ID_PATHS.some((key) => firstValue(obj, [key]) !== undefined);
    if (id !== undefined && (hasPayloadDocShape || hasSourceKey)) return id;
  }

  return undefined;
}

function getName(obj) {
  const value = firstValue(obj, NAME_PATHS);
  return value === undefined ? undefined : String(value).trim();
}

function collectSourceKeys(obj) {
  const values = [];
  for (const keyPath of SOURCE_ID_PATHS) {
    values.push(...asArray(firstValue(obj, [keyPath])));
  }
  return [...new Set(values.flatMap((value) => bangumiKeyVariants(value)))];
}

function kindFromPath(pathParts) {
  const joined = pathParts.join('.').toLowerCase();
  if (/(^|\.)(works|work|mediaworks|media_works)(\.|$)/.test(joined)) return 'works';
  if (/(^|\.)(creators|creator|persons|person|people|staff)(\.|$)/.test(joined)) return 'creators';
  if (/(^|\.)(organizations|organization|orgs|org|companies|company|publishers|publisher|studios|studio)(\.|$)/.test(joined)) return 'organizations';
  return undefined;
}

function kindFromObject(obj) {
  const value = normalizeText(firstValue(obj, ['kind', 'type', 'collection', 'entityType', 'collectionSlug']));
  if (!value) return undefined;
  if (['work', 'works', 'mediawork', 'mediaworks', 'media-work', 'media-works'].includes(value)) return 'works';
  if (['creator', 'creators', 'person', 'persons', 'people', 'staff'].includes(value)) return 'creators';
  if (['organization', 'organizations', 'org', 'orgs', 'company', 'companies', 'publisher', 'publishers', 'studio', 'studios'].includes(value)) return 'organizations';
  return undefined;
}

function createKindIndex() {
  return {
    bySourceKey: new Map(),
    byName: new Map(),
    all: [],
  };
}

function pushMap(map, key, entry) {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return;
  const list = map.get(normalizedKey) ?? [];
  if (!list.some((item) => item.payloadId === entry.payloadId)) list.push(entry);
  map.set(normalizedKey, list);
}

function addIndexEntry(indexes, kind, payloadId, sourceKeys, name, pathParts, raw) {
  if (!kind || payloadId === undefined) return;
  const entry = {
    kind,
    payloadId,
    sourceKeys: [...new Set(sourceKeys.filter(Boolean).map(String))],
    name: name ? String(name).trim() : undefined,
    path: pathParts.join('.'),
  };
  indexes[kind].all.push(entry);
  for (const sourceKey of entry.sourceKeys) pushMap(indexes[kind].bySourceKey, sourceKey, entry);
  if (entry.name) pushMap(indexes[kind].byName, entry.name, entry);

  // A direct map like { creators: { "Alice": 123 } } uses the object key as the only name.
  if (!entry.name && raw?.directMapKey) pushMap(indexes[kind].byName, raw.directMapKey, entry);
}

export function buildIdIndexes(idMap) {
  const indexes = {
    works: createKindIndex(),
    creators: createKindIndex(),
    organizations: createKindIndex(),
  };

  function visit(node, pathParts = []) {
    const pathKind = kindFromPath(pathParts);

    if (isPlainObject(node)) {
      const currentKind = kindFromObject(node) ?? pathKind;
      const payloadId = getPayloadIdFromMapObject(node);
      if (currentKind && payloadId !== undefined) {
        addIndexEntry(indexes, currentKind, payloadId, collectSourceKeys(node), getName(node), pathParts, node);
      }

      // Support direct lookup maps, e.g. { works: { "bangumi-21096": 985 } }.
      if (pathKind) {
        for (const [key, value] of Object.entries(node)) {
          if (isScalar(value) && !/total|count|error|warning|info|status/i.test(key)) {
            const directPayloadId = numericOrStringId(value);
            if (directPayloadId !== undefined) {
              const sourceKeys = bangumiKeyVariants(key);
              const directName = /^\d+$|bangumi-|bgm-|subject-/i.test(key) ? undefined : key;
              addIndexEntry(indexes, pathKind, directPayloadId, sourceKeys, directName, [...pathParts, key], { directMapKey: key });
            }
          }
        }
      }

      for (const [key, value] of Object.entries(node)) visit(value, [...pathParts, key]);
    } else if (Array.isArray(node)) {
      node.forEach((value, index) => visit(value, [...pathParts, String(index)]));
    }
  }

  visit(idMap);

  return indexes;
}

function objectLooksLikeWork(obj) {
  if (!isPlainObject(obj)) return false;
  const hasTitle = firstValue(obj, ['title', 'name', 'sourceTitle']) !== undefined;
  const hasSource = collectSourceKeys(obj).length > 0;
  const hasRelationArray = ['creators', 'creatorCredits', 'organizations', 'persons', 'staff', 'companies', 'publishers', 'studios'].some((key) => Array.isArray(obj[key]));
  return (hasTitle && hasSource) || hasRelationArray;
}

export function extractPackageWorks(packagePreview) {
  if (Array.isArray(packagePreview)) return packagePreview.filter(objectLooksLikeWork);

  const candidates = [
    packagePreview?.works,
    packagePreview?.mediaWorks,
    packagePreview?.media_works,
    packagePreview?.items,
    packagePreview?.data?.works,
    packagePreview?.data?.mediaWorks,
    packagePreview?.package?.works,
    packagePreview?.package?.mediaWorks,
    packagePreview?.preview?.works,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.some(objectLooksLikeWork)) return candidate.filter(objectLooksLikeWork);
  }

  // Last resort: find the largest array whose objects look like works.
  let best = [];
  function scan(node) {
    if (Array.isArray(node)) {
      const workish = node.filter(objectLooksLikeWork);
      if (workish.length > best.length) best = workish;
      node.forEach(scan);
    } else if (isPlainObject(node)) {
      Object.values(node).forEach(scan);
    }
  }
  scan(packagePreview);
  return best;
}

function getWorkSourceKeys(work) {
  return collectSourceKeys(work);
}

function getWorkTitle(work) {
  return firstValue(work, ['title', 'name', 'sourceTitle', 'package.title', 'input.title']) ?? '(untitled)';
}

const CREATOR_PATH_RE = /(^|\.)(creators?|creatorcredits?|persons?|people|staff|authors?|artists?|illustrators?|writers?|originalcreators?)(\.|$)/i;
const ORG_PATH_RE = /(^|\.)(organizations?|orgs?|companies?|publishers?|studios?|labels?|magazines?|serialization|serializations)(\.|$)/i;

const ROLE_PATHS = [
  'role',
  'roles',
  'credit',
  'credits',
  'job',
  'jobs',
  'position',
  'relation',
  'relationType',
  'roleName',
  'staffRole',
  'creditRole',
  'type',
];

function roleValuesFromObject(obj) {
  const roles = [];
  for (const keyPath of ROLE_PATHS) {
    const value = firstValue(obj, [keyPath]);
    for (const item of asArray(value)) {
      if (isScalar(item)) roles.push(String(item).trim());
      else if (isPlainObject(item)) {
        const nested = getName(item) ?? firstValue(item, ['value', 'label']);
        if (nested) roles.push(String(nested).trim());
      }
    }
  }
  return [...new Set(roles.filter(Boolean))];
}

function entityRefFromItem(item, pathParts, kind) {
  if (item === undefined || item === null || item === '') return undefined;
  if (isScalar(item)) {
    return {
      kind,
      name: String(item).trim(),
      sourceKeys: bangumiKeyVariants(item),
      roles: [],
      sourcePath: pathParts.join('.'),
      sourceShape: 'scalar',
    };
  }
  if (!isPlainObject(item)) return undefined;

  const name = getName(item);
  const sourceKeys = collectSourceKeys(item);
  const roles = roleValuesFromObject(item);
  const ref = {
    kind,
    name: name ? String(name).trim() : undefined,
    sourceKeys,
    roles,
    sourcePath: pathParts.join('.'),
    sourceShape: 'object',
  };

  if (!ref.name && ref.sourceKeys.length === 0) return undefined;
  return ref;
}

function dedupeRefs(refs) {
  const seen = new Set();
  const result = [];
  for (const ref of refs) {
    const key = JSON.stringify({
      kind: ref.kind,
      name: normalizeText(ref.name),
      sourceKeys: [...ref.sourceKeys].map(normalizeText).sort(),
      roles: [...ref.roles].map(normalizeText).sort(),
      sourcePath: ref.sourcePath,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

export function extractEntityRefsFromWork(work, kind) {
  const refs = [];
  const pathRe = kind === 'creators' ? CREATOR_PATH_RE : ORG_PATH_RE;

  function scan(node, pathParts = []) {
    if (Array.isArray(node)) {
      const pathText = pathParts.join('.');
      if (pathRe.test(pathText)) {
        for (let i = 0; i < node.length; i += 1) {
          const ref = entityRefFromItem(node[i], [...pathParts, String(i)], kind);
          if (ref) refs.push(ref);
        }
      } else {
        node.forEach((item, index) => scan(item, [...pathParts, String(index)]));
      }
      return;
    }

    if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) scan(value, [...pathParts, key]);
    }
  }

  scan(work);
  return dedupeRefs(refs);
}

function lookupOne(index, refOrWork, fallbackName) {
  const sourceKeys = refOrWork.sourceKeys ?? collectSourceKeys(refOrWork);
  for (const sourceKey of sourceKeys) {
    const matches = index.bySourceKey.get(normalizeText(sourceKey)) ?? [];
    if (matches.length === 1) return { status: 'matched', matchBy: 'sourceKey', key: sourceKey, entry: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous', matchBy: 'sourceKey', key: sourceKey, matches };
  }

  const name = refOrWork.name ?? fallbackName ?? getName(refOrWork);
  if (name) {
    const matches = index.byName.get(normalizeText(name)) ?? [];
    if (matches.length === 1) return { status: 'matched', matchBy: 'name', key: name, entry: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous', matchBy: 'name', key: name, matches };
  }

  return { status: 'missing', matchBy: undefined, key: sourceKeys[0] ?? name ?? undefined, matches: [] };
}

function resolveEntityRefs(refs, index) {
  const links = [];
  const unresolved = [];
  const ambiguous = [];

  for (const ref of refs) {
    const lookup = lookupOne(index, ref, ref.name);
    const base = {
      name: ref.name,
      sourceKeys: ref.sourceKeys,
      roles: ref.roles,
      sourcePath: ref.sourcePath,
    };

    if (lookup.status === 'matched') {
      links.push({
        ...base,
        payloadId: lookup.entry.payloadId,
        matchedName: lookup.entry.name,
        matchBy: lookup.matchBy,
        matchKey: lookup.key,
      });
    } else if (lookup.status === 'ambiguous') {
      ambiguous.push({
        ...base,
        matchBy: lookup.matchBy,
        matchKey: lookup.key,
        candidates: lookup.matches.map((entry) => ({ payloadId: entry.payloadId, name: entry.name, sourceKeys: entry.sourceKeys })),
      });
    } else {
      unresolved.push(base);
    }
  }

  return {
    links: dedupeLinks(links),
    unresolved,
    ambiguous,
  };
}

function dedupeLinks(links) {
  const byIdAndRoles = new Map();
  for (const link of links) {
    const key = JSON.stringify({
      payloadId: link.payloadId,
      roles: [...(link.roles ?? [])].map(normalizeText).sort(),
      sourcePath: link.sourcePath,
    });
    if (!byIdAndRoles.has(key)) byIdAndRoles.set(key, link);
  }
  return [...byIdAndRoles.values()];
}

function uniquePayloadIds(links) {
  return [...new Set(links.map((link) => link.payloadId).filter((id) => id !== undefined && id !== null))];
}

function creatorCreditsFromLinks(links) {
  return links.map((link, index) => ({
    creator: link.payloadId,
    creatorId: link.payloadId,
    name: link.matchedName ?? link.name,
    roles: link.roles ?? [],
    order: index + 1,
    sourcePath: link.sourcePath,
    matchBy: link.matchBy,
    matchKey: link.matchKey,
  }));
}

function organizationCreditsFromLinks(links) {
  return links.map((link, index) => ({
    organization: link.payloadId,
    organizationId: link.payloadId,
    name: link.matchedName ?? link.name,
    roles: link.roles ?? [],
    order: index + 1,
    sourcePath: link.sourcePath,
    matchBy: link.matchBy,
    matchKey: link.matchKey,
  }));
}

export function buildWorkEntityLinkPlan(packagePreview, idMap, options = {}) {
  const indexes = buildIdIndexes(idMap);
  const works = extractPackageWorks(packagePreview);
  const items = [];
  const errors = [];
  const warnings = [];
  const infos = [];

  works.forEach((work, index) => {
    const title = String(getWorkTitle(work));
    const sourceKeys = getWorkSourceKeys(work);
    const workLookup = lookupOne(indexes.works, { sourceKeys, name: title }, title);
    const itemWarnings = [];
    const itemErrors = [];

    let payloadWorkId;
    if (workLookup.status === 'matched') {
      payloadWorkId = workLookup.entry.payloadId;
    } else if (workLookup.status === 'ambiguous') {
      itemErrors.push({ code: 'work_ambiguous', message: `Package work matched multiple Payload works: ${title}`, candidates: workLookup.matches });
    } else {
      itemErrors.push({ code: 'work_missing', message: `Package work was not found in id map: ${title}` });
    }

    const creatorRefs = extractEntityRefsFromWork(work, 'creators');
    const organizationRefs = extractEntityRefsFromWork(work, 'organizations');
    const resolvedCreators = resolveEntityRefs(creatorRefs, indexes.creators);
    const resolvedOrganizations = resolveEntityRefs(organizationRefs, indexes.organizations);

    if (creatorRefs.length === 0) itemWarnings.push({ code: 'no_creator_refs', message: 'No creator references found in package work.' });
    if (organizationRefs.length === 0) itemWarnings.push({ code: 'no_organization_refs', message: 'No organization references found in package work.' });

    for (const ref of resolvedCreators.unresolved) itemErrors.push({ code: 'creator_missing', message: `Creator not found in id map: ${ref.name ?? ref.sourceKeys?.join(', ')}`, ref });
    for (const ref of resolvedCreators.ambiguous) itemErrors.push({ code: 'creator_ambiguous', message: `Creator matched multiple Payload docs: ${ref.name ?? ref.matchKey}`, ref });
    for (const ref of resolvedOrganizations.unresolved) itemErrors.push({ code: 'organization_missing', message: `Organization not found in id map: ${ref.name ?? ref.sourceKeys?.join(', ')}`, ref });
    for (const ref of resolvedOrganizations.ambiguous) itemErrors.push({ code: 'organization_ambiguous', message: `Organization matched multiple Payload docs: ${ref.name ?? ref.matchKey}`, ref });

    const creatorLinks = resolvedCreators.links;
    const organizationLinks = resolvedOrganizations.links;

    items.push({
      packageIndex: index,
      work: {
        payloadId: payloadWorkId,
        title,
        sourceKeys,
        matchBy: workLookup.matchBy,
        matchKey: workLookup.key,
      },
      links: {
        creators: uniquePayloadIds(creatorLinks),
        creatorCredits: creatorCreditsFromLinks(creatorLinks),
        organizations: uniquePayloadIds(organizationLinks),
        organizationCredits: organizationCreditsFromLinks(organizationLinks),
      },
      sourceRefs: {
        creators: creatorRefs,
        organizations: organizationRefs,
      },
      resolvedRefs: {
        creators: creatorLinks,
        organizations: organizationLinks,
      },
      unresolvedRefs: {
        creators: resolvedCreators.unresolved,
        organizations: resolvedOrganizations.unresolved,
      },
      ambiguousRefs: {
        creators: resolvedCreators.ambiguous,
        organizations: resolvedOrganizations.ambiguous,
      },
      warnings: itemWarnings,
      errors: itemErrors,
    });
  });

  const counts = {
    packageWorksTotal: works.length,
    plannedWorksTotal: items.length,
    plannedWorksWithPayloadIdTotal: items.filter((item) => item.work.payloadId !== undefined).length,
    creatorRefsTotal: items.reduce((sum, item) => sum + item.sourceRefs.creators.length, 0),
    creatorLinksTotal: items.reduce((sum, item) => sum + item.links.creatorCredits.length, 0),
    creatorRelationshipIdsTotal: items.reduce((sum, item) => sum + item.links.creators.length, 0),
    organizationRefsTotal: items.reduce((sum, item) => sum + item.sourceRefs.organizations.length, 0),
    organizationLinksTotal: items.reduce((sum, item) => sum + item.links.organizationCredits.length, 0),
    organizationRelationshipIdsTotal: items.reduce((sum, item) => sum + item.links.organizations.length, 0),
    unresolvedCreatorRefsTotal: items.reduce((sum, item) => sum + item.unresolvedRefs.creators.length, 0),
    unresolvedOrganizationRefsTotal: items.reduce((sum, item) => sum + item.unresolvedRefs.organizations.length, 0),
    ambiguousCreatorRefsTotal: items.reduce((sum, item) => sum + item.ambiguousRefs.creators.length, 0),
    ambiguousOrganizationRefsTotal: items.reduce((sum, item) => sum + item.ambiguousRefs.organizations.length, 0),
    itemErrorsTotal: items.reduce((sum, item) => sum + item.errors.length, 0),
    itemWarningsTotal: items.reduce((sum, item) => sum + item.warnings.length, 0),
  };

  if (works.length === 0) errors.push({ code: 'no_package_works', message: 'No package works were found in the package preview input.' });
  if (counts.itemErrorsTotal > 0) errors.push({ code: 'item_errors', message: `${counts.itemErrorsTotal} item-level errors found.` });
  if (counts.itemWarningsTotal > 0) warnings.push({ code: 'item_warnings', message: `${counts.itemWarningsTotal} item-level warnings found.` });

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'local-plan-only/no-payload-reads/no-payload-writes/no-relation-patch/no-cover-upload',
    inputs: options.inputs ?? {},
    outputs: options.outputs ?? {},
    counts,
    indexes: {
      works: indexes.works.all.length,
      creators: indexes.creators.all.length,
      organizations: indexes.organizations.all.length,
    },
    status: errors.length === 0 && counts.itemErrorsTotal === 0 ? 'ready' : 'needs-review',
    errors,
    warnings,
    infos,
    items,
  };
}

export function renderPlanMarkdown(plan) {
  const lines = [];
  lines.push('# BGM Work Entity Link Plan');
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
  lines.push('');
  lines.push('## Planned work links');
  lines.push('');
  lines.push('| # | workId | title | creators | creatorCredits | organizations | warnings | errors |');
  lines.push('| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const item of plan.items) {
    lines.push(`| ${item.packageIndex + 1} | ${item.work.payloadId ?? ''} | ${escapeMd(item.work.title)} | ${item.links.creators.length} | ${item.links.creatorCredits.length} | ${item.links.organizations.length} | ${item.warnings.length} | ${item.errors.length} |`);
  }

  const problematic = plan.items.filter((item) => item.errors.length > 0 || item.warnings.length > 0);
  if (problematic.length > 0) {
    lines.push('');
    lines.push('## Review items');
    for (const item of problematic) {
      lines.push('');
      lines.push(`### ${item.packageIndex + 1}. ${item.work.title}`);
      if (item.warnings.length > 0) {
        lines.push('');
        lines.push('Warnings:');
        for (const warning of item.warnings) lines.push(`- ${warning.code}: ${warning.message}`);
      }
      if (item.errors.length > 0) {
        lines.push('');
        lines.push('Errors:');
        for (const error of item.errors) lines.push(`- ${error.code}: ${error.message}`);
      }
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function escapeMd(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main() {
  const repoRoot = resolveFromRoot(process.cwd(), argValue('repo-root', repoRootFromScript()));
  const packagePath = resolveFromRoot(repoRoot, argValue('package', DEFAULT_PATHS.packagePreview));
  const idMapPath = resolveFromRoot(repoRoot, argValue('id-map', DEFAULT_PATHS.idMap));
  const planJsonPath = resolveFromRoot(repoRoot, argValue('out-json', DEFAULT_PATHS.planJson));
  const planMdPath = resolveFromRoot(repoRoot, argValue('out-md', DEFAULT_PATHS.planMarkdown));

  const packagePreview = await readJson(packagePath);
  const idMap = await readJson(idMapPath);
  const plan = buildWorkEntityLinkPlan(packagePreview, idMap, {
    inputs: {
      packagePreview: path.relative(repoRoot, packagePath),
      idMap: path.relative(repoRoot, idMapPath),
    },
    outputs: {
      planJson: path.relative(repoRoot, planJsonPath),
      planMarkdown: path.relative(repoRoot, planMdPath),
    },
  });

  await writeJson(planJsonPath, plan);
  await writeText(planMdPath, renderPlanMarkdown(plan));

  console.log(`Plan status: ${plan.status}`);
  console.log(`works=${plan.counts.plannedWorksTotal}; creatorLinks=${plan.counts.creatorLinksTotal}; organizationLinks=${plan.counts.organizationLinksTotal}; errors=${plan.counts.itemErrorsTotal + plan.errors.length}; warnings=${plan.counts.itemWarningsTotal + plan.warnings.length}`);
  console.log(`Wrote ${path.relative(repoRoot, planJsonPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, planMdPath)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
