import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import worker, { FeedbackInbox, boundedJson, validateSubmission, networkPrefix } from './worker.mjs'

const valid = () => ({ kind: 'correction', title: '作品名', workId: '18556', description: '这里是有来源支持的作者和版本纠正信息。',
  sources: ['https://example.org/work/1'], location: '', spoilers: 'none', website: '', token: 'test-token', consent: true })
const req = (url, body, headers = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
function inbox() {
  const db = new DatabaseSync(':memory:')
  const storage = {
    sql: { exec(query, ...args) {
      const statement = db.prepare(query)
      if (/^\s*(?:SELECT|PRAGMA)/i.test(query)) { const rows = statement.all(...args); return { toArray: () => rows } }
      statement.run(...args); return { toArray: () => [] }
    } },
    transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error } },
    async setAlarm(at) { this.alarmAt = at },
  }
  return { object: new FeedbackInbox({ storage }, {}), db, storage }
}
test('only bounded text fields and HTTPS source URLs are accepted', () => {
  assert.equal(validateSubmission(valid()).item.workId, '18556')
  for (const override of [{ attachments: [] }, { description: '<img src=x onerror=alert(1)>' }, { sources: ['javascript:alert(1)'] },
    { sources: ['https://user:pass@example.org'] }, { sources: ['https://127.0.0.1/'] }, { sources: ['https://172.16.0.1/'] },
    { sources: Array(4).fill('https://example.org') }, { title: [] }, { workId: '12x' }, { website: 'spam' },
    { consent: false }, { description: 'x'.repeat(3001) }, { description: 'see https://example.org/hidden' }]) {
    assert.throws(() => validateSubmission({ ...valid(), ...override }))
  }
})
test('size is checked against streamed bytes, including a false Content-Length', async () => {
  await assert.rejects(() => boundedJson(req('https://test', { x: 'x'.repeat(17000) }, { 'Content-Length': '1' })), /too_large/)
  await assert.rejects(() => boundedJson(new Request('https://test', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'file' })), /content_type/)
})
test('IPv6 rotation within /64 and IPv4 within /24 share a network key', () => {
  assert.equal(networkPrefix('2001:db8:0:1::1'), networkPrefix('2001:0db8:0000:0001:abcd::2'))
  assert.equal(networkPrefix('192.0.2.1'), networkPrefix('192.0.2.200'))
})
test('daily cap remains exact with concurrent completions, deduplication and per-client limits', async () => {
  const { object } = inbox()
  const commit = i => object.fetch(req('https://inbox/commit', { item: valid(), hash: `hash-${i}`, ipKey: `ip-${i}`, clientKey: `client-${i}` }))
  const responses = await Promise.all(Array.from({ length: 120 }, (_, i) => commit(i)))
  assert.equal(responses.filter(r => r.status === 201).length, 100)
  assert.equal(responses.filter(r => r.status === 429).length, 20)
  assert.equal((await commit(1)).status, 409)
  const fresh = inbox().object
  for (let i = 0; i < 6; i++) {
    const response = await fresh.fetch(req('https://inbox/commit', { item: valid(), hash: `h-${i}`, ipKey: 'same-ip', clientKey: `c-${i}` }))
    assert.equal(response.status, i < 5 ? 201 : 429)
  }
})
test('attempt caps precede challenge verification and kill switch survives requests', async () => {
  const { object } = inbox()
  for (let i = 0; i < 6; i++) {
    const response = await object.fetch(req('https://inbox/reserve', { hash: `h-${i}`, ipKey: 'same', clientKey: `c-${i}`, prefixKey: 'p' }))
    assert.equal(response.status, i < 5 ? 200 : 429)
  }
  await object.fetch(req('https://feedback.example/api/admin/state', { disabled: true }))
  assert.equal((await object.fetch(req('https://inbox/reserve', { ipKey: 'new', clientKey: 'new', prefixKey: 'new', hash: 'new' }))).status, 503)
})
test('alarm deletes expired text and exports only bounded review records', async () => {
  const { object, db } = inbox()
  db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,?)').run('old', Date.now() - 31 * 86400000, 'old', 'ip', 'client', '{}')
  await object.alarm()
  const result = await object.fetch(new Request('https://feedback.example/api/admin/export'))
  assert.deepEqual((await result.json()).items, [])
})
test('public route rejects bad sessions, challenge hostname/action, and closed or unavailable dependencies', async () => {
  const { object } = inbox()
  const origin = 'https://feedback.example'
  const env = { PUBLIC_ORIGIN: origin, ACCEPT_SUBMISSIONS: 'true', SESSION_SECRET: 's'.repeat(40),
    TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret',
    EDGE_LIMITER: { async limit() { return { success: true } } }, INBOX: { idFromName: x => x, get: () => object } }
  const sessionResponse = await worker.fetch(new Request(`${origin}/api/session`, { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), env)
  const cookie = sessionResponse.headers.get('Set-Cookie').split(';')[0]
  assert.ok(cookie.startsWith('__Host-feedback-session='))
  const headers = { Origin: origin, Cookie: cookie, 'CF-Connecting-IP': '192.0.2.1' }
  assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), { ...headers, Cookie: 'forged' }), env)).status, 403)
  assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), { ...headers, Origin: 'https://evil.example' }), env)).status, 403)
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    let proof = { success: true, hostname: 'wrong.example', action: 'feedback' }
    globalThis.fetch = async url => { calls.push(url); return Response.json(proof) }
    assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), headers), env)).status, 403)
    proof = { success: true, hostname: 'feedback.example', action: 'login' }
    assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), headers), env)).status, 403)
    proof = { success: true, hostname: 'feedback.example', action: 'feedback' }
    assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), headers), env)).status, 201)
    assert.ok(calls.every(url => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'))
    assert.equal((await worker.fetch(req(`${origin}/api/submissions`, valid(), headers), { ...env, ACCEPT_SUBMISSIONS: 'false' })).status, 503)
    assert.equal((await worker.fetch(new Request(`${origin}/api/admin/export`), env)).status, 403)
  } finally { globalThis.fetch = originalFetch }
})
