import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

function normalizeMergeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function uniqueMergeNames(values) {
  const seen = new Set()
  const result = []
  for (const raw of values) {
    const value = String(raw || '').trim()
    const key = normalizeMergeTitle(value)
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
let normalizedTitleLinks = 0
let shortTitleLinks = 0
const identityOwner = new Map()
const titleOwner = new Map()

records.forEach((record, index) => {
  if (record.identity.state === 'exact' && record.identity.provider && record.identity.siteId) {
    const key = `${String(record.identity.provider).toLowerCase()}|${record.identity.siteId}`
    const owner = identityOwner.get(key)
    if (owner === undefined) identityOwner.set(key, index)
    else if (union(owner, index)) exactIdentityLinks += 1
  }

  const names = uniqueMergeNames([
    record.title,
    ...record.aliases,
    ...record.localizedTitles.map((title) => title.title),
  ])
  const bucket = mediaMergeBucket(record.media.group)
  for (const name of names) {
    const normalized = normalizeMergeTitle(name)
    if (normalized.length < 2) continue
    const key = `${bucket}|${normalized}`
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
const suspicious = []

for (const indices of components.values()) {
  if (indices.length <= 1) continue
  multiWorkGroups += 1
  largestGroup = Math.max(largestGroup, indices.length)

  const providerIds = new Map()
  const knownMedia = new Set()
  const grades = new Set()
  let sameProviderConflict = false

  for (const index of indices) {
    const record = records[index]
    if (record.media.group !== 'unknown' && record.media.group !== 'other') knownMedia.add(mediaMergeBucket(record.media.group))
    if (record.rating.state === 'rated' && record.rating.grade) grades.add(record.rating.grade)
    if (record.identity.state !== 'exact' || !record.identity.provider || !record.identity.siteId) continue
    const provider = String(record.identity.provider).toLowerCase()
    const ids = providerIds.get(provider) || new Set()
    ids.add(String(record.identity.siteId))
    providerIds.set(provider, ids)
    if (ids.size > 1) sameProviderConflict = true
  }

  if (sameProviderConflict) sameProviderExactIdConflictGroups += 1
  if (knownMedia.size > 1) mixedKnownMediaGroups += 1
  if (grades.size > 1) mixedRatedGradeGroups += 1

  if (sameProviderConflict || knownMedia.size > 1 || indices.length >= 8) {
    suspicious.push({
      size: indices.length,
      sameProviderConflict,
      media: [...knownMedia],
      grades: [...grades],
      members: indices.slice(0, 12).map((index) => {
        const record = records[index]
        return {
          workId: record.workId,
          title: record.title,
          media: record.media.group,
          provider: record.identity.provider || null,
          siteId: record.identity.siteId || null,
          grade: record.rating.grade || null,
        }
      }),
    })
  }
}

suspicious.sort((left, right) =>
  Number(right.sameProviderConflict) - Number(left.sameProviderConflict) || right.size - left.size,
)

const result = {
  sourceWorks: records.length,
  visibleWorks: components.size,
  mergedAway: records.length - components.size,
  multiWorkGroups,
  largestGroup,
  exactIdentityLinks,
  normalizedTitleLinks,
  shortTitleLinks,
  sameProviderExactIdConflictGroups,
  mixedKnownMediaGroups,
  mixedRatedGradeGroups,
  suspiciousGroups: suspicious.slice(0, 20),
}

// Keep the first audit observational. These two invariants only catch implementation drift,
// while the reported conflict counters tell us whether the deliberately broad title merge
// needs a narrower second pass on the real 35k catalog.
assert.ok(result.visibleWorks > 0 && result.visibleWorks <= result.sourceWorks, 'invalid visible work count')
assert.equal(result.mergedAway, result.sourceWorks - result.visibleWorks, 'merge accounting drift')

console.log(JSON.stringify(result, null, 2))

if (process.env.GITHUB_ACTIONS === 'true') {
  const summary = [
    `source=${result.sourceWorks}`,
    `visible=${result.visibleWorks}`,
    `mergedAway=${result.mergedAway}`,
    `groups=${result.multiWorkGroups}`,
    `largest=${result.largestGroup}`,
    `exactLinks=${result.exactIdentityLinks}`,
    `titleLinks=${result.normalizedTitleLinks}`,
    `shortTitleLinks=${result.shortTitleLinks}`,
    `sameProviderExactConflicts=${result.sameProviderExactIdConflictGroups}`,
    `mixedMedia=${result.mixedKnownMediaGroups}`,
    `mixedRatedGrades=${result.mixedRatedGradeGroups}`,
  ].join(', ')
  console.log(`::notice title=Public catalog merge audit::${summary}`)
  if (result.sameProviderExactIdConflictGroups > 0 || result.mixedKnownMediaGroups > 0) {
    console.log(
      `::warning title=Suspicious public catalog merge groups::same-provider exact-ID conflicts=${result.sameProviderExactIdConflictGroups}, mixed-known-media groups=${result.mixedKnownMediaGroups}`,
    )
  }
}
