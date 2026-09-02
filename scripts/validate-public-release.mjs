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

console.log(JSON.stringify({
  releaseId: manifest.releaseId,
  catalogWorks: records.length,
  decisionScopeWorks: audited.length,
  ratedWorks: rated.length,
  terminalWorks: terminal.length,
  gradeCounts: grades,
  dUnclear: dUnclear.length,
  shards: manifest.shards.length,
  status: 'PASS',
}, null, 2))
