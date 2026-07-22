import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

function jsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

test('legacy strong evidence is reassessed while weak and unseen rows fill research capacity', () => {
  const root = path.resolve('data_local/test-legacy-ledger-integration')
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })

  try {
    const catalogRows = [
      {
        workId: '1', siteId: 'work:1', title: 'Reusable',
        catalogQueue: { queue: 'external_research' },
        writeProtection: { protected: false, reasons: [] },
      },
      {
        workId: '2', siteId: 'work:2', title: 'Weak',
        catalogQueue: { queue: 'external_research' },
        writeProtection: { protected: false, reasons: [] },
      },
      {
        workId: '3', siteId: 'work:3', title: 'Unseen',
        catalogQueue: { queue: 'external_research' },
        writeProtection: { protected: false, reasons: [] },
      },
    ]
    const catalogText = jsonl(catalogRows)
    const catalogFile = path.join(root, 'catalog.jsonl')
    fs.writeFileSync(catalogFile, catalogText, 'utf8')
    const manifestFile = path.join(root, 'catalog-batch-manifest-v01.json')
    fs.writeFileSync(manifestFile, `${JSON.stringify({
      batches: [{
        batchId: 'CATALOG-TEST',
        queue: 'external_research',
        rowCount: catalogRows.length,
        file: path.relative(process.cwd(), catalogFile).replace(/\\/gu, '/'),
        sha256: sha256(catalogText),
      }],
    }, null, 2)}\n`, 'utf8')

    fs.writeFileSync(path.join(root, 'v0.6-resolutions.jsonl'), jsonl([
      {
        batchId: 'RADAR-ASSESS-0001',
        workId: '1', siteId: 'work:1', title: 'Reusable',
        grade: 'A', ruleCodes: ['A-NEAR-CONFIRMED'],
        evidenceCoverage: 0.72,
        evidenceStatus: 'single_secondary_supported',
        sourceSummary: 'Existing traceable assessment evidence.',
      },
      {
        batchId: 'RADAR-ASSESS-0001',
        workId: '2', siteId: 'work:2', title: 'Weak',
        grade: 'D', ruleCodes: ['D-UNCLEAR'],
        evidenceCoverage: 0.2,
        evidenceStatus: 'insufficient_evidence',
        sourceSummary: 'Too weak to reuse.',
      },
    ]), 'utf8')

    const ledgerFile = path.join(root, 'ledger.jsonl')
    execFileSync(process.execPath, [
      'scripts/radar/build-ai-radar-processing-ledger-v01.mjs',
      '--catalog-manifest', path.relative(process.cwd(), manifestFile),
      '--scan-root', path.relative(process.cwd(), root),
      '--out', path.relative(process.cwd(), ledgerFile),
    ], { stdio: 'pipe' })

    const ledgerRows = fs.readFileSync(ledgerFile, 'utf8').trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(ledgerRows.length, 1)
    assert.equal(ledgerRows[0].workId, '1')
    assert.equal(ledgerRows[0].aiQaStatus, 'legacy_assessed')
    assert.equal(ledgerRows[0].nextAction, 'reassess_legacy_assessment')
    assert.equal(ledgerRows[0].reusableEvidence.grade, 'A')

    const ledgerSummary = JSON.parse(fs.readFileSync(
      ledgerFile.replace(/\.jsonl$/u, '-summary.json'),
      'utf8',
    ))
    assert.equal(ledgerSummary.legacyRowsScanned, 2)
    assert.equal(ledgerSummary.legacyReusableRows, 1)
    assert.equal(ledgerSummary.legacyRejectedByReason.evidence_too_weak, 1)

    const selectionRoot = path.join(root, 'selection')
    execFileSync(process.execPath, [
      'scripts/radar/select-ai-radar-incremental-wave-v01.mjs',
      '--catalog-manifest', path.relative(process.cwd(), manifestFile),
      '--ledger', path.relative(process.cwd(), ledgerFile),
      '--out-dir', path.relative(process.cwd(), selectionRoot),
      '--target-rows', '2',
      '--retry-reserve', '0',
      '--policy-version', 'radar-rating-policy-v0.4-draft',
      '--calibration-profile-id', 'site-owner-primary-v0.1',
    ], { stdio: 'pipe' })

    const researchRows = fs.readFileSync(
      path.join(selectionRoot, 'incremental-research-selection-v01.jsonl'),
      'utf8',
    ).trim().split(/\r?\n/u).map(JSON.parse)
    assert.deepEqual(researchRows.map((row) => row.workId), ['2', '3'])

    const reassessmentRows = fs.readFileSync(
      path.join(selectionRoot, 'incremental-reassessment-selection-v01.jsonl'),
      'utf8',
    ).trim().split(/\r?\n/u).map(JSON.parse)
    assert.equal(reassessmentRows.length, 1)
    assert.equal(reassessmentRows[0].workId, '1')
    assert.equal(reassessmentRows[0].incrementalReuse.grade, 'A')
    assert.equal(reassessmentRows[0].incrementalSelection.action, 'reassess_policy_changed')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
