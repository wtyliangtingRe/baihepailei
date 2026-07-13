import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const payloadConfig = readFileSync('payload.config.ts', 'utf8')
const wrapper = readFileSync('scripts/backup/create-local-database-checkpoint.ps1', 'utf8')
const dockerShim = readFileSync('scripts/backup/pg_dump.ps1', 'utf8')
const dockerShimCommand = readFileSync('scripts/backup/pg_dump.cmd', 'utf8')

test('database checkpoint recognizes the canonical Payload DATABASE_URL', () => {
  assert.match(payloadConfig, /process\.env\['DATABASE_URL'\]/u)
  assert.match(wrapper, /'DATABASE_URL'/u)
  assert.match(wrapper, /'DATABASE_URI'/u)
  assert.match(wrapper, /\.env\.development\.local/u)
  assert.match(wrapper, /\.env\.local/u)
  assert.match(wrapper, /create-local-checkpoint\.ps1/u)
  assert.match(wrapper, /-IncludeDatabase/u)
})

test('database checkpoint wrapper does not print the connection value', () => {
  assert.doesNotMatch(wrapper, /Write-Host\s+\$databaseConnection/u)
  assert.doesNotMatch(wrapper, /Write-Output\s+\$databaseConnection/u)
  assert.doesNotMatch(wrapper, /ConvertTo-Json[\s\S]*databaseConnection/u)
  assert.doesNotMatch(dockerShim, /Write-Host\s+\$password/u)
  assert.doesNotMatch(dockerShim, /Write-Output\s+\$password/u)
})

test('database checkpoint can use the running project PostgreSQL container', () => {
  assert.match(wrapper, /baihepailei-postgres/u)
  assert.match(wrapper, /Test-RunningContainer/u)
  assert.match(wrapper, /BAIHEPAILEI_PG_DUMP_CONTAINER/u)
  assert.match(wrapper, /pg_dump\.ps1/u)
  assert.match(dockerShimCommand, /pg_dump\.ps1/u)
  assert.match(dockerShimCommand, /ExecutionPolicy Bypass/u)
  assert.match(dockerShim, /docker[\s\S]*exec/u)
  assert.match(dockerShim, /docker[\s\S]*cp/u)
  assert.match(dockerShim, /--format=custom/u)
  assert.match(dockerShim, /--no-owner/u)
  assert.match(dockerShim, /--no-privileges/u)
})

test('Docker pg_dump fallback writes to a temporary container path and cleans it', () => {
  assert.match(dockerShim, /\/tmp\/baihepailei-payload-/u)
  assert.match(dockerShim, /finally[\s\S]*rm -f/u)
  assert.match(dockerShim, /Docker pg_dump created an empty host dump file/u)
})
