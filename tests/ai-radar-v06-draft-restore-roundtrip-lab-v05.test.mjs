import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  restoreVersionAsDraft,
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
