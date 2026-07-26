import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  CAMPAIGN_SAFETY,
  archiveInventory,
  assertOutputPath,
  auditCampaignWave,
  buildCoverageLedger,
  campaignInputRow,
  filesUnder,
  readJsonl,
  rejectWriteFlags,
  researchResponseSchema,
  validateCampaignDirectory,
  validateCampaignZip,
  validateSelection,
  writeCampaignPackage,
} from '../scripts/radar/lib/research-campaign-v01.mjs'

const repo = path.resolve(import.meta.dirname, '..')

function temporary(prefix = 'radar-next-campaign-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function row(index, overrides = {}) {
  const id = String(index)
  return {
    workId: id,
    siteId: `site:${id}`,
    title: `Work ${id}`,
    publicationKey: `work:${id}`,
    catalogStatus: 'active',
    payloadStatus: 'published',
    researchPriority: 2,
    mediaGroup: 'manga',
    mediaType: 'manga',
    ...overrides,
  }
}

function rows(count, start = 1) {
  return Array.from({ length: count }, (_, index) => row(start + index))
}

function coverageFor(canonicalRows, targetRows = canonicalRows.length, coverageSources = []) {
  return buildCoverageLedger({ canonicalRows, targetRows, coverageSources })
}

function packageFixture({
  count = 8,
  waveSize = 4,
  chunkSize = 2,
  root = temporary(),
} = {}) {
  const output = path.join(root, 'data_local', 'campaign')
  const coverage = coverageFor(rows(count), count)
  const result = writeCampaignPackage(output, coverage, {
    packageId: 'TEST-RADAR-CAMPAIGN',
    targetRows: count,
    waveSize,
    chunkSize,
    sourcePackageId: 'TEST-CANONICAL-SOURCE',
    sourceManifestSha256: 'a'.repeat(64),
    acceptedSourceBinding: { fixture: true },
  })
  return { root, output, result }
}

function createZip(zip, entries) {
  const escapedZip = zip.replaceAll("'", "''")
  const statements = entries.map(({ name, content = 'x', mode = 0 }) => {
    const escapedName = name.replaceAll("'", "''")
    const escapedContent = content.replaceAll("'", "''")
    const attributes = mode ? `$e.ExternalAttributes=([int]0x${mode.toString(16)} -shl 16);` : ''
    return `$e=$z.CreateEntry('${escapedName}');${attributes}$w=[IO.StreamWriter]::new($e.Open());$w.Write('${escapedContent}');$w.Dispose();`
  }).join('')
  const script = `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${escapedZip}',[System.IO.Compression.ZipArchiveMode]::Create);${statements}$z.Dispose()`
  execFileSync('powershell', ['-NoProfile', '-Command', script])
}

test('selects exactly 10,000 eligible rows with deterministic repository ordering', () => {
  const canonical = rows(10_025).reverse()
  const first = coverageFor(canonical, 10_000)
  const second = coverageFor([...canonical].sort(() => 0), 10_000)
  assert.equal(first.canPrepare, true)
  assert.equal(first.selectedSourceRows.length, 10_000)
  assert.deepEqual(
    first.selectedSourceRows.map((item) => item.workId),
    second.selectedSourceRows.map((item) => item.workId),
  )
  assert.equal(first.selectedSourceRows[0].workId, '1')
  assert.equal(first.selectedSourceRows.at(-1).workId, '10000')
  assert.equal(new Set(first.selectedSourceRows.map((item) => `${item.workId}|${item.siteId}`)).size, 10_000)
})

test('reports an honest shortfall without padding, duplication, or fabrication', () => {
  const result = coverageFor(rows(9_999), 10_000)
  assert.equal(result.canPrepare, false)
  assert.equal(result.selectedSourceRows.length, 9_999)
  assert.equal(result.counts.shortfall, 1)
  assert.deepEqual(result.blockers, ['eligible_rows_shortfall:9999/10000'])
})

