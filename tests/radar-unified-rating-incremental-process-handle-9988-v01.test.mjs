import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('../scripts/radar/rehearse-unified-rating-incremental-release-9988-v02.ps1', import.meta.url),
  'utf8',
)

test('temporary app returns one real Process handle', () => {
  assert.match(source, /\$script:process = \$null/)
  assert.match(source, /\$null = Invoke-RadarWithEnvironment -Variables/)
  assert.match(source, /\$process = Get-RadarActiveProcess \$null/)
  assert.match(source, /\$process -is \[System\.Diagnostics\.Process\]/)
  assert.match(source, /return \[pscustomobject\]@\{ Process = \$process; BaseUrl = \$baseUrl \}/)

  assert.doesNotMatch(
    source,
    /\$process = \$null\s+Invoke-RadarWithEnvironment -Variables/s,
  )
})

test('marker wait rejects invalid handles before HasExited', () => {
  const typeGate = source.indexOf("throw '临时 Payload 进程句柄无效。'")
  const hasExited = source.indexOf('$Process.HasExited')

  assert.ok(typeGate >= 0, 'missing Process type gate')
  assert.ok(hasExited > typeGate, 'HasExited must appear after the Process type gate')
})

test('failed-start cleanup remains conservative', () => {
  assert.match(source, /if \(\$app\) \{ Stop-RadarProcess \$app\.Process \}/)
  assert.match(source, /if \(\$tempCreated\) \{ & docker rm -f \$tempContainer/)
  assert.match(source, /if \(-not \$writersRestarted\)/)
  assert.match(source, /automaticRetryAllowed = \$false/)
  assert.match(source, /operatorMustInspectBeforeRetry = \$true/)
  assert.doesNotMatch(source, /Remove-Item[^\n]*(?:\.dump|freshBackup)/u)
})
