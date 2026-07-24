import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EXPECTED_ROWS,
  EXPECTED_SOURCE_COUNTS,
  PROPERTY_BY_SOURCE,
  reconstructSummary,
  riskResolutionFor,
  sourceResolutionFor,
} from '../scripts/radar/fetch-radar-remaining-wikidata-evidence-v01.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.join(root, '../scripts/radar/run-and-package-radar-remaining-source-expansion-v01.ps1')
const fetcherPath = path.join(root, '../scripts/radar/fetch-radar-remaining-wikidata-evidence-v01.mjs')

function wrapper({ grade = 'D', risks = ['male protagonist'], providerFamilies = ['vndb'], needsSource = true, needsSummary = false, needsRisk = true } = {}) {
  return {
    workId: '1',
    publicationKey: 'work:1',
    title: 'Example',
    closeoutTask: {
      needsSecondIndependentProvider: needsSource,
      independentProviderCountBeforeCloseout: providerFamilies.length,
      needsHumanReadableSourceSummary: needsSummary,
      needsRiskAdjudication: needsRisk,
    },
    sourceRow: {
      title: 'Example',
      candidate: {
        grade,
        decisiveRuleCode: grade === 'D' ? 'D-UNCLEAR' : 'A-NEAR-CONFIRMED',
      },
      sourceEvidence: {
        providerFamilies,
        riskSignals: risks,
        structuredTitle: 'Example',
        structuredSummary: 'A structured description.',
        tags: [{ name: 'Yuri' }, { name: 'Female Protagonist' }],
      },
    },
  }
}

test('locks the 1,122-row source composition and exact Wikidata properties', () => {
  assert.equal(EXPECTED_ROWS, 1122)
  assert.deepEqual(EXPECTED_SOURCE_COUNTS, { a: 56, b: 400, m: 65, v: 601 })
  assert.deepEqual(PROPERTY_BY_SOURCE, { a: 'P8729', b: 'P5732', v: 'P3180' })
})

test('an exact external-ID match adds Wikidata without title-only identity', () => {
  const result = sourceResolutionFor(wrapper(), {
    status: 'exact_id_match',
    entityEvidence: [{
      providerFamilies: ['wikidata', 'wikipedia'],
    }],
  })
  assert.equal(result.resolved, true)
  assert.equal(result.exactTitleMatchUsed, false)
  assert.deepEqual(result.providerFamiliesAfter, ['vndb', 'wikidata', 'wikipedia'])
})

test('ambiguous or title-only evidence never resolves the second provider automatically', () => {
  for (const status of ['not_found', 'ambiguous_exact_id_matches', 'title_search_candidates_only']) {
    const result = sourceResolutionFor(wrapper(), { status, entityEvidence: [] })
    assert.equal(result.resolved, false)
  }
})

test('risk signals may be closed without grade mutation only for existing D/E/F grades', () => {
  for (const grade of ['D', 'E', 'F']) {
    const result = riskResolutionFor(wrapper({ grade }))
    assert.equal(result.resolvedWithoutMutation, true)
    assert.equal(result.gradeChanged, false)
    assert.equal(result.ruleChanged, false)
  }
  for (const grade of ['S', 'A', 'B', 'C']) {
    const result = riskResolutionFor(wrapper({ grade }))
    assert.equal(result.resolvedWithoutMutation, false)
    assert.equal(result.gradeChanged, false)
    assert.equal(result.ruleChanged, false)
  }
})

test('missing source summaries are reconstructed without changing grade or rule', () => {
  const result = reconstructSummary(wrapper({ needsSummary: true }))
  assert.equal(result.reconstructed, true)
  assert.match(result.proposedSourceSummary, /A structured description/u)
  assert.match(result.proposedSourceSummary, /D\/D-UNCLEAR/u)
  assert.equal(result.gradeChanged, false)
  assert.equal(result.ruleChanged, false)
})

test('fetcher uses curl checkpoints and has no Payload or PostgreSQL operation', () => {
  const source = fs.readFileSync(fetcherPath, 'utf8')
  assert.match(source, /curlExecutable/u)
  assert.match(source, /exact-match-checkpoint\.json/u)
  assert.match(source, /entity-checkpoint\.json/u)
  assert.match(source, /mgv2-title-checkpoint\.json/u)
  assert.doesNotMatch(source, /DATABASE_URL|DATABASE_URI|\/api\/works|docker\s+exec|psql|pg_dump/iu)
})

test('runner is local, resumable, and packages evidence only after manifest validation', () => {
  const source = fs.readFileSync(runnerPath, 'utf8')
  assert.match(source, /RADAR-REMAINING-1122-UNIFIED-CLOSEOUT-INPUT-20260724\.zip/u)
  assert.match(source, /radar-remaining-1122-source-expansion-work-v01/u)
  assert.match(source, /Assert-Manifest/u)
  assert.match(source, /Compress-Archive/u)
  assert.doesNotMatch(source, /\/api\/works|docker\s+(?:exec|run)|psql\s|pg_dump|DATABASE_URL|DATABASE_URI/iu)
})
