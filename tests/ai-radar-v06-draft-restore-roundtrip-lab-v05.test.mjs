import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  restoreVersionAsDraft,
  validateProof,
  writeRequestBreakdown,
} from '../scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs'

function makeResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return JSON.stringify(body)
    },
  }
}

test('restoreVersionAsDraft uses REST POST with explicit draft=true', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return makeResponse({ id: '3839', _status: 'draft' })
  }

  try {
    await restoreVersionAsDraft('http://127.0.0.1:3100', 'token', '8744')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 1)
  assert.equal(
    calls[0].url,
    'http://127.0.0.1:3100/api/works/versions/8744?draft=true&depth=0',
  )
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.body, '{}')
})

test('v0.5 never uses generic restore without draft query or whole-document draft PATCH', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /versions\/\$\{encodeURIComponent\(versionId\)\}\?draft=true&depth=0/u)
  assert.doesNotMatch(source, /versions\/\$\{encodeURIComponent\(versionId\)\}\?depth=0/u)
  assert.doesNotMatch(source, /api\/works\/\$\{encodeURIComponent\(targetId\)\}\?draft=true/u)
  assert.match(source, /genericRestoreWithoutDraftRequests:\s*0/u)
  assert.match(source, /wholeDocumentDraftPatchRequests:\s*0/u)
  assert.match(source, /localApiRestoreUsed:\s*false/u)
})

test('v0.5 uses a new exact confirmation string', () => {
  const source = fs.readFileSync(
    new URL('../scripts/radar/lab-ai-radar-v06-draft-restore-roundtrip-v05.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /EXECUTE-V06-DRAFT-RESTORE-ROUNDTRIP-LAB-V05-ONLY/u)
  assert.doesNotMatch(source, /EXECUTE-V06-VERSION-ROUNDTRIP-LAB-V02-ONLY/u)
  assert.doesNotMatch(source, /EXECUTE-V06-SYNTHESIZED-DRAFT-ROUNDTRIP-LAB-V03-ONLY/u)
})

test('failure summaries report exact write-stage counts', () => {
  assert.deepEqual(writeRequestBreakdown(0), {
    restoreAsDraftRequests: 0,
    partialPublishedPatchRequests: 0,
    genericRestoreWithoutDraftRequests: 0,
    wholeDocumentDraftPatchRequests: 0,
    localApiRestoreUsed: false,
    restRestoreDraftQueryExplicit: true,
  })

  assert.deepEqual(writeRequestBreakdown(1), {
    restoreAsDraftRequests: 1,
    partialPublishedPatchRequests: 0,
    genericRestoreWithoutDraftRequests: 0,
    wholeDocumentDraftPatchRequests: 0,
    localApiRestoreUsed: false,
    restRestoreDraftQueryExplicit: true,
  })

  assert.deepEqual(writeRequestBreakdown(2), {
    restoreAsDraftRequests: 1,
    partialPublishedPatchRequests: 1,
    genericRestoreWithoutDraftRequests: 0,
    wholeDocumentDraftPatchRequests: 0,
    localApiRestoreUsed: false,
    restRestoreDraftQueryExplicit: true,
  })

  assert.deepEqual(writeRequestBreakdown(3), {
    restoreAsDraftRequests: 2,
    partialPublishedPatchRequests: 1,
    genericRestoreWithoutDraftRequests: 0,
    wholeDocumentDraftPatchRequests: 0,
    localApiRestoreUsed: false,
    restRestoreDraftQueryExplicit: true,
  })
})

test('proof is bound to the candidate manifest and restored table count', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'radar-v05-proof-'),
  )
  const manifestFile = path.join(directory, 'candidate-manifest.json')

  try {
    fs.writeFileSync(
      manifestFile,
      '{"candidate":"proof-test"}\n',
      'utf8',
    )

    const manifestSha256 = createHash('sha256')
      .update(fs.readFileSync(manifestFile))
      .digest('hex')

    const candidate = {
      files: {
        checkpointDump: {
          sha256: 'checkpoint-test-hash',
        },
      },
    }

    const proof = {
      version: 'ai-radar-v06-lab-database-proof-v0.1',
      serverUrl: 'http://127.0.0.1:3100',
      databaseName: 'baihepailei_radar_lab_test',
      mainDatabase: 'baihepailei',
      mainDatabaseConnections: 0,
      labDatabaseConnections: 1,
      publicTableCount: 83,
      sourceDumpSha256: 'checkpoint-test-hash',
      candidateManifest: manifestFile,
      candidateManifestSha256: manifestSha256,
      generatedAt: new Date().toISOString(),
    }

    assert.deepEqual(
      validateProof(
        proof,
        candidate,
        'http://127.0.0.1:3100',
        'baihepailei_radar_lab_test',
        manifestFile,
      ),
      [],
    )

    assert.ok(
      validateProof(
        {
          ...proof,
          publicTableCount: 82,
          candidateManifestSha256: 'incorrect',
        },
        candidate,
        'http://127.0.0.1:3100',
        'baihepailei_radar_lab_test',
        manifestFile,
      ).includes('lab_proof_public_table_count_mismatch'),
    )

    assert.ok(
      validateProof(
        {
          ...proof,
          candidateManifestSha256: 'incorrect',
        },
        candidate,
        'http://127.0.0.1:3100',
        'baihepailei_radar_lab_test',
        manifestFile,
      ).includes('lab_proof_candidate_manifest_hash_mismatch'),
    )
  } finally {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})
