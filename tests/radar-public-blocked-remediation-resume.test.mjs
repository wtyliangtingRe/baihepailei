import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const resumePath = path.join(root, 'scripts/radar/resume-and-package-radar-public-blocked-remediation-v01.ps1')
const v03Path = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v03.ps1')
const resume = fs.readFileSync(resumePath, 'utf8')
const v03 = fs.readFileSync(v03Path, 'utf8')

test('resume runner passes the real PowerShell parser', () => {
  const escaped = resumePath.replaceAll("'", "''")
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('resume is locked to the accepted completed inventory and source branch', () => {
  assert.match(resume, /B6825AC48D27B6F8C319CC6E685AD0EA8AAC411D8C2C0ABAF52946D8C23F9121/u)
  assert.match(resume, /6d5c2e741e9ad7b345fc5ff9c8fd16875eaee9fa/u)
  assert.match(resume, /InventoryRows -ne 1805|inventoryRows -ne 1805/u)
  assert.match(resume, /currentPublicConclusionsRead -ne 9000/u)
  assert.match(resume, /readyForRemediationPlanning -ne \$true/u)
  assert.match(resume, /InventoryBundle SHA-256 不匹配/u)
})

test('resume validates source and final manifests and packages only after finalization', () => {
  assert.match(resume, /Test-Manifest \$outDir/u)
  assert.match(resume, /Test-Manifest \$tempRemediation/u)
  assert.match(resume, /Test-Manifest \$outDir/u)
  assert.match(resume, /finalize-radar-public-blocked-remediation-waves-v01\.mjs/u)
  assert.match(resume, /Compress-Archive/u)
  const finalExists = resume.indexOf("if (-not (Test-Path -LiteralPath $finalBundle")
  const removeInventory = resume.indexOf('Remove-Item -LiteralPath $inventoryBundlePath -Force')
  assert.ok(finalExists >= 0)
  assert.ok(removeInventory > finalExists)
})

test('resume performs no Payload, Next, Docker, or PostgreSQL operation', () => {
  assert.doesNotMatch(resume, /RADAR_PAYLOAD|RADAR_READONLY_AUDIT_TOKEN|next\s+(?:dev|start)|Start-Process|Invoke-WebRequest|fetch\(|docker|psql|pg_dump|DATABASE_URL|\/api\//iu)
  assert.match(resume, /PayloadRead\s+: False/u)
  assert.match(resume, /PostgreSQLRead\s+: False/u)
  assert.match(resume, /productionApplyAuthorized = \$false/u)
})

test('resume records source and finalizer heads without pretending the old inventory used the new head', () => {
  assert.match(resume, /sourceInventoryBranchHead = \$SourceInventoryBranchHead/u)
  assert.match(resume, /finalizerBranchHead = \$ExpectedCurrentBranchHead/u)
  assert.match(resume, /resumedAfterDirectorySetNullBug = \$true/u)
})

test('v03 preserves an empty HashSet object instead of enumerating it to null', () => {
  assert.match(v03, /return ,\$set/u)
  assert.doesNotMatch(v03, /return \$set\s*\n/u)
})
