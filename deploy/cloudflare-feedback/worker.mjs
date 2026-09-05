// This Worker has no AWS, core database, email, GitHub or AI credentials.
// It accepts small text-only leads into one bounded, isolated review inbox.
const encoder = new TextEncoder()
export const MAX_BODY_BYTES = 16_384
const DAY = 86_400_000
const COOKIE = '__Host-feedback-session'
const fail = (status, error) => json({ error }, status)
function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
  } })
}
async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
async function digest(secret, value) {
  const bytes = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function verified(secret, value, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return false
  return crypto.subtle.verify('HMAC', await key(secret),
    new Uint8Array(signature.match(/../g).map(part => parseInt(part, 16))), encoder.encode(value))
}
async function session(request, env) {
  const token = (request.headers.get('Cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!token) return null
  const [id, expiry, signature] = token.split('.')
  if (!/^[a-f0-9-]{36}$/.test(id || '') || !/^\d{13}$/.test(expiry || '') ||
      Number(expiry) <= Date.now() || Number(expiry) > Date.now() + DAY + 60_000) return null
  return await verified(env.SESSION_SECRET, `${id}.${expiry}`, signature) ? id : null
}

export async function boundedJson(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('content_type')
  }
  const declared = request.headers.get('Content-Length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error('too_large')
  if (!request.body) throw new Error('invalid_json')
  const reader = request.body.getReader()
  let size = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('too_large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export function validateSubmission(value) {
  const allowed = ['kind', 'workId', 'title', 'description', 'sources', 'location', 'spoilers', 'website', 'token', 'consent']
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('fields')
  function field(name, min, max) {
    const text = value[name]
    if (typeof text !== 'string' || text.length > max || text.trim().length < min ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || /<[^>]*>/.test(text)) throw new Error(name)
    return text.trim()
  }
  const kind = field('kind', 1, 16)
  const workId = field('workId', 0, 12)
  const title = field('title', 1, 200)
  const description = field('description', 10, 3000)
  const location = field('location', 0, 240)
  const spoilers = field('spoilers', 1, 16)
  if (!['correction', 'new_work'].includes(kind) || (workId && !/^\d+$/.test(workId)) ||
      !['none', 'minor', 'major'].includes(spoilers) || value.consent !== true || field('website', 0, 80)) throw new Error('fields')
  if ([title, description, location].some(s => /https?:\/\/|www\.|data:|javascript:/i.test(s))) throw new Error('use_sources_field')
  if (!Array.isArray(value.sources) || value.sources.length > 3) throw new Error('sources')
  const sources = value.sources.map(source => {
    if (typeof source !== 'string' || source.length > 500 || /\s/.test(source)) throw new Error('sources')
    const url = new URL(source)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
        /^(?:localhost|.*\.local|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(url.hostname) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)) throw new Error('sources')
    return url.toString()
  })
  const token = field('token', 1, 2048)
  return { item: { kind, workId, title, description, sources: [...new Set(sources)], location, spoilers }, token }
}

export function networkPrefix(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').slice(0, 3).join('.') + '.0/24'
  if (!/^[a-f0-9:]+$/i.test(ip) || !ip.includes(':')) throw new Error('ip')
  const [left, right = ''] = ip.toLowerCase().split('::')
  const a = left ? left.split(':') : [], b = right ? right.split(':') : []
  const all = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a
  if (all.length !== 8 || all.some(v => !/^[a-f0-9]{1,4}$/.test(v))) throw new Error('ip')
  return all.slice(0, 4).map(v => parseInt(v, 16).toString(16)).join(':') + '::/64'
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.origin !== env.PUBLIC_ORIGIN || url.protocol !== 'https:') return fail(403, 'origin')
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    const isAdmin = url.pathname.startsWith('/api/admin/')
    try {
      if (isAdmin) {
        if (!env.REVIEW_TOKEN || env.REVIEW_TOKEN.length < 32 ||
            request.headers.get('Authorization') !== `Bearer ${env.REVIEW_TOKEN}`) return fail(403, 'forbidden')
        if (!['GET', 'POST'].includes(request.method)) return fail(405, 'method')
        // Admin calls are passed only after authentication; there is no public inbox listing.
        return env.INBOX.get(env.INBOX.idFromName('inbox-v1')).fetch(request)
      }
      if (env.ACCEPT_SUBMISSIONS !== 'true') return fail(503, 'closed')
      if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY || env.SESSION_SECRET?.length < 32 ||
          !env.SESSION_SECRET || !env.EDGE_LIMITER || !env.INBOX) return fail(503, 'unconfigured')
      if (!['/api/session', '/api/submissions'].includes(url.pathname)) return fail(404, 'not_found')
      if ((url.pathname === '/api/session' && request.method !== 'GET') ||
          (url.pathname === '/api/submissions' && request.method !== 'POST')) return fail(405, 'method')
      const ip = request.headers.get('CF-Connecting-IP')
      if (!ip) return fail(403, 'ip')
      const day = new Date().toISOString().slice(0, 10)
      const ipKey = await digest(env.SESSION_SECRET, `${day}:ip:${ip}`)
      const prefixKey = await digest(env.SESSION_SECRET, `${day}:prefix:${networkPrefix(ip)}`)
      if (!(await env.EDGE_LIMITER.limit({ key: ipKey })).success) return fail(429, 'rate_limited')
      if (url.pathname === '/api/session') {
        const id = (await session(request, env)) || crypto.randomUUID()
        const value = `${id}.${Date.now() + DAY}`
        const token = `${value}.${await digest(env.SESSION_SECRET, value)}`
        return json({ siteKey: env.TURNSTILE_SITE_KEY }, 200, {
          'Set-Cookie': `${COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        })
      }
      if (request.headers.get('Origin') !== env.PUBLIC_ORIGIN) return fail(403, 'origin')
      const id = await session(request, env)
      if (!id) return fail(403, 'session')
      const { item, token } = validateSubmission(await boundedJson(request))
      const clientKey = await digest(env.SESSION_SECRET, `${day}:session:${id}`)
      const hash = await digest(env.SESSION_SECRET, JSON.stringify(item))
      const inbox = env.INBOX.get(env.INBOX.idFromName('inbox-v1'))
      const internal = (path, body) => inbox.fetch(new Request(`https://inbox${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }))
      const gate = await internal('/reserve', { ipKey, prefixKey, clientKey, hash })
      if (!gate.ok) return gate
      // The only outbound request is a fixed Turnstile endpoint, after cheap validation and quotas.
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) return fail(503, 'verification_unavailable')
      const proof = await response.json()
      if (proof.success !== true || proof.hostname !== url.hostname || proof.action !== 'feedback') return fail(403, 'challenge')
      return internal('/commit', { item, ipKey, prefixKey, clientKey, hash })
    } catch (error) {
      const message = String(error?.message)
      if (message === 'too_large') return fail(413, 'too_large')
      if (message === 'content_type') return fail(415, 'text_only')
      if (error instanceof SyntaxError || ['fields', 'title', 'description', 'sources', 'token', 'location', 'kind', 'workId', 'spoilers', 'website', 'use_sources_field'].includes(message)) return fail(400, 'invalid_fields')
      // No body, URL, token or personal data is logged. Dependency failures never route to AWS.
      return fail(503, 'temporarily_unavailable')
    }
  },
}

export class FeedbackInbox {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, created INTEGER NOT NULL, hash TEXT UNIQUE NOT NULL, ip TEXT NOT NULL, client TEXT NOT NULL, body TEXT NOT NULL)`)
    this.sql.exec('CREATE INDEX IF NOT EXISTS submissions_created ON submissions(created)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL, expires INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  }
  one(query, ...args) { return this.sql.exec(query, ...args).toArray()[0] }
  count(key) { return this.one('SELECT value FROM counters WHERE key = ?', key)?.value || 0 }
  increment(key, expires) {
    this.sql.exec('INSERT INTO counters (key,value,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET value = value + 1', key, expires)
  }
  cleanup(now) {
    this.sql.exec('DELETE FROM submissions WHERE created < ?', now - 30 * DAY)
    this.sql.exec('DELETE FROM counters WHERE expires < ?', now)
  }
  async alarm() {
    this.cleanup(Date.now())
    if (this.one('SELECT COUNT(*) AS n FROM submissions').n) await this.ctx.storage.setAlarm(Date.now() + DAY)
  }
  async fetch(request) {
    const path = new URL(request.url).pathname
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10)
    this.cleanup(now)
    if (path === '/api/admin/export' && request.method === 'GET') {
      const after = new URL(request.url).searchParams.get('after') || ''
      const rows = this.sql.exec('SELECT id,created,body FROM submissions WHERE id > ? ORDER BY id LIMIT 50', after).toArray()
      return json({ items: rows.map(row => ({ id: row.id, createdAt: new Date(row.created).toISOString(), ...JSON.parse(row.body) })), next: rows.length === 50 ? rows.at(-1).id : null })
    }
    if (path === '/api/admin/state' && request.method === 'POST') {
      const input = await boundedJson(request)
      if (typeof input.disabled !== 'boolean') return fail(400, 'fields')
      this.sql.exec("INSERT INTO settings (key,value) VALUES ('disabled',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(input.disabled))
      return json({ disabled: input.disabled })
    }
    if (!['/reserve', '/commit'].includes(path) || request.method !== 'POST') return fail(404, 'not_found')
    const input = await request.json()
    const result = this.ctx.storage.transactionSync(() => {
      if (this.one("SELECT value FROM settings WHERE key='disabled'")?.value === 'true') return fail(503, 'closed')
      if (this.one('SELECT id FROM submissions WHERE hash = ?', input.hash)) return fail(409, 'duplicate')
      // Synchronous SQLite transaction: concurrent completions cannot exceed the daily hard limit.
      if (this.count(`${day}:accepted`) >= 100 || this.one('SELECT COUNT(*) AS n FROM submissions').n >= 3000) return fail(429, 'daily_capacity')
      if (path === '/reserve') {
        const hour = Math.floor(now / 3_600_000)
        const caps = [[`${day}:attempts`, 500], [`${hour}:ip:${input.ipKey}`, 5], [`${hour}:prefix:${input.prefixKey}`, 20], [`${hour}:client:${input.clientKey}`, 5]]
        if (caps.some(([key, cap]) => this.count(key) >= cap)) return fail(429, 'rate_limited')
        for (const [key] of caps) this.increment(key, now + 2 * DAY)
        return json({ allowed: true })
      }
      if (this.count(`${day}:ip:${input.ipKey}`) >= 5 || this.count(`${day}:client:${input.clientKey}`) >= 5) return fail(429, 'rate_limited')
      const id = crypto.randomUUID()
      this.sql.exec('INSERT INTO submissions (id,created,hash,ip,client,body) VALUES (?,?,?,?,?,?)', id, now, input.hash, input.ipKey, input.clientKey, JSON.stringify(input.item))
      for (const key of [`${day}:accepted`, `${day}:ip:${input.ipKey}`, `${day}:client:${input.clientKey}`]) this.increment(key, now + 2 * DAY)
      return json({ id, status: 'pending_review' }, 201)
    })
    if (result.status === 201) await this.ctx.storage.setAlarm(now + DAY)
    return result
  }
}
