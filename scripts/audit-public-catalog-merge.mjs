import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(
  process.env.BAIHEPAILEI_RELEASE_DIR || join(repoRoot, 'data', 'public-release', 'v2'),
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
const equivalenceDir = join(releaseDir, 'equivalence')
const equivalenceManifest = JSON.parse(readFileSync(join(equivalenceDir, 'manifest.json'), 'utf8'))
const equivalenceGroups = readFileSync(join(equivalenceDir, 'catalog-equivalence-groups.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
const titleEvidence = readFileSync(join(equivalenceDir, 'catalog-title-evidence.jsonl'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
const equivalenceExclusions = readFileSync(join(equivalenceDir, 'catalog-equivalence-exclusions.jsonl'), 'utf8')
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

function normalizeLegacyBroadTitle(value) {
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

function ambiguousProviderTitleKeys(normalizeTitle) {
  const claims = new Map()
  for (const record of records) {
    if (!record.identity.provider || !record.identity.siteId) continue
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

function runMerge({
  normalizeTitle,
  rejectAmbiguousTitleKeys,
  includeMergedGroups = false,
  explicitGroups = [],
  protectAllIdentityClaims = false,
}) {
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

  const identityClaimsByRoot = new Map()
  if (protectAllIdentityClaims) {
    records.forEach((record, index) => {
      if (!record.identity.provider || !record.identity.siteId) return
      const root = find(index)
      const claims = identityClaimsByRoot.get(root) || new Map()
      claims.set(String(record.identity.provider).toLowerCase(), String(record.identity.siteId))
      identityClaimsByRoot.set(root, claims)
    })
  }
  const unionSafe = (left, right) => {
    if (!protectAllIdentityClaims) return union(left, right)
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot === rightRoot) return false
    const leftClaims = identityClaimsByRoot.get(leftRoot) || new Map()
    const rightClaims = identityClaimsByRoot.get(rightRoot) || new Map()
    for (const [provider, siteId] of leftClaims) {
      const otherSiteId = rightClaims.get(provider)
      if (otherSiteId && otherSiteId !== siteId) return false
    }
    const changed = union(leftRoot, rightRoot)
    const root = find(leftRoot)
    const mergedClaims = new Map(leftClaims)
    for (const [provider, siteId] of rightClaims) mergedClaims.set(provider, siteId)
    identityClaimsByRoot.delete(leftRoot)
    identityClaimsByRoot.delete(rightRoot)
    identityClaimsByRoot.set(root, mergedClaims)
    return changed
  }

  const indexByWorkId = new Map(records.map((record, index) => [record.workId, index]))
  const resolvedMediaByWorkId = new Map()
  let explicitEquivalenceLinks = 0
  for (const group of explicitGroups) {
    assert.equal(group.decision, 'merge', `${group.groupId} must be an explicit merge`)
    const indices = group.workIds.map((workId) => {
      const index = indexByWorkId.get(String(workId))
      assert.notEqual(index, undefined, `${group.groupId} references missing Work ${workId}`)
      return index
    })
    assert.ok(indices.length >= 2 && new Set(indices).size === indices.length, `${group.groupId} has invalid members`)
    for (const index of indices.slice(1)) {
      const alreadyTogether = find(indices[0]) === find(index)
      const changed = unionSafe(indices[0], index)
      assert.ok(alreadyTogether || changed, `${group.groupId} conflicts with a provider identity`)
      if (changed) explicitEquivalenceLinks += 1
    }
    if (group.resolvedMedia) {
      for (const workId of group.workIds) resolvedMediaByWorkId.set(String(workId), group.resolvedMedia)
    }
  }

  const ambiguousKeys = rejectAmbiguousTitleKeys
    ? ambiguousProviderTitleKeys(normalizeTitle)
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
      if (unionSafe(owner, index)) {
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
  const mergedGroups = []

  for (const indices of components.values()) {
    if (indices.length <= 1) continue
    multiWorkGroups += 1
    largestGroup = Math.max(largestGroup, indices.length)

    const providerIds = new Map()
    const knownMedia = new Set()
    const grades = new Set()
    const states = new Set()
    let sameProviderConflict = false
    const resolvedMediaValues = [...new Map(
      indices
        .map((index) => resolvedMediaByWorkId.get(records[index].workId))
        .filter(Boolean)
        .map((value) => [`${value.group}|${value.type}`, value]),
    ).values()]
    assert.ok(resolvedMediaValues.length <= 1, 'component has conflicting resolved media')
    const componentResolvedMedia = resolvedMediaValues[0]

    const members = indices.map((index) => {
      const record = records[index]
      const effectiveMedia = componentResolvedMedia || record.media
      if (effectiveMedia.group !== 'unknown' && effectiveMedia.group !== 'other') {
        knownMedia.add(mediaMergeBucket(effectiveMedia.group))
      }
      if (record.rating.state) states.add(record.rating.state)
      if (record.rating.state === 'rated' && record.rating.grade) grades.add(record.rating.grade)
      if (record.identity.provider && record.identity.siteId) {
        const provider = String(record.identity.provider).toLowerCase()
        const ids = providerIds.get(provider) || new Set()
        ids.add(String(record.identity.siteId))
        providerIds.set(provider, ids)
        if (ids.size > 1) sameProviderConflict = true
      }
      return {
        workId: record.workId,
        title: record.title,
        aliases: record.aliases,
        localizedTitles: record.localizedTitles.map((title) => title.title),
        media: record.media.group,
        mediaType: record.media.type,
        resolvedMedia: componentResolvedMedia || null,
        identityState: record.identity.state || null,
        provider: record.identity.provider || null,
        siteId: record.identity.siteId || null,
        ratingState: record.rating.state || null,
        grade: record.rating.grade || null,
      }
    })

    const hasBlockingTerminal = ['conflict', 'blocked', 'research_required'].some((state) => states.has(state))
    if (sameProviderConflict) sameProviderExactIdConflictGroups += 1
    if (knownMedia.size > 1) mixedKnownMediaGroups += 1
    if (grades.size > 1) mixedRatedGradeGroups += 1
    if (states.has('rated') && hasBlockingTerminal) ratedWithBlockingTerminalGroups += 1

    const group = {
      size: indices.length,
      sameProviderConflict,
      media: [...knownMedia],
      grades: [...grades],
      states: [...states],
      members,
    }
    if (includeMergedGroups) mergedGroups.push(group)

    if (
      sameProviderConflict ||
      knownMedia.size > 1 ||
      grades.size > 1 ||
      (states.has('rated') && hasBlockingTerminal) ||
      indices.length >= 8
    ) {
      suspicious.push(group)
    }
  }

  suspicious.sort((left, right) =>
    Number(right.sameProviderConflict) - Number(left.sameProviderConflict) || right.size - left.size,
  )
  mergedGroups.sort((left, right) =>
    String(left.members[0]?.title || '').localeCompare(String(right.members[0]?.title || '')),
  )

  return {
    sourceWorks: records.length,
    visibleWorks: components.size,
    mergedAway: records.length - components.size,
    multiWorkGroups,
    largestGroup,
    exactIdentityLinks,
    explicitEquivalenceLinks,
    normalizedTitleLinks,
    shortTitleLinks,
    ambiguousTitleKeysSkipped: skippedAmbiguousKeys.size,
    ambiguousTitleMatchesSkipped,
    sameProviderExactIdConflictGroups,
    mixedKnownMediaGroups,
    mixedRatedGradeGroups,
    ratedWithBlockingTerminalGroups,
    suspiciousGroups: suspicious.slice(0, 20),
    ...(includeMergedGroups ? { mergedGroups } : {}),
  }
}

const legacyBroad = runMerge({
  normalizeTitle: normalizeLegacyBroadTitle,
  rejectAmbiguousTitleKeys: false,
})
const hardenedTitleBaseline = runMerge({
  normalizeTitle: normalizeIdentitySafeTitle,
  rejectAmbiguousTitleKeys: true,
  protectAllIdentityClaims: true,
})
const currentIdentitySafe = runMerge({
  normalizeTitle: normalizeIdentitySafeTitle,
  rejectAmbiguousTitleKeys: true,
  includeMergedGroups: true,
  explicitGroups: equivalenceGroups,
  protectAllIdentityClaims: true,
})

for (const result of [legacyBroad, hardenedTitleBaseline, currentIdentitySafe]) {
  assert.ok(result.visibleWorks > 0 && result.visibleWorks <= result.sourceWorks, 'invalid visible work count')
  assert.equal(result.mergedAway, result.sourceWorks - result.visibleWorks, 'merge accounting drift')
}
assert.equal(currentIdentitySafe.sameProviderExactIdConflictGroups, 0, 'current merge policy merges conflicting exact IDs')
assert.equal(currentIdentitySafe.mixedKnownMediaGroups, 0, 'current merge policy crosses known media buckets')
assert.equal(currentIdentitySafe.ratedWithBlockingTerminalGroups, 0, 'current merge policy hides a blocking terminal state behind a rating')

// These are pinned to the current public-release v1 bytes. If the release data changes,
// the audit report should be reviewed and these expectations intentionally advanced.
assert.equal(currentIdentitySafe.sourceWorks, 35_411, 'unexpected public source-work count')
assert.equal(hardenedTitleBaseline.visibleWorks, 35_346, 'unexpected hardened baseline visible-work count')
assert.equal(hardenedTitleBaseline.mergedAway, 65, 'unexpected hardened baseline merged-row count')
assert.equal(hardenedTitleBaseline.multiWorkGroups, 65, 'unexpected hardened baseline merge-group count')
assert.equal(currentIdentitySafe.visibleWorks, 34_940, 'unexpected identity-safe visible-work count')
assert.equal(currentIdentitySafe.mergedAway, 471, 'unexpected identity-safe merged-row count')
assert.equal(currentIdentitySafe.multiWorkGroups, 471, 'unexpected identity-safe merged-group count')
assert.equal(currentIdentitySafe.largestGroup, 2, 'unexpected identity-safe largest merge group')
assert.equal(currentIdentitySafe.mergedGroups.length, 471, 'merge-group review list must be complete')
assert.equal(currentIdentitySafe.ambiguousTitleKeysSkipped, 199, 'unexpected ambiguous title-key count')
assert.equal(equivalenceGroups.length, 427, 'explicit equivalence-group count drift')
assert.equal(titleEvidence.length, 5_619, 'title-evidence row count drift')
assert.equal(
  titleEvidence.reduce((sum, row) => sum + row.titles.length, 0),
  19_307,
  'title-evidence value count drift',
)
assert.equal(equivalenceExclusions.length, 31, 'equivalence-exclusion count drift')
assert.deepEqual(equivalenceManifest.counts.afterEquivalence, {
  sourceWorks: 35_411,
  visibleWorks: 34_940,
  mergedAway: 471,
  multiWorkGroups: 471,
  largestGroup: 2,
  ambiguousTitleKeys: 199,
})

const groupByWorkId = new Map()
for (const group of currentIdentitySafe.mergedGroups) {
  const ids = group.members.map((member) => member.workId)
  for (const workId of ids) groupByWorkId.set(workId, new Set(ids))
}
const sameGroup = (left, right) => groupByWorkId.get(String(left))?.has(String(right)) === true
for (const [left, right] of [
  ['25236', '31618'], // Sky Girls 2007 TV
  ['25237', '31619'], // Sky Girls 2006 OVA
  ['17930', '31034'], // Lycoris Recoil: Friends are thieves of time.
]) {
  assert.ok(sameGroup(left, right), `validated aliases ${left}/${right} must merge`)
}
for (const [left, right] of [
  ['25237', '31618'], // stale TV-to-OVA crosswalk
  ['17926', '31034'], // stale Lycoris placeholder crosswalk
  ['4142', '4978'], // same-provider partial IDs, generic title 雨眠
  ['4918', '4979'], // same-provider partial IDs, generic title 少女
]) {
  assert.equal(sameGroup(left, right), false, `excluded pair ${left}/${right} must remain separate`)
}

const reportObject = {
  currentIdentitySafePolicy: currentIdentitySafe,
  hardenedTitleBaseline,
  legacyBroadPolicy: legacyBroad,
  improvementOverLegacy: {
    recoveredWorks: hardenedTitleBaseline.visibleWorks - legacyBroad.visibleWorks,
    fewerMergedRows: legacyBroad.mergedAway - hardenedTitleBaseline.mergedAway,
    exactConflictGroupsRemoved:
      legacyBroad.sameProviderExactIdConflictGroups - hardenedTitleBaseline.sameProviderExactIdConflictGroups,
  },
  equivalenceReleaseImpact: {
    additionalMergedRows: currentIdentitySafe.mergedAway - hardenedTitleBaseline.mergedAway,
    titleOnlyFalseMergesRemoved: 2,
    explicitEquivalenceGroups: equivalenceGroups.length,
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
      `sourceWorks=${currentIdentitySafe.sourceWorks}`,
      `visibleWorks=${currentIdentitySafe.visibleWorks}`,
      `mergedAway=${currentIdentitySafe.mergedAway}`,
      `multiWorkGroups=${currentIdentitySafe.multiWorkGroups}`,
      `largestGroup=${currentIdentitySafe.largestGroup}`,
      `ambiguousTitleKeysSkipped=${currentIdentitySafe.ambiguousTitleKeysSkipped}`,
      `sameProviderExactIdConflictGroups=${currentIdentitySafe.sameProviderExactIdConflictGroups}`,
      `mixedKnownMediaGroups=${currentIdentitySafe.mixedKnownMediaGroups}`,
      `ratedWithBlockingTerminalGroups=${currentIdentitySafe.ratedWithBlockingTerminalGroups}`,
      `legacyVisibleWorks=${legacyBroad.visibleWorks}`,
      `legacyMergedAway=${legacyBroad.mergedAway}`,
      `legacyExactConflictGroups=${legacyBroad.sameProviderExactIdConflictGroups}`,
    ].join('\n') + '\n',
  )
}

if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(
    `::notice title=Identity-safe public catalog merge::source=${currentIdentitySafe.sourceWorks}, visible=${currentIdentitySafe.visibleWorks}, mergedAway=${currentIdentitySafe.mergedAway}, groups=${currentIdentitySafe.multiWorkGroups}, ambiguousKeysSkipped=${currentIdentitySafe.ambiguousTitleKeysSkipped}, exactConflicts=${currentIdentitySafe.sameProviderExactIdConflictGroups}, blocking=${currentIdentitySafe.ratedWithBlockingTerminalGroups}`,
  )
  console.log(
    `::notice title=Legacy broad merge comparison::visible=${legacyBroad.visibleWorks}, mergedAway=${legacyBroad.mergedAway}, exactConflicts=${legacyBroad.sameProviderExactIdConflictGroups}`,
  )
}
