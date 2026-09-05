import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = resolve(
  process.env.BAIHEPAILEI_RELEASE_DIR || join(repoRoot, 'data', 'public-release', 'v1'),
)
const manifestPath = join(releaseDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function countBy(values, key) {
  const result = {}
  for (const value of values) {
    const item = key(value)
    result[item] = (result[item] || 0) + 1
  }
  return result
}

function equalCounts(actual, expected, label) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const key of keys) {
    invariant(
      Number(actual[key] || 0) === Number(expected[key] || 0),
      `${label} drift for ${key}: ${actual[key] || 0} != ${expected[key] || 0}`,
    )
  }
}

const records = []
for (const shard of manifest.shards) {
  const path = join(releaseDir, shard.file)
  const bytes = readFileSync(path)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  invariant(sha256 === shard.sha256, `${shard.file} SHA-256 drift`)
  invariant(statSync(path).size === shard.bytes, `${shard.file} byte-count drift`)
  const rows = bytes
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
  invariant(rows.length === shard.rows, `${shard.file} row-count drift`)
  records.push(...rows)
}

invariant(records.length === manifest.counts.catalogWorks, 'catalog total drift')
const byWorkId = new Map(records.map((record) => [record.workId, record]))
invariant(byWorkId.size === records.length, 'duplicate public Work ID')
invariant(!byWorkId.has('39355'), 'feedback smoke-test record leaked')
invariant(records.every((record) => record.schemaVersion === 'baihepailei-public-work-v1'), 'record schema drift')

const ratingStatusCounts = countBy(records, (record) => record.rating.state)
equalCounts(ratingStatusCounts, manifest.ratingStatusCounts, 'rating status')
const rated = records.filter((record) => record.rating.state === 'rated')
const audited = records.filter((record) => record.audited)
const terminal = audited.filter((record) => record.rating.state !== 'rated')
const grades = countBy(rated, (record) => record.rating.grade)

invariant(rated.length === manifest.counts.ratedWorks, 'rated total drift')
invariant(audited.length === manifest.counts.auditedWorks, 'decision-scope total drift')
invariant(terminal.length === manifest.counts.nonratingTerminalWorks, 'terminal total drift')
invariant(
  audited.every((record) => record.rating.state !== 'not_assessed'),
  'decision-scope record left not_assessed',
)
invariant(
  records.filter((record) => !record.audited).every((record) => record.rating.state === 'not_assessed'),
  'out-of-scope record received an untracked terminal state',
)
equalCounts(grades, manifest.gradeCounts, 'grade')

const dUnclear = rated.filter((record) => record.rating.class === 'D-UNCLEAR')
invariant(dUnclear.length === manifest.counts.dUnclearRatings, 'D-UNCLEAR count drift')
invariant(
  dUnclear.every((record) =>
    record.rating.grade === 'D' &&
    record.rating.confidence === 'low' &&
    record.rating.needsMoreResearch === true
  ),
  'D-UNCLEAR publication semantics drift',
)

const expectedCalibration = {
  '18556': ['D', 'D-OTOKONOKO-CROSSDRESSING'],
  '26328': ['E', 'E-STRAIGHT-UNREQUITED'],
  '26923': ['F', 'F-MALE-ROMANTIC-AXIS'],
  '4975': ['E', 'E-MALE-SUBSTITUTE'],
}
for (const [workId, [grade, ratingClass]] of Object.entries(expectedCalibration)) {
  const record = byWorkId.get(workId)
  invariant(record?.rating.grade === grade, `owner calibration grade drift for Work ${workId}`)
  invariant(record?.rating.class === ratingClass, `owner calibration class drift for Work ${workId}`)
}

const enrichmentManifest = JSON.parse(
  readFileSync(join(releaseDir, 'enrichment-manifest.json'), 'utf8'),
)
invariant(
  enrichmentManifest.schemaVersion === 'baihepailei-public-enrichment-manifest-v1',
  'enrichment manifest schema drift',
)
invariant(enrichmentManifest.inheritedRatingsAllowed === false, 'legacy rating inheritance enabled')

function readTrackedEnrichment(source, expectedFile) {
  invariant(source.file === expectedFile, `${expectedFile} manifest path drift`)
  const path = join(releaseDir, source.file)
  const bytes = readFileSync(path)
  invariant(statSync(path).size === source.bytes, `${source.file} byte-count drift`)
  invariant(
    createHash('sha256').update(bytes).digest('hex') === source.sha256,
    `${source.file} SHA-256 drift`,
  )
  return bytes.toString('utf8')
}

