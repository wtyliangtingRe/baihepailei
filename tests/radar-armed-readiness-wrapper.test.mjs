import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const source = readFileSync('scripts/radar/run-ai-radar-armed-readiness-v01.mjs', 'utf8')

test('armed readiness wrapper is read-only and fixes a separate output directory', () => {
  assert.match(source, /Armed readiness is read-only/u)
  assert.match(source, /payload-apply-armed-readiness-v01/u)
  assert.match(source, /--require-execution-ready/u)
  assert.doesNotMatch(source, /--execute['"]/u)
  assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/u)
})

test('armed readiness wrapper rejects custom output and execute confirmation', () => {
  assert.match(source, /if \(args\['out-dir'\]\)/u)
  assert.match(source, /args\['execute-confirmation'\]/u)
  assert.match(source, /candidate-bound readiness cannot be overwritten/u)
})

test('apply, local arm and armed-readiness entry scripts parse successfully', () => {
  const files = [
    'scripts/radar/apply-ai-radar-payload-patches-v01.mjs',
    'scripts/radar/arm-ai-radar-release-candidate-v01.mjs',
    'scripts/radar/run-ai-radar-armed-readiness-v01.mjs',
  ]

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${file}\n${result.stdout}\n${result.stderr}`)
  }
})
