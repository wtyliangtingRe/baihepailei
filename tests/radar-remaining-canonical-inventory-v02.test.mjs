import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { fetchCollectionSerial } from '../scripts/radar/build-radar-remaining-canonical-inventory-v02.mjs'

const root = process.cwd()
const builderPath = path.join(root, 'scripts/radar/build-radar-remaining-canonical-inventory-v02.mjs')
const runnerPath = path.join(root, 'scripts/radar/run-and-package-radar-remaining-canonical-inventory-v02.ps1')

const builder = fs.readFileSync(builderPath, 'utf8')
const runner = fs.readFileSync(runnerPath, 'utf8')

test('v02 builder parses and reaches required argument validation', () => {
  const syntax = spawnSync(process.execPath, ['--check', builderPath], { cwd: root, encoding: 'utf8' })
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout)
  const result = spawnSync(process.execPath, [builderPath], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Required: --out-dir/u)
})

test('v02 fetches complete collections serially with retries and saved snapshots', () => {
  assert.match(builder, /requestJsonWithRetry/u)
  assert.match(builder, /DEFAULT_REQUEST_ATTEMPTS = 5/u)
  assert.match(builder, /draftWorks = await fetchCollectionSerial/u)
  assert.match(builder, /publishedWorks = await fetchCollectionSerial/u)
  assert.match(builder, /publicConclusions = await fetchCollectionSerial/u)
  assert.match(builder, /Snapshot saved:/u)
  const draftIndex = builder.indexOf('draftWorks = await fetchCollectionSerial')
  const publishedIndex = builder.indexOf('publishedWorks = await fetchCollectionSerial')
  const publicIndex = builder.indexOf('publicConclusions = await fetchCollectionSerial')
  assert.ok(draftIndex < publishedIndex && publishedIndex < publicIndex)
})

test('v02 remains content-read-only', () => {
  assert.match(builder, /assertReadOnlyArgs/u)
  assert.match(builder, /PayloadContentWrite: False/u)
  assert.match(builder, /PostgreSQLWrite: False/u)
  assert.match(builder, /ProductionApplyPackageGenerated: False/u)
  assert.doesNotMatch(builder, /method:\s*['"](?:PATCH|PUT|DELETE)['"]/iu)
})

test('v02 runner switches only the builder and exposes preserved diagnostics', () => {
  assert.match(runner, /run-and-package-radar-remaining-canonical-inventory-v01\.ps1/u)
  assert.match(runner, /build-radar-remaining-canonical-inventory-v02\.mjs/u)
  assert.match(runner, /D:\\binv\\\*/u)
  assert.match(runner, /inventory-server-stderr\.log/u)
  assert.match(runner, /部分输出目录/u)
  assert.doesNotMatch(runner, /git reset --hard/u)
})

test('v02 retries a transient page failure and completes pagination', async (t) => {
  let pageOneAttempts = 0
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const page = Number(url.searchParams.get('page') || 1)
    if (page === 1) {
      pageOneAttempts += 1
      if (pageOneAttempts === 1) {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'transient' }))
        return
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ docs: [{ id: String(page) }], totalPages: 2 }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  const rows = await fetchCollectionSerial(
    `http://127.0.0.1:${address.port}`,
    'test-token',
    'works',
    { draft: 'true' },
    { attempts: 3, timeoutMs: 2_000 },
  )
  assert.deepEqual(rows.map((row) => row.id), ['1', '2'])
  assert.equal(pageOneAttempts, 2)
})
