#!/usr/bin/env node
/*
  Inspect why a baseline radar seed is attached to more than one merge group.

  Safety:
  - Reads local staging files only.
  - Does not write Payload.
  - Does not write PostgreSQL.
  - Does not change production code.
*/

const fs = require('fs');
const path = require('path');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true';
    args.set(key, val);
  }
}

const stagingDir = args.get('staging-dir') || path.join('data_local', 'staging', 'merge-groups-v2');
const seedPath = args.get('seed') || path.join('data_local', 'staging', 'website-review-backend', 'baseline-radar-public-seed-v02.jsonl');
const groupsPath = args.get('groups') || path.join(stagingDir, 'merge-groups-v2-dryrun.jsonl');
const seedId = args.get('seed-id') || 'seed-0017-百合男子';
const outDir = args.get('out-dir') || stagingDir;

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function normTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・･:：;；,，.。!！?？\-—_~～"“”'‘’()（）\[\]【】{}<>《》]/g, '');
}

function seedTitles(seed) {
  return [
    seed.reviewGroupKey,
    seed.canonicalReviewTitle,
    ...(seed.displayTitles || []),
  ].filter(Boolean);
}

function groupTitles(group) {
  return [
    group.canonicalTitle,
    group.titleNorm,
    ...(group.displayTitles || []),
  ].filter(Boolean);
}

fs.mkdirSync(outDir, { recursive: true });

const seeds = readJsonl(seedPath);
const groups = readJsonl(groupsPath);
const seed = seeds.find(x => x.seedId === seedId);
if (!seed) throw new Error(`Seed not found: ${seedId}`);

const titleIndex = new Map();
const keyIndex = new Map();

for (const group of groups) {
  for (const title of groupTitles(group)) {
    const n = normTitle(title);
    if (!n) continue;
    if (!titleIndex.has(n)) titleIndex.set(n, []);
    titleIndex.get(n).push({ group, matchedTitle: title, normalizedTitle: n });
  }

  for (const key of group.localWorkKeys || []) {
    if (!keyIndex.has(key)) keyIndex.set(key, []);
    keyIndex.get(key).push(group);
  }
}

const exactTitleMatches = [];
for (const title of seedTitles(seed)) {
  const n = normTitle(title);
  for (const hit of titleIndex.get(n) || []) {
    exactTitleMatches.push({
      seedTitle: title,
      normalizedTitle: n,
      mergeGroupId: hit.group.mergeGroupId,
      canonicalTitle: hit.group.canonicalTitle,
      titleNorm: hit.group.titleNorm,
      mediaTypes: hit.group.mediaTypes || [],
      sourceCandidateIds: hit.group.sourceCandidateIds || [],
      localWorkKeys: hit.group.localWorkKeys || [],
      matchedGroupTitle: hit.matchedTitle,
    });
  }
}

const localWorkKeyMatches = [];
for (const key of seed.localWorkKeys || []) {
  for (const group of keyIndex.get(key) || []) {
    localWorkKeyMatches.push({
      key,
      mergeGroupId: group.mergeGroupId,
      canonicalTitle: group.canonicalTitle,
      titleNorm: group.titleNorm,
      mediaTypes: group.mediaTypes || [],
      sourceCandidateIds: group.sourceCandidateIds || [],
      localWorkKeys: group.localWorkKeys || [],
    });
  }
}

const currentAttachments = [];
for (const group of groups) {
  for (const ref of group.radarSeedRefs || []) {
    if (ref.seedId === seedId) {
      currentAttachments.push({
        mergeGroupId: group.mergeGroupId,
        canonicalTitle: group.canonicalTitle,
        titleNorm: group.titleNorm,
        mediaTypes: group.mediaTypes || [],
        sourceCandidateIds: group.sourceCandidateIds || [],
        localWorkKeys: group.localWorkKeys || [],
      });
    }
  }
}

const exactGroupIds = [...new Set(exactTitleMatches.map(x => x.mergeGroupId))];
const keyGroupIds = [...new Set(localWorkKeyMatches.map(x => x.mergeGroupId))];
const extraKeyMatches = localWorkKeyMatches.filter(x => !exactGroupIds.includes(x.mergeGroupId));

const diagnosis = {
  seedId,
  seed: {
    reviewGroupKey: seed.reviewGroupKey,
    canonicalReviewTitle: seed.canonicalReviewTitle,
    displayTitles: seed.displayTitles || [],
    mediaTypes: seed.mediaTypes || [],
    localWorkKeys: seed.localWorkKeys || [],
  },
  exactTitleMatchGroupIds: exactGroupIds,
  localWorkKeyMatchGroupIds: keyGroupIds,
  currentAttachmentGroupIds: currentAttachments.map(x => x.mergeGroupId),
  exactTitleMatches,
  localWorkKeyMatches,
  extraLocalWorkKeyMatchesOutsideExactTitle: extraKeyMatches,
  conclusion: exactGroupIds.length === 1 && extraKeyMatches.length
    ? 'Exact normalized title uniquely points to one group, but at least one broad localWorkKey points to another group. Prefer the unique exact title match and route the extra key hit to a review/ambiguity queue.'
    : 'Review exactTitleMatches and localWorkKeyMatches for the duplicate attachment cause.',
  safety: {
    noPayloadWrite: true,
    noPostgresqlWrite: true,
    noProductionCodeChange: true,
  },
};

const jsonOut = path.join(outDir, 'inspect-radar-seed-attachment-duplicate.json');
const mdOut = path.join(outDir, 'inspect-radar-seed-attachment-duplicate.md');

fs.writeFileSync(jsonOut, JSON.stringify(diagnosis, null, 2));

function bulletRows(rows, format) {
  if (!rows.length) return ['- none'];
  return rows.map(format);
}

const md = [
  '# Inspect Radar Seed Attachment Duplicate',
  '',
  '## Target',
  '',
  `- seedId: ${seedId}`,
  `- canonicalReviewTitle: ${seed.canonicalReviewTitle || ''}`,
  `- reviewGroupKey: ${seed.reviewGroupKey || ''}`,
  `- displayTitles: ${(seed.displayTitles || []).join(' | ')}`,
  `- localWorkKeys: ${(seed.localWorkKeys || []).join(' | ')}`,
  '',
  '## Current attachments',
  '',
  ...bulletRows(currentAttachments, x => `- ${x.mergeGroupId}: ${x.canonicalTitle} | localWorkKeys=${(x.localWorkKeys || []).join(' | ')}`),
  '',
  '## Exact normalized title matches',
  '',
  ...bulletRows(exactTitleMatches, x => `- ${x.mergeGroupId}: ${x.canonicalTitle} | seedTitle=${x.seedTitle} | normalized=${x.normalizedTitle}`),
  '',
  '## Local work key matches',
  '',
  ...bulletRows(localWorkKeyMatches, x => `- ${x.key} -> ${x.mergeGroupId}: ${x.canonicalTitle}`),
  '',
  '## Extra local key matches outside exact title match',
  '',
  ...bulletRows(extraKeyMatches, x => `- ${x.key} -> ${x.mergeGroupId}: ${x.canonicalTitle}`),
  '',
  '## Conclusion',
  '',
  diagnosis.conclusion,
  '',
  '## Safety',
  '',
  '- No Payload write.',
  '- No PostgreSQL write.',
  '- No production code change.',
].join('\n');

fs.writeFileSync(mdOut, md);

console.log(JSON.stringify({
  ok: true,
  jsonOut,
  mdOut,
  conclusion: diagnosis.conclusion,
}, null, 2));