test('excludes overlap across accepted research, assessment, import, and v0.6 manifests', () => {
  const canonical = rows(8)
  const result = coverageFor(canonical, 3, [
    { packageId: 'radar-v06-completed', manifestSource: 'v06/manifest.json', coverageType: 'v0.6_completed_publication', rows: [row(1), row(2)] },
    { packageId: 'earlier-2500', manifestSource: 'research/package-manifest.json', coverageType: 'earlier_2500_research_campaign', rows: [row(2), row(3)] },
    { packageId: 'assessment-v02', manifestSource: 'assessment/immutable-root.json', coverageType: 'accepted_assessment_input', rows: [row(3)] },
    { packageId: 'import-v02', manifestSource: 'import/SHA256SUMS', coverageType: 'completed_local_import_review', rows: [row(3)] },
  ])
  assert.equal(result.counts.totalPriorCoveredExclusions, 3)
  assert.deepEqual(result.selectedSourceRows.map((item) => item.workId), ['4', '5', '6'])
  const work3 = result.exclusionLedger.find((item) => item.workId === '3')
  assert.deepEqual(work3.priorPackageOrManifestSources.map((item) => item.packageId).sort(), ['assessment-v02', 'earlier-2500', 'import-v02'])
  assert.equal(result.counts.coveredByPackage['radar-v06-completed'], 2)
  assert.equal(result.counts.coveredByPackage['earlier-2500'], 2)
})

test('excludes protected and human-verified rows with auditable state', () => {
  const canonical = [
    row(1, { writeProtection: { protected: true, reasons: ['manual_lock'] } }),
    row(2, { humanAssessment: { status: 'reviewed' }, reviewStatus: 'reviewed', humanReviewedBy: 'reviewer' }),
    row(3),
  ]
  const result = coverageFor(canonical, 1)
  assert.equal(result.counts.protectedExclusions, 1)
  assert.equal(result.counts.humanVerifiedExclusions, 1)
  assert.equal(result.selectedSourceRows[0].workId, '3')
  assert.equal(result.exclusionLedger.find((item) => item.workId === '1').writeProtection.protected, true)
  assert.equal(result.exclusionLedger.find((item) => item.workId === '2').humanVerification.verified, true)
})

test('records duplicate workId, siteId, and normalized identity exclusions and rejects them in a selection', () => {
  const canonical = [
    row(1),
    row(1, { siteId: 'site:duplicate-work', title: 'Duplicate work' }),
    row(2, { siteId: 'site:1', title: 'Duplicate site' }),
    row(3, { siteId: 'ＳＩＴＥ：３', title: '  Same   Title ' }),
    row(4, { siteId: 'site:3', title: 'same title' }),
    row(5),
  ]
  const result = coverageFor(canonical, 2)
  assert.equal(result.counts.duplicateWorkIdExclusions, 2)
  assert.equal(result.counts.duplicateSiteIdExclusions, 2)
  assert.equal(result.counts.duplicateNormalizedIdentityExclusions, 2)

  const base = campaignInputRow(row(10), 1, { packageId: 'test', waveSize: 2, chunkSize: 1 })
  assert.throws(() => validateSelection([base, { ...base, siteId: 'other' }], 2), /Duplicate selected workId/u)
  assert.throws(() => validateSelection([base, { ...base, workId: 'other' }], 2), /Duplicate selected siteId/u)
  assert.throws(() => validateSelection([
    { ...base, workId: 'a', siteId: 'ＳＩＴＥ：Ａ', title: ' Same ' },
    { ...base, workId: 'b', siteId: 'site:a', title: 'same' },
  ], 2), /Duplicate selected normalized identity/u)
})

