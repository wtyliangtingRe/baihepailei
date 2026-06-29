import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const evidenceEnricher = read('scripts/export/enrich-lite-evidence-details.mjs')

test('evidence enrichment errors include request context', () => {
  assert.match(evidenceEnricher, /error\.status = response\.status/)
  assert.match(evidenceEnricher, /error\.statusText = response\.statusText/)
  assert.match(evidenceEnricher, /error\.url = url/)
  assert.match(evidenceEnricher, /error\.payload = payload/)
  assert.match(evidenceEnricher, /function describeFetchError\(error\)/)
})

test('evidence enrichment skips failed evidence fetches by default', () => {
  assert.match(evidenceEnricher, /function warnEvidenceFetchFailure\(error, \{ strict \}\)/)
  assert.match(evidenceEnricher, /catch \(error\) \{[\s\S]*warnEvidenceFetchFailure\(error, \{ strict \}\)[\s\S]*if \(strict\) throw error[\s\S]*return docs/)
  assert.match(evidenceEnricher, /fetchEvidence\(baseUrl, includeDrafts, \{ strict: strictEvidence \}\)/)
})

test('strict evidence mode preserves fail-fast behavior', () => {
  assert.match(evidenceEnricher, /const strictEvidence = Boolean\(args\['strict-evidence'\]\)/)
  assert.match(evidenceEnricher, /if \(strict\) throw error/)
})
