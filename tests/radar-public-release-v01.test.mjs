import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  rejectWriteFlags,
  validatePublicReleaseDirectory,
} from '../scripts/radar/lib/public-release-v01.mjs'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function baseRecord(overrides = {}) {
  return {
    schemaVersion: 'radar-public-record-v01',
    workId: '100',
    siteId: 'catalog-anilist-200',
    identityKey: '100|catalog-anilist-200',
    title: 'Example Work',
    aliases: ['示例作品'],
    externalIds: { anilist: '200' },
    publicState: 'partial',
    researchStatus: 'partially_verified',
    lastReviewedAt: '2026-08-01T00:00:00Z',
    pageNotice: '部分资料已核实，其余内容仍待研究。',
    evidence: [
      {
        sourceRef: 'src-1',
        tier: 'A',
        role: 'primary',
        url: 'https://example.com/work/200',
        title: 'Official work page',
        exactIdentityBound: true,
        retrievedAt: '2026-08-01T00:00:00Z',
      },
    ],
    facts: [
      { factId: 'fact-1', type: 'publication', value: 'Published', sourceRefs: ['src-1'] },
    ],
    ...overrides,
  }
}

function writePackage(records, mutateManifest = (value) => value) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-public-release-v01-'))
  const recordsText = `${records.map((row) => JSON.stringify(row)).join('\n')}\n`
  fs.writeFileSync(path.join(root, 'records.jsonl'), recordsText)
  const counts = {
    records: records.length,
    verified: records.filter((row) => row.publicState === 'verified').length,
    partial: records.filter((row) => row.publicState === 'partial').length,
    needsMoreResearch: records.filter((row) => row.publicState === 'needs_more_research').length,
    rated: records.filter((row) => row.assessment != null).length,
    unrated: records.filter((row) => row.assessment == null).length,
  }
  const manifest = mutateManifest({
    schemaVersion: 'radar-public-release-v01',
    releaseId: 'RADAR-PUBLIC-RELEASE-0001',
    generatedAt: '2026-08-01T00:00:00Z',
    source: {
      repository: 'wtyliangtingRe/baihepailei-research-data',
      commitSha: 'a'.repeat(40),
      policyVersion: 'radar-rating-policy-v0.2-draft',
      researchSnapshotId: 'snapshot-0001',
    },
    files: {
      records: { path: 'records.jsonl', rowCount: records.length, sha256: sha256(recordsText) },
    },
    counts,
    gates: {
      dryRunOnly: true,
      sourceEvidenceRequired: true,
      identityReviewExcluded: true,
      payloadWrite: false,
      postgresqlWrite: false,
      automaticPublication: false,
      humanVerifiedOverwrite: false,
      provisionalRatingPublic: false,
      identitySubstitution: false,
      titleBasedIdentityMatch: false,
    },
  })
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  fs.writeFileSync(path.join(root, 'manifest.json'), manifestText)
  fs.writeFileSync(
    path.join(root, 'SHA256SUMS'),
    `${sha256(manifestText)}  manifest.json\n${sha256(recordsText)}  records.jsonl\n`,
  )
  return root
}

test('accepts a closed, checksum-bound dry-run package', () => {
  const partial = baseRecord()
  const unrated = baseRecord({
    workId: '101',
    siteId: 'VNDB-V101',
    identityKey: '101|VNDB-V101',
    title: 'Sparse Work',
    aliases: [],
    externalIds: { vndb: 'V101' },
    publicState: 'needs_more_research',
    researchStatus: 'needs_more_research',
    pageNotice: '当前公开资料不足，暂不提供排雷评级。',
    facts: [],
  })
  const root = writePackage([partial, unrated])
  const result = validatePublicReleaseDirectory(root)
  assert.equal(result.decision, 'accept_public_release_dry_run')
  assert.deepEqual(result.counts, {
    records: 2,
    verified: 0,
    partial: 1,
    needsMoreResearch: 1,
    rated: 0,
    unrated: 2,
  })
  assert.equal(result.gates.canImport, false)
})

test('rejects an assessment on needs_more_research', () => {
  const record = baseRecord({
    publicState: 'needs_more_research',
    researchStatus: 'needs_more_research',
    assessment: {
      track: 'radar',
      gradeLabel: 'B',
      reviewStatus: 'approved_for_publication',
      policyVersion: 'v1',
      reviewedAt: '2026-08-01T00:00:00Z',
      sourceRefs: ['src-1'],
    },
  })
  assert.throws(() => validatePublicReleaseDirectory(writePackage([record])), /must not publish an assessment/u)
})

test('rejects identity_review as a public state', () => {
  const record = baseRecord({ publicState: 'identity_review' })
  assert.throws(() => validatePublicReleaseDirectory(writePackage([record])), /publicState is invalid/u)
})

test('rejects missing evidence references', () => {
  const record = baseRecord({ facts: [{ factId: 'fact-1', type: 'publication', value: 'Published', sourceRefs: ['missing'] }] })
  assert.throws(() => validatePublicReleaseDirectory(writePackage([record])), /references missing evidence/u)
})

test('rejects facts supported only by lead-only evidence', () => {
  const record = baseRecord({
    evidence: [{
      sourceRef: 'src-1', tier: 'D', role: 'lead_only', url: 'https://example.com/lead',
      title: 'Community lead', exactIdentityBound: true,
    }],
  })
  assert.throws(() => validatePublicReleaseDirectory(writePackage([record])), /cannot rely only on lead_only evidence/u)
})

test('rejects checksum tampering', () => {
  const root = writePackage([baseRecord()])
  fs.appendFileSync(path.join(root, 'records.jsonl'), '{}\n')
  assert.throws(() => validatePublicReleaseDirectory(root), /SHA-256 mismatch/u)
})

test('rejects write and publication flags', () => {
  assert.throws(() => rejectWriteFlags({ input: 'x', publish: true }), /dry-run only/u)
  assert.throws(() => rejectWriteFlags({ apply: true }), /dry-run only/u)
})
