import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const script = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-ai-radar-full-coverage-direct-overwrite-first5-v02.ps1'),
  'utf8',
)

test('first-five executor is hard-limited to at most five rows', () => {
  assert.match(script, /\[ValidateRange\(1, 5\)\]/u)
  assert.match(script, /\[int\]\$MaxRows = 5/u)
  assert.match(script, /"--max-rows", \[string\]\$MaxRows/u)
})

test('first-five executor only runs on main', () => {
  assert.match(script, /\$ExpectedBranch = "main"/u)
  assert.match(script, /首批正式发布只能在 main 分支执行/u)
})

test('first-five executor creates and verifies a fresh database backup proof', () => {
  assert.match(script, /& pg_dump --dbname=\$env:DATABASE_URI --format=custom --file=\$DumpFile/u)
  assert.match(script, /ai-radar-full-coverage-backup-proof-v0\.1/u)
  assert.match(script, /dumpSha256 = Get-Sha256 \$DumpFile/u)
  assert.match(script, /dumpBytes = \$DumpItem\.Length/u)
  assert.match(script, /gitCommit = \$Head/u)
})

test('first-five executor calls only the direct overwrite runner', () => {
  assert.match(script, /run-ai-radar-full-coverage-direct-overwrite-v02\.mjs/u)
  assert.match(script, /"--execute"/u)
  assert.doesNotMatch(script, /run-ai-radar-full-coverage-publication-v02\.ps1/u)
  assert.doesNotMatch(script, /restoreVersion/u)
  assert.doesNotMatch(script, /\/api\/works\/versions\//u)
})

test('first-five executor requires verified completion and stops on any failure', () => {
  assert.match(script, /if \(\$Completed -ne \$MaxRows\)/u)
  assert.match(script, /if \(\$Failed -ne 0\)/u)
  assert.match(script, /首批 direct-overwrite 执行失败；不要直接重跑/u)
  assert.match(script, /stopOnFirstFailure = \$true/u)
})

test('first-five checkpoint records no version restore or whole-draft publication', () => {
  assert.match(script, /versionRestore = \$false/u)
  assert.match(script, /versionRoundtrip = \$false/u)
  assert.match(script, /wholeDraftPublication = \$false/u)
  assert.match(script, /humanAssessmentMutation = \$false/u)
  assert.match(script, /RADAR-FULL-COVERAGE-DIRECT-OVERWRITE-FIRST5-checkpoint-v02\.zip/u)
})
