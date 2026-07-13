import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const payloadConfig = readFileSync('payload.config.ts', 'utf8')
const wrapper = readFileSync('scripts/backup/create-local-database-checkpoint.ps1', 'utf8')

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
})