test('creates the exact 10,000 / 40 / 400 / 25 campaign with 400 empty response slots', { timeout: 60_000 }, (t) => {
  const root = temporary('radar-next-10000-scale-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const output = path.join(root, 'data_local', 'campaign')
  const coverage = coverageFor(rows(10_000), 10_000)
  const result = writeCampaignPackage(output, coverage, {
    packageId: 'TEST-NEXT-10000',
    targetRows: 10_000,
    waveSize: 250,
    chunkSize: 25,
    sourcePackageId: 'TEST-CANONICAL-SOURCE',
    sourceManifestSha256: 'b'.repeat(64),
  })
  assert.equal(result.verification.selectedRows, 10_000)
  assert.equal(result.verification.waveCount, 40)
  assert.equal(result.verification.chunkCount, 400)
  assert.equal(result.verification.chunkSize, 25)
  assert.equal(result.verification.emptyResponseSlotCount, 400)
  assert.equal(result.verification.completedWaveCount, 0)
  assert.equal(result.verification.incompleteWaveCount, 40)
  assert.equal(result.verification.invalidWaveCount, 0)
  assert.equal(result.verification.identityOrderMismatches, 0)
  assert.equal(result.verification.blockers.length, 0)
  const selectionSummary = JSON.parse(fs.readFileSync(path.join(output, 'selection/selection-summary-v01.json'), 'utf8'))
  assert.equal(selectionSummary.firstIdentity.ordinal, 1)
  assert.equal(selectionSummary.lastIdentity.ordinal, 10_000)
  for (const file of result.packageManifest.externalResponseInventory) {
    assert.equal(fs.statSync(path.join(output, file)).size, 0)
  }
})

test('each Wave audits independently and one invalid Wave does not suppress another', (t) => {
  const fixture = packageFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.appendFileSync(path.join(fixture.output, 'waves/wave-01/chunks/wave-01-chunk-01.input.jsonl'), '{}\n')
  const invalid = auditCampaignWave(fixture.output, 'wave-01')
  const unaffected = auditCampaignWave(fixture.output, 'wave-02')
  assert.equal(invalid.valid, false)
  assert.equal(invalid.status, 'invalid')
  assert.equal(unaffected.valid, true)
  assert.equal(unaffected.status, 'incomplete')
  assert.equal(unaffected.identityOrderMismatches, 0)
})

test('immutable root rejects package, Wave manifest, and input tampering', () => {
  for (const relative of [
    'package-manifest.json',
    'waves/wave-01/wave-manifest-v01.json',
    'waves/wave-01/chunks/wave-01-chunk-01.input.jsonl',
  ]) {
    const fixture = packageFixture()
    try {
      fs.appendFileSync(path.join(fixture.output, relative), ' ')
      assert.throws(() => validateCampaignDirectory(fixture.output), /Immutable root file mismatch/u)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
    }
  }
  const fixture = packageFixture()
  try {
    fs.appendFileSync(path.join(fixture.output, 'immutable-root-manifest-v01.json'), ' ')
    assert.throws(() => validateCampaignDirectory(fixture.output), /Immutable root manifest SHA-256 mismatch/u)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('SHA256SUMS carries the root receipt and complete immutable inventory', (t) => {
  const fixture = packageFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const rootManifest = JSON.parse(fs.readFileSync(path.join(fixture.output, 'immutable-root-manifest-v01.json'), 'utf8'))
  const lines = fs.readFileSync(path.join(fixture.output, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/u)
  assert.equal(lines.length, rootManifest.files.length + 1)
  assert.match(lines[0], /^[0-9a-f]{64}  immutable-root-manifest-v01\.json$/u)
  for (const entry of rootManifest.files) assert.ok(lines.includes(`${entry.sha256}  ${entry.file}`))
})

test('closed-world validation rejects extra or unlisted files while retaining declared missing-slot blockers', (t) => {
  const fixture = packageFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(fixture.output, 'unexpected.json'), '{}\n')
  assert.throws(() => validateCampaignDirectory(fixture.output), /Closed-world inventory mismatch/u)
  fs.rmSync(path.join(fixture.output, 'unexpected.json'))
  fs.rmSync(path.join(fixture.output, 'waves/wave-01/responses/wave-01-chunk-01.response.jsonl'))
  assert.throws(() => validateCampaignDirectory(fixture.output), /Closed-world inventory mismatch/u)
})

test('ZIP inventory rejects traversal, absolute, duplicate, case collision, symlink, and non-regular entries', () => {
  const cases = [
    [{ name: '../escape.txt' }, /Unsafe ZIP entry/u],
    [{ name: 'C:/escape.txt' }, /Unsafe ZIP entry/u],
    [{ name: 'link', mode: 0xA000 }, /symlink/u],
    [{ name: 'device', mode: 0x2000 }, /non-regular/u],
  ]
  for (const [entry, expected] of cases) {
    const root = temporary('radar-next-zip-')
    const zip = path.join(root, 'unsafe.zip')
    createZip(zip, [entry])
    assert.throws(() => archiveInventory(zip), expected)
    fs.rmSync(root, { recursive: true, force: true })
  }
  for (const entries of [
    [{ name: 'same.txt' }, { name: 'same.txt' }],
    [{ name: 'A/file.txt' }, { name: 'a/FILE.txt' }],
  ]) {
    const root = temporary('radar-next-zip-')
    const zip = path.join(root, 'collision.zip')
    createZip(zip, entries)
    assert.throws(() => archiveInventory(zip), /Duplicate/u)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('response schema preserves factual dimensions and contains no assessment outcome', () => {
  const schema = researchResponseSchema()
  const riskRequired = schema.properties.riskFindings.required
  for (const key of [
    'femaleFemaleRelationship', 'maleInvolvement', 'ntrRisk', 'endingStatus',
    'sexualContent', 'sexualParticipants', 'violenceOrHorror', 'ageOrConsentRisk',
    'coercionRisk', 'rawAdultContent', 'ts', 'futa', 'abo', 'crossdressingOrOtokonoko',
  ]) assert.ok(riskRequired.includes(key), key)
  for (const key of ['assessmentMode', 'exactGradeSuggestion', 'gradeRange', 'finalGrade', 'rating']) {
    assert.equal(Object.hasOwn(schema.properties, key), false)
    assert.equal(schema.required.includes(key), false)
  }
  assert.match(schema.description, /Adult content is factual metadata/u)
})

test('write/apply/publish flags and arbitrary output roots are rejected', () => {
  for (const key of ['execute', 'apply', 'write', 'publish', 'confirm']) {
    assert.throws(() => rejectWriteFlags({ [key]: true }), /review-only/u)
  }
  const root = temporary('radar-next-path-')
  try {
    assert.throws(() => assertOutputPath(path.join(root, 'outside'), root, 'data_local'), /under data_local/u)
    assert.equal(assertOutputPath(path.join(root, 'data_local', 'inside'), root, 'data_local'), path.join(root, 'data_local', 'inside'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('campaign code has no network, Payload, PostgreSQL, Works mutation, or publication path', () => {
  const files = [
    'lib/research-campaign-v01.mjs',
    'prepare-radar-next-10000-campaign-v01.mjs',
  ]
  const text = files.map((file) => fs.readFileSync(path.join(repo, 'scripts/radar', file), 'utf8')).join('\n')
  assert.doesNotMatch(text, /fetch\s*\(|getPayload|payload\.(find|update|create)|UPDATE\s+works|INSERT\s+INTO|DELETE\s+FROM/iu)
  assert.deepEqual(CAMPAIGN_SAFETY, {
    networkFetch: false,
    payloadRead: false,
    payloadWrite: false,
    directPostgresqlRead: false,
    directPostgresqlWrite: false,
    modifiesWorks: false,
    publishesRatings: false,
    normalReleaseGatePass: false,
    createsProductionApplyPackage: false,
    migrationOrSchemaPush: false,
    syntheticGenuineResponses: false,
    automaticXAllowed: false,
    generatedDataConfinedToDataLocal: true,
    reviewArtifactsWrittenUnderExports: true,
    arbitraryOutputPathsAllowed: false,
    reviewOnly: true,
  })
})

test('committed CLI rejects write-like flags without reading campaign sources', () => {
  const result = spawnSync(process.execPath, [
    path.join(repo, 'scripts/radar/prepare-radar-next-10000-campaign-v01.mjs'),
    '--apply',
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /review-only/u)
})

test('real prepared 10,000-row ZIP validates when supplied for rehearsal', {
  skip: !process.env.RADAR_NEXT_CAMPAIGN_ZIP,
  timeout: 120_000,
}, () => {
  const zip = path.resolve(process.env.RADAR_NEXT_CAMPAIGN_ZIP)
  const expectedSha256 = process.env.RADAR_NEXT_CAMPAIGN_SHA
  const staging = path.join(repo, 'data_local', 'test-runs', 'radar-next-10000-real-zip')
  const result = validateCampaignZip(zip, staging, {
    cwd: repo,
    expectedSha256,
    expectedTargetRows: 10_000,
  })
  assert.equal(result.selectedRows, 10_000)
  assert.equal(result.waveCount, 40)
  assert.equal(result.chunkCount, 400)
  assert.equal(result.emptyResponseSlotCount, 400)
  assert.equal(result.identityOrderMismatches, 0)
  assert.equal(result.inventoryMismatches, 0)
  assert.equal(result.blockers.length, 0)
})
