import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(
  process.env.BAIHEPAILEI_RELEASE_DIR || join(repoRoot, 'data', 'public-release', 'v1'),
)

const manifest = JSON.parse(readFileSync(join(releaseDir, 'manifest.json'), 'utf8'))
const baseRecords = manifest.shards.flatMap((shard) =>
  readFileSync(join(releaseDir, shard.file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line)),
)
const mediaDocument = JSON.parse(readFileSync(join(releaseDir, 'enrichment-media.json'), 'utf8'))
const workAssets = readFileSync(join(releaseDir, 'enrichment-work-assets.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))

const assetsByWorkId = new Map(workAssets.map((asset) => [String(asset.workId), asset]))
const mediaByWorkId = new Map()
for (const group of mediaDocument.groups) {
  for (const workId of group.workIds) {
    mediaByWorkId.set(String(workId), {
      group: normalizeMediaGroup(
        group.mediaGroup === 'game' && group.mediaType === 'visual_novel'
          ? 'visual_novel'
          : group.mediaGroup,
      ),
      type: group.mediaType,
    })
  }
}

function normalizeMediaGroup(value) {
  if (['anime', 'manga', 'novel', 'game', 'other', 'visual_novel'].includes(value)) return value
  return 'unknown'
}

function mediaMergeBucket(group) {
  if (group === 'game' || group === 'visual_novel') return 'game'
  if (group === 'other' || group === 'unknown') return 'unknown'
  return group
}

function normalizeBroadTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function normalizeIdentitySafeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, '')
}

