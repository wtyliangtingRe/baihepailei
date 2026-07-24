import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v07.ps1')
const v01Path = path.join(root, 'scripts/radar/run-and-package-radar-public-blocked-inventory-v01.ps1')
const helperPath = path.join(root, 'src/lib/radarReadOnlyAudit.ts')
const loginPath = path.join(root, 'src/app/(payload)/api/users/login/route.ts')
const worksPath = path.join(root, 'src/app/(payload)/api/works/route.ts')
const conclusionsPath = path.join(root, 'src/app/(payload)/api/radar-public-conclusions/route.ts')

const runner = fs.readFileSync(runnerPath, 'utf8')
const v01 = fs.readFileSync(v01Path, 'utf8')
const helper = fs.readFileSync(helperPath, 'utf8')
const login = fs.readFileSync(loginPath, 'utf8')
const works = fs.readFileSync(worksPath, 'utf8')
const conclusions = fs.readFileSync(conclusionsPath, 'utf8')

test('v07 passes the real PowerShell parser', () => {
  const escaped = runnerPath.replaceAll("'", "''")
  const command = [
    '$tokens = $null;',
    '$errors = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    'if (@($errors).Count -gt 0) { $errors | Format-List | Out-String | Write-Error; exit 1 }',
  ].join(' ')
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('v07 creates a cryptographic one-time token and asks for no credentials', () => {
  assert.match(runner, /RandomNumberGenerator\]::Fill\(\$tokenBytes\)/u)
  assert.match(runner, /ToHexString\(\$tokenBytes\)\.ToLowerInvariant\(\)/u)
  assert.match(runner, /radar-readonly-audit@localhost\.invalid/u)
  assert.doesNotMatch(runner, /Read-Host|ReadKey|管理员密码|管理员邮箱/u)
  assert.match(runner, /不再需要 Payload 邮箱或密码/u)
})

test('token is process-only, inherited by Next and builder, restored, and cleared', () => {
  for (const name of ['RADAR_READONLY_AUDIT_TOKEN', 'RADAR_PAYLOAD_EMAIL', 'RADAR_PAYLOAD_PASSWORD']) {
    assert.match(runner, new RegExp(`SetEnvironmentVariable\\('${name}'`))
  }
  assert.match(runner, /SetEnvironmentVariable\('RADAR_READONLY_AUDIT_TOKEN', \$previousToken, 'Process'\)/u)
  assert.match(runner, /\$auditToken = \$null/u)
  assert.match(runner, /\[Array\]::Clear\(\$tokenBytes/u)
  assert.doesNotMatch(runner, /Write-Host[^\n]+\$auditToken|ArgumentList[^\n]+\$auditToken/u)
})

test('local helper is GET-only, token-gated, paginated, and bypasses access without authentication writes', () => {
  assert.match(helper, /getPayload\(\{ config \}\)/u)
  assert.match(helper, /overrideAccess: true/u)
  assert.match(helper, /pagination: true/u)
  assert.match(helper, /limit[^\n]+200/u)
  assert.match(helper, /'works' \| 'radar-public-conclusions'/u)
  assert.match(helper, /authorization[^\n]+JWT/u)
  assert.doesNotMatch(helper, /payload\.(?:create|update|delete|login)|INSERT|UPDATE|DELETE FROM/iu)
})

test('specific routes preserve standard Payload behavior with exact fallback slugs', () => {
  assert.match(login, /REST_POST\(config\)/u)
  assert.match(login, /slug: \['users', 'login'\]/u)
  assert.match(works, /REST_GET\(config\)/u)
  assert.match(works, /slug: \['works'\]/u)
  assert.match(conclusions, /REST_GET\(config\)/u)
  assert.match(conclusions, /slug: \['radar-public-conclusions'\]/u)
  for (const route of [login, works, conclusions]) {
    assert.match(route, /params: Promise\.resolve/u)
  }
})

test('audit routes expose only the required read surface', () => {
  assert.match(works, /radarReadonlyFind\(request, 'works'\)/u)
  assert.match(conclusions, /radarReadonlyFind\(request, 'radar-public-conclusions'\)/u)
  assert.doesNotMatch(works + conclusions, /REST_(?:POST|PATCH|PUT|DELETE)|export (?:async function|const) (?:POST|PATCH|PUT|DELETE)/u)
  assert.match(login, /isRadarReadonlyLogin/u)
  assert.match(login, /radarReadonlyLoginResponse/u)
})

test('v07 invokes the reviewed v03 chain while PostgreSQL remains forcibly read-only', () => {
  assert.match(runner, /run-and-package-radar-public-blocked-inventory-v03\.ps1/u)
  assert.ok(runner.includes('& $innerRunner `'))
  assert.match(v01, /default_transaction_read_only=on/u)
  assert.match(v01, /PAYLOAD_DB_PUSH = 'false'/u)
  assert.doesNotMatch(runner, /AUTHORIZE-PRODUCTION|psql|pg_dump|docker exec|payload\s+migrate/iu)
})