const mediaDocument = JSON.parse(
  readTrackedEnrichment(enrichmentManifest.sources.media, 'enrichment-media.json'),
)
invariant(
  mediaDocument.schemaVersion === 'baihepailei-public-media-enrichment-v1',
  'media enrichment schema drift',
)
const mediaWorkIds = mediaDocument.groups.flatMap((group) => group.workIds.map(String))
invariant(mediaWorkIds.length === enrichmentManifest.sources.media.rows, 'media row-count drift')
invariant(new Set(mediaWorkIds).size === mediaWorkIds.length, 'duplicate media Work ID')
invariant(
  mediaWorkIds.every((workId) => byWorkId.has(workId)),
  'media enrichment contains a non-public Work ID',
)
invariant(
  mediaWorkIds.length === records.length,
  'public work missing exact media enrichment',
)

const workAssets = readTrackedEnrichment(
  enrichmentManifest.sources.workAssets,
  'enrichment-work-assets.jsonl',
)
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
invariant(workAssets.length === enrichmentManifest.sources.workAssets.rows, 'work asset row-count drift')
invariant(
  new Set(workAssets.map((asset) => asset.workId)).size === workAssets.length,
  'duplicate work asset Work ID',
)
invariant(
  workAssets.every((asset) =>
    asset.schemaVersion === 'baihepailei-public-work-asset-v1' &&
    byWorkId.has(asset.workId)
  ),
  'invalid or non-public work asset',
)
invariant(
  workAssets.filter((asset) => asset.summary?.text).length ===
    enrichmentManifest.sources.workAssets.summaries,
  'work summary count drift',
)
invariant(
  workAssets.filter((asset) => asset.creators?.length).length ===
    enrichmentManifest.sources.workAssets.creatorCreditWorks,
  'creator credit count drift',
)
invariant(
  workAssets.filter((asset) => asset.organizations?.length).length ===
    enrichmentManifest.sources.workAssets.organizationCreditWorks,
  'organization credit count drift',
)
invariant(
  workAssets.every((asset) =>
    (asset.sources || []).every((source) => /^https?:\/\//i.test(source.url))
  ),
  'work asset contains a non-web public source',
)
const publicTagKeys = new Set([
  'setting-ts',
  'setting-futa',
  'setting-abo',
  'setting-otokonoko-crossdressing',
  'setting-queer-general',
  'content-adult',
])
invariant(
  workAssets.every((asset) =>
    (asset.localizedTitles || []).every((title) =>
      typeof title?.title === 'string' && title.title.trim().length > 0
    ) &&
    (asset.publicTags || []).every((tag) => publicTagKeys.has(tag)) &&
    (!asset.cover || /^https?:\/\//i.test(asset.cover.url))
  ),
  'work asset contains invalid public display metadata',
)

const ratingDetails = readTrackedEnrichment(
  enrichmentManifest.sources.ratingDetails,
  'enrichment-rating-details.jsonl',
)
  .split(/\r?\n/)
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
invariant(
  ratingDetails.length === enrichmentManifest.sources.ratingDetails.uniqueRows,
  'rating detail row-count drift',
)
invariant(
  new Set(ratingDetails.map((detail) => detail.workId)).size === ratingDetails.length,
  'duplicate rating detail Work ID',
)
const retiredOrUnknownClasses = new Set([
  'A-STABLE',
  'D-UNCLEAR',
  'D-MULTI-ENDING',
  'E-ACTIVE-MALE-ROMANCE',
  'E-MALE-MARRIAGE',
  'E-MALE-RELATIONSHIP',
  'E-MALE-ENGAGEMENT',
  'E-MIXED-LGBT-NON-YURI',
])
invariant(
  ratingDetails.every((detail) => {
    const current = byWorkId.get(detail.workId)
    return detail.schemaVersion === 'baihepailei-public-rating-detail-v1' &&
      current?.rating.state === 'rated' &&
      current.rating.grade === detail.grade &&
      (detail.classes || []).every((ratingClass) =>
        ratingClass.startsWith(`${detail.grade}-`) &&
        !retiredOrUnknownClasses.has(ratingClass)
      )
  }),
  'rating detail escaped exact Work/grade/current-class boundary',
)

const equivalenceDir = join(releaseDir, 'equivalence')
const equivalenceManifest = JSON.parse(readFileSync(join(equivalenceDir, 'manifest.json'), 'utf8'))
invariant(
  equivalenceManifest.schemaVersion === 'baihepailei-public-catalog-equivalence-manifest-v1',
  'catalog equivalence manifest schema drift',
)
invariant(
  equivalenceManifest.sourceCatalog.rows === records.length,
  'catalog equivalence source-row binding drift',
)

function readEquivalenceRows(file) {
  const tracked = equivalenceManifest.files[file]
  invariant(tracked, `${file} is missing from the catalog equivalence manifest`)
  const path = join(equivalenceDir, file)
  const bytes = readFileSync(path)
  invariant(bytes.length === tracked.bytes, `${file} byte-count drift`)
  invariant(
    createHash('sha256').update(bytes).digest('hex') === tracked.sha256,
    `${file} SHA-256 drift`,
  )
  const rows = bytes.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
  invariant(rows.length === tracked.rows, `${file} row-count drift`)
  return rows
}

const equivalenceGroups = readEquivalenceRows('catalog-equivalence-groups.jsonl')
const titleEvidence = readEquivalenceRows('catalog-title-evidence.jsonl')
const equivalenceExclusions = readEquivalenceRows('catalog-equivalence-exclusions.jsonl')
const groupIds = new Set()
const explicitlyLinkedWorkIds = new Set()
for (const group of equivalenceGroups) {
  invariant(group.schemaVersion === 'baihepailei-public-catalog-equivalence-v1', 'equivalence group schema drift')
  invariant(group.decision === 'merge', `${group.groupId} has a non-merge decision`)
  invariant(!groupIds.has(group.groupId), `duplicate equivalence group ${group.groupId}`)
  groupIds.add(group.groupId)
  invariant(group.workIds.length >= 2 && new Set(group.workIds).size === group.workIds.length, `${group.groupId} has invalid members`)
  invariant(group.workIds.every((workId) => byWorkId.has(String(workId))), `${group.groupId} references a non-public Work ID`)
  invariant(
    new Set((group.identities || []).map((identity) => String(identity.workId))).size === group.workIds.length &&
      group.workIds.every((workId) => (group.identities || []).some((identity) => String(identity.workId) === String(workId))),
    `${group.groupId} identity/member binding drift`,
  )
  const providerIds = new Map()
  for (const identity of group.identities || []) {
    const provider = String(identity.provider || '').toLowerCase()
    const siteIds = providerIds.get(provider) || new Set()
    siteIds.add(String(identity.siteId || ''))
    providerIds.set(provider, siteIds)
  }
  invariant([...providerIds.values()].every((siteIds) => siteIds.size === 1), `${group.groupId} conflicts within one provider`)
  invariant(group.checks?.noSameProviderConflict === true, `${group.groupId} lacks provider-conflict validation`)
  invariant(group.checks?.noBlockingRatingConflict === true, `${group.groupId} lacks rating-conflict validation`)
  for (const workId of group.workIds) {
    invariant(!explicitlyLinkedWorkIds.has(String(workId)), `Work ${workId} appears in multiple equivalence groups`)
    explicitlyLinkedWorkIds.add(String(workId))
  }
}
invariant(new Set(titleEvidence.map((row) => String(row.workId))).size === titleEvidence.length, 'duplicate title-evidence Work ID')
invariant(
  titleEvidence.every((row) =>
    row.schemaVersion === 'baihepailei-public-catalog-title-evidence-v1' &&
    byWorkId.has(String(row.workId)) &&
    Array.isArray(row.titles) && row.titles.length > 0 &&
    row.titles.every((title) => typeof title.title === 'string' && title.title.trim()) &&
    (row.sources || []).every((source) => /^https?:\/\//i.test(source.url))
  ),
  'invalid catalog title evidence',
)
invariant(
  equivalenceExclusions.every((row) => row.schemaVersion === 'baihepailei-public-catalog-equivalence-exclusion-v1'),
  'equivalence exclusion schema drift',
)
invariant(equivalenceGroups.length === 427, 'equivalence-group count drift')
invariant(explicitlyLinkedWorkIds.size === 854, 'explicitly linked Work count drift')
invariant(titleEvidence.length === 5_619, 'title-evidence row count drift')
invariant(titleEvidence.reduce((sum, row) => sum + row.titles.length, 0) === 19_307, 'title-evidence value count drift')
invariant(equivalenceExclusions.length === 31, 'equivalence-exclusion count drift')

const checksumLines = readFileSync(join(equivalenceDir, 'SHA256SUMS'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => line.trim())
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/)
  invariant(match, `invalid equivalence checksum line: ${line}`)
  const [, expected, file] = match
  const bytes = readFileSync(join(equivalenceDir, file))
  invariant(createHash('sha256').update(bytes).digest('hex') === expected, `${file} release checksum drift`)
}

console.log(JSON.stringify({
  releaseId: manifest.releaseId,
  catalogWorks: records.length,
  decisionScopeWorks: audited.length,
  ratedWorks: rated.length,
  terminalWorks: terminal.length,
  gradeCounts: grades,
  dUnclear: dUnclear.length,
  mediaEnrichments: mediaWorkIds.length,
  workAssetEnrichments: workAssets.length,
  ratingDetailEnrichments: ratingDetails.length,
  equivalenceGroups: equivalenceGroups.length,
  titleEvidenceRows: titleEvidence.length,
  equivalenceExclusions: equivalenceExclusions.length,
  shards: manifest.shards.length,
  status: 'PASS',
}, null, 2))