function uniqueMergeNames(values, normalizeTitle) {
  const seen = new Set()
  const result = []
  for (const raw of values) {
    const value = String(raw || '').trim()
    const key = normalizeTitle(value)
    if (!value || !key || seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

const records = baseRecords.map((base) => {
  const asset = assetsByWorkId.get(String(base.workId)) || {}
  const media = mediaByWorkId.get(String(base.workId)) || { group: 'unknown', type: 'unknown' }
  return {
    workId: String(base.workId),
    title: String(base.title || ''),
    aliases: asset.aliases || [],
    localizedTitles: asset.localizedTitles || [],
    media,
    identity: base.identity || {},
    rating: base.rating || {},
  }
})

assert.equal(records.length, manifest.counts.catalogWorks, 'merge audit must cover the complete public catalog')

function namesFor(record, normalizeTitle) {
  return uniqueMergeNames([
    record.title,
    ...record.aliases,
    ...record.localizedTitles.map((title) => title.title),
  ], normalizeTitle)
}

function titleKey(record, name, normalizeTitle) {
  return `${mediaMergeBucket(record.media.group)}|${normalizeTitle(name)}`
}

function ambiguousExactProviderTitleKeys(normalizeTitle) {
  const claims = new Map()
  for (const record of records) {
    if (record.identity.state !== 'exact' || !record.identity.provider || !record.identity.siteId) continue
    const provider = String(record.identity.provider).toLowerCase()
    for (const name of namesFor(record, normalizeTitle)) {
      const normalized = normalizeTitle(name)
      if (normalized.length < 2) continue
      const key = titleKey(record, name, normalizeTitle)
      const providerClaims = claims.get(key) || new Map()
      const ids = providerClaims.get(provider) || new Set()
      ids.add(String(record.identity.siteId))
      providerClaims.set(provider, ids)
      claims.set(key, providerClaims)
    }
  }

  const ambiguous = new Set()
  for (const [key, providerClaims] of claims) {
    if ([...providerClaims.values()].some((ids) => ids.size > 1)) ambiguous.add(key)
  }
  return ambiguous
}

function runMerge({ normalizeTitle, rejectAmbiguousTitleKeys }) {
  const parent = records.map((_, index) => index)
  const find = (index) => {
    let cursor = index
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]]
      cursor = parent[cursor]
    }
    return cursor
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return false
    parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot)
    return true
  }

  let exactIdentityLinks = 0
  const identityOwner = new Map()
  records.forEach((record, index) => {
    if (record.identity.state !== 'exact' || !record.identity.provider || !record.identity.siteId) return
    const key = `${String(record.identity.provider).toLowerCase()}|${record.identity.siteId}`
    const owner = identityOwner.get(key)
    if (owner === undefined) identityOwner.set(key, index)
    else if (union(owner, index)) exactIdentityLinks += 1
  })

  const ambiguousKeys = rejectAmbiguousTitleKeys
    ? ambiguousExactProviderTitleKeys(normalizeTitle)
    : new Set()
  let normalizedTitleLinks = 0
  let shortTitleLinks = 0
  let ambiguousTitleMatchesSkipped = 0
  const skippedAmbiguousKeys = new Set()
  const titleOwner = new Map()

  records.forEach((record, index) => {
    for (const name of namesFor(record, normalizeTitle)) {
      const normalized = normalizeTitle(name)
      if (normalized.length < 2) continue
      const key = titleKey(record, name, normalizeTitle)
      if (ambiguousKeys.has(key)) {
        skippedAmbiguousKeys.add(key)
        if (titleOwner.has(key)) ambiguousTitleMatchesSkipped += 1
        else titleOwner.set(key, index)
        continue
      }
      const owner = titleOwner.get(key)
      if (owner === undefined) {
        titleOwner.set(key, index)
        continue
      }
      if (union(owner, index)) {
        normalizedTitleLinks += 1
        if (normalized.length <= 3) shortTitleLinks += 1
      }
    }
  })

  const components = new Map()
  records.forEach((_, index) => {
    const root = find(index)
    const members = components.get(root) || []
    members.push(index)
    components.set(root, members)
  })

  let multiWorkGroups = 0
  let largestGroup = 1
  let sameProviderExactIdConflictGroups = 0
  let mixedKnownMediaGroups = 0
  let mixedRatedGradeGroups = 0
  let ratedWithBlockingTerminalGroups = 0
  const suspicious = []

  for (const indices of components.values()) {
    if (indices.length <= 1) continue
    multiWorkGroups += 1
    largestGroup = Math.max(largestGroup, indices.length)

    const providerIds = new Map()
    const knownMedia = new Set()
    const grades = new Set()
    const states = new Set()
    let sameProviderConflict = false

    for (const index of indices) {
      const record = records[index]
      if (record.media.group !== 'unknown' && record.media.group !== 'other') {
        knownMedia.add(mediaMergeBucket(record.media.group))
      }
      if (record.rating.state) states.add(record.rating.state)
      if (record.rating.state === 'rated' && record.rating.grade) grades.add(record.rating.grade)
      if (record.identity.state !== 'exact' || !record.identity.provider || !record.identity.siteId) continue
      const provider = String(record.identity.provider).toLowerCase()
      const ids = providerIds.get(provider) || new Set()
      ids.add(String(record.identity.siteId))
      providerIds.set(provider, ids)
      if (ids.size > 1) sameProviderConflict = true
    }

    const hasBlockingTerminal = ['conflict', 'blocked', 'research_required'].some((state) => states.has(state))
    if (sameProviderConflict) sameProviderExactIdConflictGroups += 1
    if (knownMedia.size > 1) mixedKnownMediaGroups += 1
    if (grades.size > 1) mixedRatedGradeGroups += 1
    if (states.has('rated') && hasBlockingTerminal) ratedWithBlockingTerminalGroups += 1

    if (
      sameProviderConflict ||
      knownMedia.size > 1 ||
      grades.size > 1 ||
      (states.has('rated') && hasBlockingTerminal) ||
      indices.length >= 8
    ) {
      suspicious.push({
        size: indices.length,
        sameProviderConflict,
        media: [...knownMedia],
        grades: [...grades],
        states: [...states],
        members: indices.slice(0, 12).map((index) => {
          const record = records[index]
          return {
            workId: record.workId,
            title: record.title,
            media: record.media.group,
            provider: record.identity.provider || null,
            siteId: record.identity.siteId || null,
            state: record.rating.state || null,
            grade: record.rating.grade || null,
          }
        }),
      })
    }
  }

  suspicious.sort((left, right) =>
    Number(right.sameProviderConflict) - Number(left.sameProviderConflict) || right.size - left.size,
  )

  return {
    sourceWorks: records.length,
    visibleWorks: components.size,
    mergedAway: records.length - components.size,
    multiWorkGroups,
    largestGroup,
    exactIdentityLinks,
    normalizedTitleLinks,
    shortTitleLinks,
    ambiguousTitleKeysSkipped: skippedAmbiguousKeys.size,
    ambiguousTitleMatchesSkipped,
    sameProviderExactIdConflictGroups,
    mixedKnownMediaGroups,
    mixedRatedGradeGroups,
    ratedWithBlockingTerminalGroups,
    suspiciousGroups: suspicious.slice(0, 20),
  }
}

