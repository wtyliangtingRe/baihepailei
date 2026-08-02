import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const scriptUrl = new URL('../scripts/radar/rehearse-unified-rating-incremental-release-9988-v02.ps1', import.meta.url)
const source = fs.readFileSync(scriptUrl, 'utf8')

test('rehearsal binds exact source, transition and Release identities', () => {
  assert.match(source, /\$ExpectedBaseMain = '24bd2f8a8d27a91282dd4d3e27ddf5e0804c6a94'/)
  assert.match(source, /\$ExpectedResearchHead = 'c8790df95d1235d8d1aacabfb7c119fec9e1c642'/)
  assert.match(source, /\$ReleaseId = 'RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-0001'/)
  assert.match(source, /\[Parameter\(Mandatory = \$true\)\]\[string\]\$TransitionPlanDirectory/)
  assert.match(source, /transition-summary\.json/)
  assert.match(source, /transition-ledger\.jsonl/)
  assert.match(source, /blockers\.json/)
  assert.match(source, /\$transitionLedgerRows\.Count -ne 9988/)
  assert.match(source, /'records\.jsonl' = '827c5d8c7ea958bf614f2a19db2ad2db2a6847dd7c82d718614a4bcb9cac71a9'/)
  assert.match(source, /'ratings\.jsonl' = '4c1a55c8cdabbd92bb8c081a28b30b6c2f3e87d370dcfccb89ed776fe0d14d18'/)
  assert.match(source, /Assert-RadarFileHash \$file \$entry\.Value/)
  assert.match(source, /\$researchHead -ne \$ExpectedResearchHead/)
  assert.match(source, /\$currentHead -ne \$ExpectedToolHead/)
})

test('bound transition and existing 575 projection are exact gates', () => {
  assert.match(source, /\$ExpectedWorks = 35615/)
  assert.match(source, /\$ExpectedExistingRecords = 575/)
  assert.match(source, /\$ExpectedExistingRatings = 575/)
  assert.match(source, /recordStatusCounts\.ready_create -ne 9988/)
  assert.match(source, /ratingStatusCounts\.ready_create -ne 9988/)
  assert.match(source, /transition\.updates -ne 0/)
  assert.match(source, /transition\.deletes -ne 0/)
  assert.match(source, /RADAR-UNIFIED-RATING-RELEASE-0575-0001/)
  assert.match(source, /previous apply marker 不匹配/)
})

test('source Payload is never accessed and no source authentication occurs', () => {
  assert.match(source, /sourceAuthenticationPerformed = \$false/)
  assert.match(source, /sourcePayloadAccess = \$false/)
  assert.match(source, /authenticationPerformed = \$false/)
  assert.match(source, /payloadAccess = \$false/)
  assert.match(source, /SourceAuthentication     : False/)
  assert.match(source, /SourcePayloadAccess      : False/)
  assert.doesNotMatch(source, /\$SourceUrl/)
  assert.doesNotMatch(source, /Invoke-WebRequest[^\n]+api\/works/u)
  assert.doesNotMatch(source, /plan-unified-rating-incremental-release-9988-v01\.mjs/)
  assert.doesNotMatch(source, /RADAR_PAYLOAD_EMAIL[\s\S]{0,250}Source/u)
})

test('fresh backup is restored only to a temporary PostgreSQL container', () => {
  assert.match(source, /pg_dump -Fc --no-owner --no-privileges/)
  assert.match(source, /source-before-incremental-rehearsal-v02-\$stamp\.dump/)
  assert.match(source, /docker run -d --name \$tempContainer/)
  assert.match(source, /pg_restore -U \$tempUser -d \$tempDatabase/)
  assert.match(source, /source → temporary restored counts/)
  assert.match(source, /source → temporary restored fingerprints/)
  assert.doesNotMatch(source, /pg_restore[^\n]+\$SourceDatabase/u)
  assert.doesNotMatch(source, /rm\s+[^\n]*freshBackupPath/u)
  assert.doesNotMatch(source, /Remove-Item[^\n]*(?:\.dump|freshBackup)/u)
})

test('rehearsal runs plan apply verify against temporary database only', () => {
  assert.match(source, /foreach \(\$mode in @\('plan', 'apply', 'verify'\)\)/)
  assert.match(source, /Start-TemporaryApp \$tempDatabaseUrl \$tempDatabase \$mode/)
  assert.match(source, /Invoke-IncrementalImporter \$mode \$app\.BaseUrl \$tempDatabase/)
  assert.match(source, /PublicRecordsCreated     : 9988/)
  assert.match(source, /PublicRatingsCreated     : 9988/)
  assert.match(source, /PostRecordsAlreadyCurrent: 9988/)
  assert.match(source, /PostRatingsAlreadyCurrent: 9988/)
  assert.doesNotMatch(source, /Invoke-IncrementalImporter[^\n]+\$SourceDatabase/u)
  assert.doesNotMatch(source, /APPLY-RADAR|Read-Host[^\n]*完整确认字符串/u)
})

test('storage deltas and protected source state are exact', () => {
  assert.match(source, /'public\.audit_events' = 19976/)
  assert.match(source, /'public\.users_sessions' = 3/)
  assert.match(source, /\$Storage\.publicRecords/)
  assert.match(source, /\$Storage\.publicRatings/)
  assert.match(source, /\$Storage\.unresolvedDimensions/)
  assert.match(source, /temporary protected fingerprints/)
  assert.match(source, /rehearsal 前后 source counts/)
  assert.match(source, /rehearsal 前后 source fingerprints/)
  assert.match(source, /sourceDatabaseWrite = \$false/)
  assert.match(source, /productionAuthorization = \$false/)
  assert.doesNotMatch(source, /sourceDatabaseWrite = \$true/)
  assert.doesNotMatch(source, /productionAuthorization = \$true/)
})

test('failure cleanup is explicit and retry remains disabled', () => {
  assert.match(source, /if \(\$app\) \{ Stop-RadarProcess \$app\.Process \}/)
  assert.match(source, /if \(\$tempCreated\) \{ & docker rm -f \$tempContainer/)
  assert.match(source, /if \(-not \$writersRestarted\)/)
  assert.match(source, /Restart-Containers \$writerContainers/)
  assert.match(source, /rehearsal-failure\.json/)
  assert.match(source, /automaticRetryAllowed = \$false/)
  assert.match(source, /automaticRollbackExecuted = \$false/)
  assert.match(source, /operatorMustInspectBeforeRetry = \$true/)
  assert.doesNotMatch(source, /git\s+(?:reset\s+--hard|clean\s+-)/)
})


test('importer writes only under its production output root and is copied into rehearsal evidence', () => {
  assert.match(source, /radar-unified-rating-incremental-production-9988-v01\\rehearsal-v02-\$stamp/)
  assert.match(source, /\$importDir = Join-Path \$importerRunRoot "temporary-\$mode-import"/)
  assert.match(source, /\$archivedImportDir = Join-Path \$outDir "temporary-\$mode-import"/)
  assert.match(source, /Get-ChildItem -LiteralPath \$importDir -Force \| Copy-Item -Destination \$archivedImportDir -Recurse -Force/)
  assert.match(source, /Join-Path \$archivedImportDir 'accepted-receipt\.json'/)
  assert.doesNotMatch(source, /\$importDir = Join-Path \$outDir "temporary-\$mode-import"/)
  assert.match(source, /importerOutputRoot = \$importerRunRoot/)
})
