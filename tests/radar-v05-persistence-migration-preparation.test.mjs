import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const scriptPath = 'scripts/radar/prepare-radar-v05-persistence-migration-v01.ps1'
const script = fs.readFileSync(scriptPath, 'utf8')

function lineCount(pattern) {
  return (script.match(pattern) || []).length
}

test('v0.5 migration preparer is pinned to the dedicated branch and migration name', () => {
  assert.match(script, /agent\/radar-v0\.5-persistence-standardization-v01/u)
  assert.match(script, /radar_v05_persistence_standardization_v01/u)
  assert.match(script, /git fetch origin/u)
  assert.match(script, /git switch \$ExpectedBranch/u)
  assert.match(script, /git pull --ff-only origin \$ExpectedBranch/u)
  assert.match(script, /\$localHead -ne \$remoteHead/u)
})

test('preparer only creates a Payload migration under a forced read-only PostgreSQL session', () => {
  assert.match(script, /default_transaction_read_only=on/u)
  assert.match(script, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.match(script, /RADAR_PUBLIC_RECORDS_SCHEMA_READY = 'true'/u)
  assert.match(script, /RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'/u)
  assert.match(script, /pnpm payload migrate:create \$MigrationName --skip-empty/u)
  assert.doesNotMatch(script, /pnpm(?:\s+exec)?\s+payload\s+migrate(?:\s|$)(?!:create)/u)
  assert.doesNotMatch(script, /productionAuthorization\s*=\s*\$true/u)
  assert.match(script, /DatabaseMigrate\s+: False/u)
  assert.match(script, /PayloadWrite\s+: False/u)
  assert.match(script, /ProductionApply\s+: False/u)
})

test('preparer requires exactly one generated TypeScript migration plus one JSON schema snapshot', () => {
  assert.match(script, /预期只生成 1 个 TypeScript 迁移和 1 个 JSON schema snapshot/u)
  assert.match(script, /\$typeScriptFiles\.Count -ne 1 -or \$snapshotFiles\.Count -ne 1/u)
  assert.match(script, /\$tsStem -ne \$jsonStem/u)
  assert.match(script, /migration snapshot 缺少预期结构/u)
  for (const token of [
    '"public.radar_public"',
    '"public.radar_public_ratings"',
    '"public.radar_public_records"',
    '"public.works"',
    'conclusion_mode',
    'labels_only',
    'blocked',
  ]) {
    assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  }
})

test('generated DDL is limited to the Candidate and Published persistence structures', () => {
  assert.match(script, /Assert-V05OnlyDDL/u)
  assert.match(script, /radar_public_ratings/u)
  assert.match(script, /compatibility_grade/u)
  assert.match(script, /conclusion_mode/u)
  assert.match(script, /迁移修改了非目标表/u)
  assert.match(script, /迁移修改了非目标 enum/u)
  assert.match(script, /迁移混入非目标结构/u)
  assert.match(script, /DROP\\s\+TABLE/u)
  assert.match(script, /INSERT\\s\+INTO\|UPDATE\\s\+\|DELETE\\s\+FROM/u)
  for (const forbidden of ['human_assessment_grade', 'radar_assessment_suggested_grade', 'legacy_x_wiki_page', 'radar_public_records']) {
    assert.match(script, new RegExp(forbidden, 'u'))
  }
})

test('failure cleanup deletes only this run generated pair and restores migration index', () => {
  assert.match(script, /Get-NewPaths -Before \$beforeArtifacts/u)
  assert.match(script, /Remove-Item -LiteralPath \$path -Force/u)
  assert.match(script, /git restore --worktree -- 'src\/migrations\/index\.ts'/u)
  assert.match(script, /生成迁移后出现预期之外的文件修改/u)
})

test('CommitAndPush stages only migration index and the generated migration pair', () => {
  assert.match(script, /if \(\$CommitAndPush\)/u)
  assert.match(script, /git add --/u)
  assert.match(script, /src\/migrations\/index\.ts/u)
  assert.match(script, /\$migrationTypeScriptName/u)
  assert.match(script, /\$migrationSnapshotName/u)
  assert.match(script, /暂存文件集合与预期不一致/u)
  assert.equal(lineCount(/git commit -m 'Generate Radar v0\.5 persistence migration snapshot'/gu), 1)
  assert.equal(lineCount(/git push origin \$ExpectedBranch/gu), 1)
})

test('preparer runs focused tests, TypeScript checks, and whitespace checks before success', () => {
  for (const testFile of [
    'radar-unified-rating-release-plan-v01.test.mjs',
    'radar-public-ratings-schema.test.mjs',
    'radar-v05-persistence-standardization.test.mjs',
    'radar-v05-persistence-migration-preparation.test.mjs',
  ]) {
    assert.match(script, new RegExp(testFile.replace('.', '\\.'), 'u'))
  }
  assert.ok(lineCount(/pnpm exec tsc --noEmit/gu) >= 2)
  assert.match(script, /git diff --check/u)
})
