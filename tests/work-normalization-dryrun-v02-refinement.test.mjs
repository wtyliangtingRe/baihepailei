import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const planner = path.join(repoRoot, 'scripts/radar/refine-work-normalization-dryrun-v02.mjs')
const wrapperSource = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-work-normalization-dryrun-v02.ps1'),
  'utf8',
)

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function rankRow(overrides = {}) {
  return {
    id: 10,
    title: 'Example',
    slug: 'example-bangumi-10',
    preservationClass: 'private_ai_requires_publication_review',
    storedRank: 'B',
    effectiveGradeWithoutPublicAI: 'unknown',
    candidatePublicAIGrade: 'B',
    requiresPublicationReview: true,
    automaticPublicationEligible: false,
    retireStoredRankNow: false,
    reason: 'Private AI candidate.',
    provenance: {
      payloadStatus: 'published',
      catalogStatus: 'active',
      privateAI: { grade: 'B' },
    },
    ...overrides,
  }
}

test('v02 refinement excludes nonpublic AI, blocks unresolved identity, and fixes timestamp comparisons', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-normalization-v02-'))
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  fs.mkdirSync(input)

  const humanRows = [{
    id: 100,
    title: 'Endro~!',
    slug: 'endro-anilist-100',
    action: 'copy_semantic_legacy_to_canonical',
    automaticWriteEligible: true,
    requiresExplicitDecision: false,
  }]
  const rankRows = [
    rankRow({ id: 101, title: 'Endro~!', slug: 'endro-bangumi-101' }),
    rankRow({
      id: 200,
      title: 'Archived test',
      slug: 'archived-test-200',
      provenance: {
        payloadStatus: 'draft',
        catalogStatus: 'archived',
        privateAI: { grade: 'B' },
      },
    }),
    rankRow({ id: 300, title: 'Soukou no Strain', slug: 'soukou-no-strain-anilist-300' }),
    rankRow({ id: 301, title: '奏光之Strain', slug: '奏光之strain-bangumi-301' }),
  ]

  writeJson(path.join(input, 'normalization-summary.json'), {
    safety: {
      databaseWrite: false,
      executableUpdateSqlGenerated: false,
    },
  })
  writeJsonl(path.join(input, 'human-normalization-plan.jsonl'), humanRows)
  writeJsonl(path.join(input, 'rank-preservation-plan.jsonl'), rankRows)
  writeJson(path.join(input, 'schema-retirement-plan.json'), [])
  fs.writeFileSync(
    path.join(input, 'phase1-human-normalization-dryrun.sql'),
    `BEGIN TRANSACTION READ ONLY;\nSELECT\n  w.human_assessment_assessed_at::text IS NOT DISTINCT FROM p.expected_canonical_assessed_at,\n  w.human_reviewed_at::text IS NOT DISTINCT FROM p.expected_legacy_reviewed_at;\nROLLBACK;\n`,
    'utf8',
  )
  fs.writeFileSync(
    path.join(input, 'schema-retirement-dryrun.sql'),
    'BEGIN TRANSACTION READ ONLY;\nSELECT 1;\nROLLBACK;\n',
    'utf8',
  )

  const manifestFiles = fs.readdirSync(input).sort()
  writeJson(path.join(input, 'manifest.json'), manifestFiles.map((name) => {
    const file = path.join(input, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256(file) }
  }))

  const result = spawnSync(process.execPath, [
    planner,
    '--dryrun-dir', input,
    '--output-dir', output,
  ], { cwd: repoRoot, encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr || result.stdout)

  const summary = JSON.parse(fs.readFileSync(path.join(output, 'normalization-summary-v02.json'), 'utf8'))
  assert.equal(summary.publicAIReviewCandidateRows, 3)
  assert.equal(summary.nonPublicPreservedRows, 1)
  assert.equal(summary.humanIdentityGateRows, 1)
  assert.equal(summary.identityAlertGroups, 2)
  assert.equal(summary.safety.executableUpdateSqlGenerated, false)

  const publicRows = fs.readFileSync(path.join(output, 'public-ai-review-candidates-v02.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.deepEqual(publicRows.map((row) => row.id).sort((a, b) => a - b), [101, 300, 301])
  assert.ok(publicRows.every((row) => row.identityGateRequired === true))

  const nonPublic = fs.readFileSync(path.join(output, 'nonpublic-assessment-preservation.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.equal(nonPublic[0].id, 200)
  assert.equal(nonPublic[0].preservationClass, 'archived_nonpublic_private_ai')
  assert.equal(nonPublic[0].requiresPublicationReview, false)

  const alerts = fs.readFileSync(path.join(output, 'canonical-identity-review-alerts.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse)
  assert.deepEqual(alerts.map((row) => row.workIds), [[100, 101], [300, 301]])

  const correctedSql = fs.readFileSync(path.join(output, 'phase1-human-normalization-dryrun-v02.sql'), 'utf8')
  assert.match(correctedSql, /expected_canonical_assessed_at::timestamptz/u)
  assert.match(correctedSql, /expected_legacy_reviewed_at::timestamptz/u)
  assert.doesNotMatch(correctedSql, /assessed_at::text IS NOT DISTINCT/u)
})

test('v02 packaging wrapper remains fail-closed and read-only', () => {
  assert.match(wrapperSource, /refine-work-normalization-dryrun-v02\.mjs/u)
  assert.match(wrapperSource, /canonicalIdentityGate/u)
  assert.match(wrapperSource, /typedTimestampComparison/u)
  assert.match(wrapperSource, /Get-ChildItem -LiteralPath \$sourceDir -Force/u)
  assert.doesNotMatch(wrapperSource, /Copy-Item -LiteralPath[^\n]*\*/u)
  assert.match(wrapperSource, /ExecutableUpdateSQL\s+: False/u)
  assert.doesNotMatch(wrapperSource, /payload\s+migrate/u)
  assert.doesNotMatch(
    wrapperSource,
    /^\s*(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE\s+TABLE)\b/gimu,
  )
})
