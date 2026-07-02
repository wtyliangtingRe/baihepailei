#!/usr/bin/env node
/*
  Recompute baseline radar seed attachment for Merge Groups v2 dry-run with safer priority.

  Safety:
  - Reads local staging/dry-run files only.
  - Writes new v02 dry-run/QA artifacts only.
  - Does not write Payload.
  - Does not write PostgreSQL.
  - Does not change production code.

  Attachment priority:
  1. Unique exact normalized title match.
  2. Unique strong localWorkKey match, only when there is no exact title match.
     Weak row-* keys are never sufficient by themselves.
  3. No automatic attachment when matches are ambiguous or only weak keys match; route to review queues.

  If a unique exact title match exists, localWorkKey hits to other groups are ignored for
  attachment and written to radarAttachmentAmbiguityQueue for human review.
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
const outDir = args.get('out-dir') || stagingDir;
const prefix = args.get('prefix') || 'merge-groups-v2-dryrun-v02';

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
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

function uniqueBy(items, keyFn) {
  const m = new Map();
  for (const item of items) m.set(keyFn(item), item);
  return [...m.values()];
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(filePath, rows, columns) {
  const out = [columns.join(',')];
  for (const row of rows) out.push(columns.map(c => csvEscape(row[c])).join(','));
  fs.writeFileSync(filePath, out.join('\n') + '\n');
}

function makeRadarSeedRef(seed, method, matchedBy) {
  return {
    seedId: seed.seedId,
    reviewGroupKey: seed.reviewGroupKey,
    canonicalReviewTitle: seed.canonicalReviewTitle,
    currentRatingGrade: seed.currentRatingGrade,
    currentRatingClass: seed.currentRatingClass,
    possibleRatingClasses: seed.possibleRatingClasses || [],
    confidence: seed.confidence,
    reviewStatus: seed.reviewStatus,
    publicNoticeTitle: seed.publicNoticeTitle || 'AI 综合，待复核',
    usePolicy: 'AI 综合，待复核 radar review data only',
    attachmentMethod: method,
    matchedBy,
    attachmentVersion: 'merge-groups-v2-dryrun-v02',
  };
}

function isWeakLocalWorkKey(key) {
  return /^row-\d+$/i.test(String(key || ''));
}

fs.mkdirSync(outDir, { recursive: true });

const seeds = readJsonl(seedPath);
const originalGroups = readJsonl(groupsPath);

const groups = originalGroups.map(g => {
  const clone = JSON.parse(JSON.stringify(g));
  clone.radarSeedRefs = [];
  clone.reviewReasons = (clone.reviewReasons || []).filter(x => x !== 'attached baseline radar seed v0.2');
  return clone;
});

const groupById = new Map(groups.map(g => [g.mergeGroupId, g]));
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

const attachmentDecisions = [];
const radarOnlyQueue = [];
const ambiguityQueue = [];

for (const seed of seeds) {
  const exactTitleHits = [];

  for (const seedTitle of seedTitles(seed)) {
    const normalizedTitle = normTitle(seedTitle);
    for (const hit of titleIndex.get(normalizedTitle) || []) {
      exactTitleHits.push({
        ...hit,
        seedTitle,
      });
    }
  }

  const uniqueExactGroups = uniqueBy(exactTitleHits.map(x => x.group), g => g.mergeGroupId);

  const keyHits = [];
  for (const key of seed.localWorkKeys || []) {
    for (const group of keyIndex.get(key) || []) {
      keyHits.push({ key, group, weak: isWeakLocalWorkKey(key) });
    }
  }

  const strongKeyHits = keyHits.filter(x => !x.weak);
  const weakKeyHits = keyHits.filter(x => x.weak);

  const uniqueStrongKeyGroups = uniqueBy(strongKeyHits.map(x => x.group), g => g.mergeGroupId);
  const uniqueWeakKeyGroups = uniqueBy(weakKeyHits.map(x => x.group), g => g.mergeGroupId);

  let selected = null;
  let method = '';
  let matchedBy = '';
  let reason = '';

  if (uniqueExactGroups.length === 1) {
    selected = uniqueExactGroups[0];
    method = 'exact_normalized_title_unique';

    const hit = exactTitleHits.find(x => x.group.mergeGroupId === selected.mergeGroupId);
    matchedBy = `title:${hit ? hit.seedTitle : seed.canonicalReviewTitle}`;
    reason = 'unique exact normalized title match';

    for (const kh of keyHits) {
      if (kh.group.mergeGroupId !== selected.mergeGroupId) {
        ambiguityQueue.push({
          seedId: seed.seedId,
          canonicalReviewTitle: seed.canonicalReviewTitle || '',
          reviewGroupKey: seed.reviewGroupKey || '',
          reason: 'ignored_local_work_key_hit_because_exact_title_was_unique',
          selectedMergeGroupId: selected.mergeGroupId,
          selectedCanonicalTitle: selected.canonicalTitle || '',
          selectedMethod: method,
          conflictMergeGroupId: kh.group.mergeGroupId,
          conflictCanonicalTitle: kh.group.canonicalTitle || '',
          conflictByKey: kh.key,
          conflictByTitle: '',
          action: 'attach to exact title group only; review conflicting localWorkKey',
        });
      }
    }
  } else if (uniqueExactGroups.length > 1) {
    reason = 'ambiguous exact normalized title matches';

    for (const hit of exactTitleHits) {
      ambiguityQueue.push({
        seedId: seed.seedId,
        canonicalReviewTitle: seed.canonicalReviewTitle || '',
        reviewGroupKey: seed.reviewGroupKey || '',
        reason,
        selectedMergeGroupId: '',
        selectedCanonicalTitle: '',
        selectedMethod: '',
        conflictMergeGroupId: hit.group.mergeGroupId,
        conflictCanonicalTitle: hit.group.canonicalTitle || '',
        conflictByKey: '',
        conflictByTitle: hit.seedTitle || '',
        action: 'manual radar attachment review required',
      });
    }
  } else if (uniqueStrongKeyGroups.length === 1) {
    selected = uniqueStrongKeyGroups[0];
    method = 'strong_local_work_key_unique_no_exact_title';

    const hit = strongKeyHits.find(x => x.group.mergeGroupId === selected.mergeGroupId);
    matchedBy = `localWorkKey:${hit ? hit.key : ''}`;
    reason = 'unique strong localWorkKey match and no exact title match';
  } else if (uniqueStrongKeyGroups.length > 1) {
    reason = 'ambiguous strong localWorkKey matches and no exact title match';

    for (const hit of strongKeyHits) {
      ambiguityQueue.push({
        seedId: seed.seedId,
        canonicalReviewTitle: seed.canonicalReviewTitle || '',
        reviewGroupKey: seed.reviewGroupKey || '',
        reason,
        selectedMergeGroupId: '',
        selectedCanonicalTitle: '',
        selectedMethod: '',
        conflictMergeGroupId: hit.group.mergeGroupId,
        conflictCanonicalTitle: hit.group.canonicalTitle || '',
        conflictByKey: hit.key,
        conflictByTitle: '',
        action: 'manual radar attachment review required',
      });
    }
  } else if (uniqueWeakKeyGroups.length > 0) {
    reason = 'weak row localWorkKey match only and no exact title match';

    for (const hit of weakKeyHits) {
      ambiguityQueue.push({
        seedId: seed.seedId,
        canonicalReviewTitle: seed.canonicalReviewTitle || '',
        reviewGroupKey: seed.reviewGroupKey || '',
        reason,
        selectedMergeGroupId: '',
        selectedCanonicalTitle: '',
        selectedMethod: '',
        conflictMergeGroupId: hit.group.mergeGroupId,
        conflictCanonicalTitle: hit.group.canonicalTitle || '',
        conflictByKey: hit.key,
        conflictByTitle: '',
        action: 'do not auto-attach from weak row-* key; manual radar attachment review required',
      });
    }
  } else {
    reason = 'no exact title or localWorkKey match';
  }

  if (selected) {
    const target = groupById.get(selected.mergeGroupId);

    target.radarSeedRefs.push(makeRadarSeedRef(seed, method, matchedBy));

    if (!target.reviewReasons.includes('attached baseline radar seed v0.2')) {
      target.reviewReasons.push('attached baseline radar seed v0.2');
    }

    attachmentDecisions.push({
      seedId: seed.seedId,
      canonicalReviewTitle: seed.canonicalReviewTitle || '',
      selectedMergeGroupId: selected.mergeGroupId,
      selectedCanonicalTitle: selected.canonicalTitle || '',
      method,
      matchedBy,
      reason,
    });
  } else {
    radarOnlyQueue.push({
      seedId: seed.seedId,
      canonicalReviewTitle: seed.canonicalReviewTitle || '',
      reviewGroupKey: seed.reviewGroupKey || '',
      mediaTypes: (seed.mediaTypes || []).join('|'),
      currentRatingGrade: seed.currentRatingGrade || '',
      currentRatingClass: seed.currentRatingClass || '',
      confidence: seed.confidence || '',
      reviewStatus: seed.reviewStatus || '',
      reason,
      localWorkKeys: (seed.localWorkKeys || []).join('|'),
    });
  }
}

const outJsonl = path.join(outDir, `${prefix}.jsonl`);
const outJson = path.join(outDir, `${prefix}.json`);
const summaryPath = path.join(outDir, `${prefix}-summary.json`);
const previewPath = path.join(outDir, `${prefix}-preview.md`);

const decisionsCsv = path.join(outDir, 'merge-groups-v2-radar-attachment-decisions-v02.csv');
const radarOnlyCsv = path.join(outDir, 'merge-groups-v2-radar-only-review-queue-v02.csv');
const ambiguityCsv = path.join(outDir, 'merge-groups-v2-radar-attachment-ambiguity-queue-v02.csv');

const qaJsonPath = path.join(outDir, `${prefix}-qa.json`);
const qaMdPath = path.join(outDir, `${prefix}-qa.md`);

writeJsonl(outJsonl, groups);
fs.writeFileSync(outJson, JSON.stringify(groups, null, 2));

writeCsv(decisionsCsv, attachmentDecisions, [
  'seedId',
  'canonicalReviewTitle',
  'selectedMergeGroupId',
  'selectedCanonicalTitle',
  'method',
  'matchedBy',
  'reason',
]);

writeCsv(radarOnlyCsv, radarOnlyQueue, [
  'seedId',
  'canonicalReviewTitle',
  'reviewGroupKey',
  'mediaTypes',
  'currentRatingGrade',
  'currentRatingClass',
  'confidence',
  'reviewStatus',
  'reason',
  'localWorkKeys',
]);

writeCsv(ambiguityCsv, ambiguityQueue, [
  'seedId',
  'canonicalReviewTitle',
  'reviewGroupKey',
  'reason',
  'selectedMergeGroupId',
  'selectedCanonicalTitle',
  'selectedMethod',
  'conflictMergeGroupId',
  'conflictCanonicalTitle',
  'conflictByKey',
  'conflictByTitle',
  'action',
]);

const attachedBySeed = new Map();
let totalAttachments = 0;

for (const group of groups) {
  for (const ref of group.radarSeedRefs || []) {
    totalAttachments += 1;

    if (!attachedBySeed.has(ref.seedId)) attachedBySeed.set(ref.seedId, []);
    attachedBySeed.get(ref.seedId).push({
      mergeGroupId: group.mergeGroupId,
      canonicalTitle: group.canonicalTitle,
    });
  }
}

const duplicateAttachedSeeds = [...attachedBySeed.entries()]
  .filter(([, hits]) => hits.length > 1)
  .map(([seedId, hits]) => ({ seedId, count: hits.length, hits }));

const sourceCandidatesGrouped = groups.reduce((sum, g) => sum + (g.sourceCandidateIds || []).length, 0);
const multiSourceGroups = groups.filter(g => (g.sourceCandidateIds || []).length > 1).length;
const groupsWithRadarSeedRefs = groups.filter(g => (g.radarSeedRefs || []).length > 0).length;

const groupIds = groups.map(g => g.mergeGroupId);
const duplicateMergeGroupIds = groupIds.filter((x, i) => groupIds.indexOf(x) !== i);

const radarOnlyIds = new Set(radarOnlyQueue.map(x => x.seedId));
const attachedIds = new Set(attachedBySeed.keys());
const ambiguityIds = new Set(ambiguityQueue.map(x => x.seedId));

const missingRadarSeeds = seeds
  .filter(seed => !attachedIds.has(seed.seedId) && !radarOnlyIds.has(seed.seedId) && !ambiguityIds.has(seed.seedId))
  .map(seed => seed.seedId);

const radarSeedsBothAttachedAndRadarOnly = [...attachedIds].filter(id => radarOnlyIds.has(id));

const blockers = [];
if (duplicateMergeGroupIds.length) blockers.push(`duplicate mergeGroupIds: ${duplicateMergeGroupIds.length}`);
if (duplicateAttachedSeeds.length) blockers.push(`duplicate attached radar seeds: ${duplicateAttachedSeeds.length}`);
if (missingRadarSeeds.length) blockers.push(`missing radar seed accounting: ${missingRadarSeeds.length}`);
if (radarSeedsBothAttachedAndRadarOnly.length) blockers.push(`radar seeds both attached and radar-only queued: ${radarSeedsBothAttachedAndRadarOnly.length}`);

const warnings = [];
if (ambiguityQueue.length) warnings.push(`radar attachment ambiguity rows: ${ambiguityQueue.length}`);

const attachmentMethods = attachmentDecisions.reduce((acc, x) => {
  acc[x.method] = (acc[x.method] || 0) + 1;
  return acc;
}, {});

const summary = {
  sourceCandidatesGrouped,
  mergeGroups: groups.length,
  multiSourceGroups,
  radarSeeds: seeds.length,
  radarSeedAttachments: totalAttachments,
  uniqueRadarSeedsAttached: attachedIds.size,
  groupsWithRadarSeedRefs,
  radarOnlyReviewQueueRows: radarOnlyQueue.length,
  radarAttachmentAmbiguityQueueRows: ambiguityQueue.length,
  uniqueRadarSeedsInAttachmentAmbiguityQueue: ambiguityIds.size,
  attachmentMethods,
  readyForMergeGroupsV2Preview: blockers.length === 0,
  blockers: blockers.length,
  warnings: warnings.length,
  safety: {
    noPayloadWrite: true,
    noPostgresqlWrite: true,
    noProductionCodeChange: true,
    dryRunOnly: true,
  },
  outputs: {
    outJsonl,
    outJson,
    decisionsCsv,
    radarOnlyCsv,
    ambiguityCsv,
    qaJsonPath,
    qaMdPath,
  },
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

const qa = {
  readyForMergeGroupsV2Preview: blockers.length === 0,
  blockers,
  warnings,
  checks: {
    mergeGroups: groups.length,
    sourceCandidatesGrouped,
    multiSourceGroups,
    radarSeedsInput: seeds.length,
    radarSeedAttachments: totalAttachments,
    uniqueRadarSeedsAttached: attachedIds.size,
    groupsWithRadarSeedRefs,
    radarOnlyQueueRows: radarOnlyQueue.length,
    radarAttachmentAmbiguityQueueRows: ambiguityQueue.length,
    uniqueRadarSeedsInAttachmentAmbiguityQueue: ambiguityIds.size,
    duplicateMergeGroupIds: duplicateMergeGroupIds.length,
    duplicateAttachedSeedIds: duplicateAttachedSeeds.length,
    missingRadarSeeds: missingRadarSeeds.length,
    radarSeedsBothAttachedAndRadarOnly: radarSeedsBothAttachedAndRadarOnly.length,
  },
  duplicateAttachedSeeds,
  missingRadarSeeds,
  radarSeedsBothAttachedAndRadarOnly,
  safety: summary.safety,
};

fs.writeFileSync(qaJsonPath, JSON.stringify(qa, null, 2));

const preview = [
  '# Merge Groups v2 Dry-run v0.2 Preview',
  '',
  '## Summary',
  '',
  `- mergeGroups: ${groups.length}`,
  `- sourceCandidatesGrouped: ${sourceCandidatesGrouped}`,
  `- multiSourceGroups: ${multiSourceGroups}`,
  `- radarSeeds: ${seeds.length}`,
  `- radarSeedAttachments: ${totalAttachments}`,
  `- uniqueRadarSeedsAttached: ${attachedIds.size}`,
  `- radarOnlyReviewQueueRows: ${radarOnlyQueue.length}`,
  `- radarAttachmentAmbiguityQueueRows: ${ambiguityQueue.length}`,
  `- uniqueRadarSeedsInAttachmentAmbiguityQueue: ${ambiguityIds.size}`,
  '',
  '## Attachment methods',
  '',
  ...Object.entries(summary.attachmentMethods).map(([k, v]) => `- ${k}: ${v}`),
  '',
  '## Ambiguity queue sample',
  '',
  ...(ambiguityQueue.length
    ? ambiguityQueue.slice(0, 20).map(x => `- ${x.seedId}: selected=${x.selectedMergeGroupId || 'none'} conflict=${x.conflictMergeGroupId} key=${x.conflictByKey || ''} reason=${x.reason}`)
    : ['- none']),
  '',
  '## Safety',
  '',
  '- No Payload write.',
  '- No PostgreSQL write.',
  '- No production code change.',
].join('\n');

fs.writeFileSync(previewPath, preview);

const qaMd = [
  '# Merge Groups v2 Dry-run v0.2 QA',
  '',
  `readyForMergeGroupsV2Preview: ${qa.readyForMergeGroupsV2Preview}`,
  '',
  '## Checks',
  '',
  ...Object.entries(qa.checks).map(([k, v]) => `- ${k}: ${v}`),
  '',
  '## Blockers',
  '',
  ...(blockers.length ? blockers.map(x => `- ${x}`) : ['- none']),
  '',
  '## Warnings',
  '',
  ...(warnings.length ? warnings.map(x => `- ${x}`) : ['- none']),
  '',
  '## Safety',
  '',
  '- No Payload write.',
  '- No PostgreSQL write.',
  '- No production code change.',
].join('\n');

fs.writeFileSync(qaMdPath, qaMd);

console.log(JSON.stringify({ ok: true, summary, qa }, null, 2));
