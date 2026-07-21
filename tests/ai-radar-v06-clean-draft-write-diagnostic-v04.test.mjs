import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { collectDifferences } from '../scripts/radar/diagnose-ai-radar-v06-clean-draft-write-v04.mjs'

test('collects changed, missing, extra, and array length paths', () => {
  const differences = collectDifferences(
    {
      title: 'A',
      mediaType: 'unknown',
      missingLater: true,
      items: [{ value: 1 }],
    },
    {
      title: 'B',
      mediaType: 'manga',
      extraLater: true,
      items: [{ value: 1 }, { value: 2 }],
    },
  )

  const paths = differences.map((row) => row.path)
  assert.ok(paths.includes('$.title'))
  assert.ok(paths.includes('$.mediaType'))
  assert.ok(paths.includes('$.missingLater'))
  assert.ok(paths.includes('$.extraLater'))
  assert.ok(paths.includes('$.items.length'))
  assert.ok(paths.includes('$.items[1]'))
})

test('diagnostic source contains no Works mutation request', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/diagnose-ai-radar-v06-clean-draft-write-v04.mjs', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
  assert.doesNotMatch(source, /method:\s*['"]PUT['"]/u)
  assert.doesNotMatch(source, /\/versions\/[^`'"]+/u)
  assert.match(source, /payloadWriteRequests:\s*0/u)
  assert.match(source, /Write-like flags are rejected/u)
})