const broad = runMerge({
  normalizeTitle: normalizeBroadTitle,
  rejectAmbiguousTitleKeys: false,
})
const identitySafe = runMerge({
  normalizeTitle: normalizeIdentitySafeTitle,
  rejectAmbiguousTitleKeys: true,
})

for (const result of [broad, identitySafe]) {
  assert.ok(result.visibleWorks > 0 && result.visibleWorks <= result.sourceWorks, 'invalid visible work count')
  assert.equal(result.mergedAway, result.sourceWorks - result.visibleWorks, 'merge accounting drift')
}
assert.equal(identitySafe.sameProviderExactIdConflictGroups, 0, 'identity-safe proposal still merges conflicting exact IDs')

const reportObject = {
  currentBroadPolicy: broad,
  proposedIdentitySafePolicy: identitySafe,
  delta: {
    recoveredWorks: identitySafe.visibleWorks - broad.visibleWorks,
    fewerMergedRows: broad.mergedAway - identitySafe.mergedAway,
    exactConflictGroupsRemoved:
      broad.sameProviderExactIdConflictGroups - identitySafe.sameProviderExactIdConflictGroups,
  },
}
const report = `${JSON.stringify(reportObject, null, 2)}\n`
console.log(report.trimEnd())

const reportPath = String(process.env.MERGE_AUDIT_REPORT || '').trim()
if (reportPath) writeFileSync(resolve(reportPath), report, 'utf8')

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `sourceWorks=${broad.sourceWorks}`,
      `visibleWorks=${broad.visibleWorks}`,
      `mergedAway=${broad.mergedAway}`,
      `multiWorkGroups=${broad.multiWorkGroups}`,
      `largestGroup=${broad.largestGroup}`,
      `sameProviderExactIdConflictGroups=${broad.sameProviderExactIdConflictGroups}`,
      `mixedKnownMediaGroups=${broad.mixedKnownMediaGroups}`,
      `safeVisibleWorks=${identitySafe.visibleWorks}`,
      `safeMergedAway=${identitySafe.mergedAway}`,
      `safeMultiWorkGroups=${identitySafe.multiWorkGroups}`,
      `safeLargestGroup=${identitySafe.largestGroup}`,
      `safeExactConflictGroups=${identitySafe.sameProviderExactIdConflictGroups}`,
      `safeAmbiguousTitleKeysSkipped=${identitySafe.ambiguousTitleKeysSkipped}`,
      `safeRatedWithBlockingTerminalGroups=${identitySafe.ratedWithBlockingTerminalGroups}`,
    ].join('\n') + '\n',
  )
}

if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(
    `::notice title=Current public catalog merge::source=${broad.sourceWorks}, visible=${broad.visibleWorks}, mergedAway=${broad.mergedAway}, groups=${broad.multiWorkGroups}, exactConflicts=${broad.sameProviderExactIdConflictGroups}`,
  )
  console.log(
    `::notice title=Identity-safe merge proposal::visible=${identitySafe.visibleWorks}, mergedAway=${identitySafe.mergedAway}, groups=${identitySafe.multiWorkGroups}, ambiguousKeysSkipped=${identitySafe.ambiguousTitleKeysSkipped}, exactConflicts=${identitySafe.sameProviderExactIdConflictGroups}, ratedWithBlockingTerminal=${identitySafe.ratedWithBlockingTerminalGroups}`,
  )
}
