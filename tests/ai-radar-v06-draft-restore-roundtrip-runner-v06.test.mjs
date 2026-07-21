import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  'scripts/radar/run-ai-radar-v06-draft-restore-roundtrip-lab-v06.ps1',
  'utf8',
)

test('runner defaults to read-only inspect and requires a new execute confirmation', () => {
  assert.match(source, /\[string\]\$Mode = 'Inspect'/u)
  assert.match(source, /EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V06-ONLY/u)
  assert.match(source, /if \(\$Confirmation -ne \$RequiredConfirmation\)/u)
  assert.match(source, /if \(\$Mode -eq 'Inspect'\)/u)
})

test('runner prompts securely and never stores a password in a command argument', () => {
  assert.match(source, /Read-Host 'Payload administrator password \(input hidden\)' -AsSecureString/u)
  assert.match(source, /Env:RADAR_PAYLOAD_PASSWORD/u)
  assert.doesNotMatch(source, /--password/u)
  assert.doesNotMatch(source, /PAYLOAD_PASSWORD=/u)
})

test('runner enforces formal database isolation and restored-lab freshness', () => {
  assert.match(source, /\$MainDatabase = 'baihepailei'/u)
  assert.match(source, /if \(\$mainConnections -ne 0\)/u)
  assert.match(source, /Expected exactly one active Radar lab database/u)
  assert.match(source, /\[int\]\$ExpectedVersionsRead = 7/u)
  assert.match(source, /\[string\]\$ExpectedCleanVersionId = '8744'/u)
  assert.match(source, /\[string\]\$ExpectedOriginalDraftVersionId = '79558'/u)
  assert.match(source, /Execute mode requires a freshly restored laboratory database/u)
})

test('runner only delegates the verified three-stage REST draft-restore laboratory', () => {
  assert.match(source, /lab-ai-radar-v06-draft-restore-roundtrip-v05\.mjs/u)
  assert.match(source, /EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V05-ONLY/u)
  assert.match(source, /restoreAsDraftRequests -ne 2/u)
  assert.match(source, /partialPublishedPatchRequests -ne 1/u)
  assert.match(source, /genericRestoreWithoutDraftRequests -ne 0/u)
  assert.match(source, /wholeDocumentDraftPatchRequests -ne 0/u)
  assert.match(source, /restRestoreDraftQueryExplicit -ne \$true/u)
  assert.doesNotMatch(source, /\bdropdb\b/u)
  assert.doesNotMatch(source, /\bcreatedb\b/u)
  assert.doesNotMatch(source, /\bpg_restore\b/u)
})

test('runner creates a fresh proof only after inspect and keeps artifacts under data_local', () => {
  const inspectIndex = source.indexOf('$inspect = Invoke-LabInspect')
  const proofIndex = source.indexOf('$proofFile = New-DatabaseProof')
  assert.ok(inspectIndex >= 0)
  assert.ok(proofIndex > inspectIndex)
  assert.match(source, /v06-draft-restore-roundtrip-lab-proof-v06/u)
  assert.match(source, /candidateManifestSha256/u)
  assert.match(source, /sourceDumpSha256/u)
})
