import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const v01Path = path.join(root, 'scripts/radar/build-all-remaining-radar-global-audit-v01.mjs')
const v02Path = path.join(root, 'scripts/radar/build-all-remaining-radar-global-audit-v02.mjs')
const v03Path = path.join(root, 'scripts/radar/build-all-remaining-radar-global-audit-v03.mjs')
const wrapperPath = path.join(root, 'scripts/radar/run-and-package-all-remaining-radar-global-audit-v01.ps1')
const secureWrapperPath = path.join(root, 'scripts/radar/run-and-package-all-remaining-radar-global-audit-v02.ps1')
const dualSnapshotWrapperPath = path.join(root, 'scripts/radar/run-and-package-all-remaining-radar-global-audit-v03.ps1')
const v01 = fs.readFileSync(v01Path, 'utf8')
const v02 = fs.readFileSync(v02Path, 'utf8')
const v03 = fs.readFileSync(v03Path, 'utf8')
const wrapper = fs.readFileSync(wrapperPath, 'utf8')
const secureWrapper = fs.readFileSync(secureWrapperPath, 'utf8')
const dualSnapshotWrapper = fs.readFileSync(dualSnapshotWrapperPath, 'utf8')

test('global audit sources parse and active v03 reaches normal required-argument validation', () => {
  for (const file of [v01Path, v02Path, v03Path]) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  const result = spawnSync(process.execPath, [v03Path], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Required: --source/u)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Expected \d+ occurrence\(s\), found/u)
})

test('global audit locks the complete v0.6 source and never reintroduces discarded test assessments', () => {
  assert.match(v01, /EXPECTED_SOURCE_ROWS = 10805/u)
  assert.match(v01, /EXPECTED_SOURCE_READY = 9364/u)
  assert.match(v01, /EXPECTED_SOURCE_BLOCKED = 1441/u)
  assert.match(v01, /EXPECTED_SOURCE_GUARDED = 698/u)
  assert.match(v01, /EXPECTED_WORKS = 35615/u)
  for (const id of ['10097', '32186', '25561', '32094']) assert.match(v01, new RegExp(`'${id}'`, 'u'))
  assert.match(v01, /discarded_test_assessment_requires_fresh_research/u)
  assert.match(v01, /testWorkAssessmentsReintroduced: false/u)
})

test('active v03 uses draft Works for private AI and published Works for public lifecycle', () => {
  assert.match(v03, /EXPECTED_DRAFT_WORKS = 35615/u)
  assert.match(v03, /EXPECTED_PUBLISHED_WORKS = 35613/u)
  assert.match(v03, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'true' \}\)/u)
  assert.match(v03, /fetchCollection\(baseUrl, token, 'works', \{ draft: 'false' \}\)/u)
  assert.match(v03, /const draftWorkById/u)
  assert.match(v03, /const publishedWorkById/u)
  assert.match(v03, /lifecycleBlockers\(publishedWork\)/u)
  assert.match(v03, /publicAssessmentFor\(source, privatePlan, publishedWork\)/u)
  assert.match(v03, /publishedWorksRead/u)
  assert.doesNotMatch(v03, /lifecycleBlockers\(targetWork\)/u)
})

test('global audit keeps private and public tracks separate and publication-safe', () => {
  assert.match(v01, /ready_private_ai_write/u)
  assert.match(v01, /already_current_private_ai/u)
  assert.match(v01, /ready_public_ai_after_schema/u)
  assert.match(v01, /publication_guard/u)
  assert.match(v01, /catalog_status_/u)
  assert.match(v01, /payload_status_/u)
  assert.match(v01, /humanTrackRecorded/u)
  assert.match(v01, /humanTrackOverwritten: false/u)
  assert.match(v01, /publicationKey: `work:\$\{privatePlan\.target\.id\}`/u)
  assert.match(v01, /sourceKind: 'package'/u)
  assert.match(v01, /conclusionSha256/u)
})

test('global audit and wrappers are read-only and leave the dedicated server stopped', () => {
  assert.match(v01, /Execute\/apply\/write flags are rejected/u)
  assert.match(v01, /payloadWrite: false/u)
  assert.match(v01, /directPostgresqlWrite: false/u)
  assert.match(wrapper, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.match(wrapper, /default_transaction_read_only=on/u)
  assert.match(wrapper, /to_regclass\('public\.radar_public'\)/u)
  assert.match(wrapper, /Stop-ProcessTree/u)
  assert.match(wrapper, /DedicatedAuditServer\s+: Stopped/u)
  assert.match(dualSnapshotWrapper, /build-all-remaining-radar-global-audit-v03\.mjs/u)
  assert.match(dualSnapshotWrapper, /publishedWorksRead -ne 35613/u)
  for (const source of [wrapper, secureWrapper, dualSnapshotWrapper]) {
    assert.doesNotMatch(source, /\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE)\s+(?:TABLE|INTO|FROM|public\.)/iu)
    assert.doesNotMatch(source, /payload migrate/u)
    assert.doesNotMatch(source, /PAYLOAD_DB_PUSH\s*=\s*'true'/u)
  }
})

test('secure wrapper prompts only when credentials are missing and restores process environment', () => {
  assert.match(secureWrapper, /Read-Host '请输入 Payload 管理员邮箱'/u)
  assert.match(secureWrapper, /Read-Host '请输入 Payload 管理员密码（输入不会显示）' -AsSecureString/u)
  assert.match(secureWrapper, /ConvertFrom-SecureString \$securePassword -AsPlainText/u)
  assert.match(secureWrapper, /Save-ProcessEnvironment 'RADAR_PAYLOAD_EMAIL'/u)
  assert.match(secureWrapper, /Save-ProcessEnvironment 'RADAR_PAYLOAD_PASSWORD'/u)
  assert.match(secureWrapper, /Restore-ProcessEnvironment \$savedRadarEmail/u)
  assert.match(secureWrapper, /Restore-ProcessEnvironment \$savedRadarPassword/u)
  assert.match(secureWrapper, /run-and-package-all-remaining-radar-global-audit-v03\.ps1/u)
  assert.doesNotMatch(secureWrapper, /PAYLOAD_DB_PUSH\s*=\s*'true'/u)
  assert.doesNotMatch(secureWrapper, /payload migrate/u)
})
