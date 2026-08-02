import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const library = fs.readFileSync(
  new URL('../scripts/radar/lib/radar-unified-rating-incremental-production-9988-v01.ps1', import.meta.url),
  'utf8',
)
const prepare = fs.readFileSync(
  new URL('../scripts/radar/prepare-unified-rating-incremental-production-candidate-9988-v01.ps1', import.meta.url),
  'utf8',
)
const applyOnce = fs.readFileSync(
  new URL('../scripts/radar/run-unified-rating-incremental-production-apply-once-9988-v01.ps1', import.meta.url),
  'utf8',
)

test('shared production library locks the exact 575 to 10,563 transition', () => {
  assert.match(library, /ExpectedWorks = 35615/)
  assert.match(library, /ExistingRecords = 575/)
  assert.match(library, /ExistingRatings = 575/)
  assert.match(library, /NewRows = 9988/)
  assert.match(library, /'public\.radar_public_records' = 575/)
  assert.match(library, /'public\.radar_public_ratings' = 575/)
  assert.match(library, /publicRecords = 9988/)
  assert.match(library, /publicRatings = 9988/)
  assert.match(library, /facts = 39952/)
  assert.match(library, /unresolvedDimensions = 107832/)
  assert.match(library, /'public\.audit_events' = 19976/)
  assert.match(library, /'public\.users_sessions' = 3/)
  assert.match(library, /生产 apply 前后表集合发生变化/)
})

test('candidate preparation is source-read-only apart from a fresh pg_dump', () => {
  assert.match(prepare, /PREPARE-RADAR-UNIFIED-RATING-INCREMENTAL-PRODUCTION-CANDIDATE-9988-V01/)
  assert.match(prepare, /Assert-RadarIncrementalAuditReport/)
  assert.match(prepare, /Get-RadarIncrementalSnapshot/)
  assert.match(prepare, /pg_dump -Fc --no-owner --no-privileges/)
  assert.match(prepare, /sourceCountsUnchangedDuringBackup = \$true/)
  assert.match(prepare, /protectedFingerprintsUnchangedDuringBackup = \$true/)
  assert.match(prepare, /applyOnceEligible = \$true/)
  assert.match(prepare, /productionAuthorization = \$false/)
  assert.match(prepare, /sourceDatabaseWrite = \$false/)
  assert.match(prepare, /Restart-RadarIncrementalWriters/)
  assert.doesNotMatch(prepare, /Invoke-IncrementalProductionImporter/)
  assert.doesNotMatch(prepare, /RADAR_PAYLOAD_PASSWORD/)
  assert.doesNotMatch(prepare, /Remove-Item[^\n]*\.dump/u)
})

test('apply-once requires candidate identity and exact typed authorization', () => {
  assert.match(applyOnce, /APPLY-RADAR-UNIFIED-RATING-INCREMENTAL-9988-ONCE-I-ACCEPT-19976-CREATES/)
  assert.match(applyOnce, /ExpectedProductionCandidateSha256/)
  assert.match(applyOnce, /Production Candidate SHA-256 不匹配/)
  assert.match(applyOnce, /candidate\.productionAuthorization -ne \$false/)
  assert.match(applyOnce, /candidate\.applyOnceEligible -ne \$true/)
  assert.match(applyOnce, /candidate\.automaticRetryAllowed -ne \$false/)
  assert.match(applyOnce, /candidate\.automaticRollbackAllowed -ne \$false/)
  assert.match(applyOnce, /Production Candidate source counts/)
  assert.match(applyOnce, /Production Candidate source protected fingerprints/)
  assert.match(applyOnce, /Production Candidate 绑定的 fresh backup 已变化/)
  assert.match(applyOnce, /生产关键代码已变化/)
})

test('apply-once executes plan, apply and verify through the create-only importer', () => {
  assert.match(applyOnce, /foreach \(\$mode in @\('plan', 'apply', 'verify'\)\)/)
  assert.match(applyOnce, /run-unified-rating-incremental-production-import-9988-v01\.mjs/)
  assert.match(applyOnce, /Assert-ProductionPlanReceipt/)
  assert.match(applyOnce, /Assert-ProductionApplyReceipt/)
  assert.match(applyOnce, /Assert-ProductionVerifyReceipt/)
  assert.match(applyOnce, /recordCreate -ne 9988/)
  assert.match(applyOnce, /ratingCreate -ne 9988/)
  assert.match(applyOnce, /updateRequests -ne 0/)
  assert.match(applyOnce, /putRequests -ne 0/)
  assert.match(applyOnce, /deleteRequests -ne 0/)
  assert.match(applyOnce, /Assert-RadarIncrementalPostCounts/)
  assert.match(applyOnce, /protectedFingerprintsUnchanged = \$true/)
  assert.doesNotMatch(applyOnce, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/)
  assert.doesNotMatch(applyOnce, /payload\.(?:update|delete)/)
})

test('partial production failure never retries, rolls back, or restarts writers automatically', () => {
  assert.match(applyOnce, /automaticRetryAllowed = \$false/)
  assert.match(applyOnce, /automaticRollbackExecuted = \$false/)
  assert.match(applyOnce, /operatorMustInspectBeforeRetry = \$true/)
  assert.match(applyOnce, /operatorMustInspectBeforeWriterRestart = \(\$applyStarted -and -not \$applyCompleted\)/)
  assert.match(applyOnce, /\$null -ne \$operationError -and -not \$applyStarted/)
  assert.doesNotMatch(applyOnce, /if \(\$null -ne \$operationError\)[\s\S]{0,300}Restart-RadarIncrementalWriters/)
  assert.doesNotMatch(applyOnce, /pg_restore/)
  assert.doesNotMatch(applyOnce, /Remove-Item[^\n]*\.dump/u)
})
