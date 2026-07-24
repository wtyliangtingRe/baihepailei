#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const root = process.cwd()
const dataDir = path.join(root, 'data/radar-blocked-research')
const input = path.join(dataDir, 'source-ids.json.gz.b64')
const out = path.join(root, 'exports/radar-blocked-vndb-evidence')
const apiURL = 'https://api.vndb.org/kana/vn'
const ua = 'Baihepailei-Radar-Research/1.0 (+private evidence audit)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function readRows() {
  const raw = zlib.gunzipSync(Buffer.from(fs.readFileSync(input, 'utf8').replace(/\s+/gu, ''), 'base64'))
  const rows = JSON.parse(raw.toString('utf8')).map(([source, id], index) => ({ rowIndex: index + 1, source, id: String(id) }))
  const vndb = rows.filter((row) => row.source === 'v')
  if (rows.length !== 1805 || vndb.length !== 601) throw new Error(`Input cardinality mismatch: ${rows.length}/${vndb.length}`)
  return vndb
}

async function request(body, retries = 5) {
  let last
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(apiURL, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': ua },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const text = await response.text()
      if (response.ok) return JSON.parse(text)
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 800)}`)
      error.status = response.status
      throw error
    } catch (error) {
      last = error
      if (attempt === retries || (error.status && error.status !== 429 && error.status < 500)) break
      await sleep(Math.min(30_000, 1500 * (2 ** attempt)))
    }
  }
  throw last
}

function normalizeURL(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch { return '' }
}
function provider(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./u, '') } catch { return '' }
}
function compact(value, max = 12000) {
  return String(value || '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
}
function writeJSON(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function writeJSONL(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8') }

async function main() {
  const rows = readRows()
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const records = []
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100)
    const filters = ['or', ...batch.map((row) => ['id', '=', row.id])]
    const payload = await request({
      filters,
      fields: 'title,alttitle,aliases,description,tags{id,name,rating,spoiler},extlinks{url,label},developers{id,name,original},relations{id,relation,relation_official,title}',
      results: 100,
      sort: 'id',
    })
    const returned = new Map((payload.results || []).map((item) => [item.id, item]))
    for (const row of batch) {
      const item = returned.get(row.id)
      if (!item) {
        records.push({ schemaVersion: 1, rowIndex: row.rowIndex, sourceCode: 'v', sourceId: row.id, status: 'not_found', canonicalURL: `https://vndb.org/${row.id}`, apiURL, traceableURLs: [`https://vndb.org/${row.id}`, apiURL], providerHosts: ['api.vndb.org', 'vndb.org'], distinctProviderCount: 2, fetchedAt: new Date().toISOString() })
        continue
      }
      const externalURLs = (item.extlinks || []).map((link) => normalizeURL(link?.url)).filter(Boolean)
      const traceableURLs = [...new Set([`https://vndb.org/${row.id}`, apiURL, ...externalURLs])]
      records.push({
        schemaVersion: 1,
        rowIndex: row.rowIndex,
        sourceCode: 'v',
        sourceId: row.id,
        status: 'ok',
        canonicalURL: `https://vndb.org/${row.id}`,
        apiURL,
        fetchedAt: new Date().toISOString(),
        title: item.title || '',
        alternateTitle: item.alttitle || '',
        aliases: item.aliases || [],
        summary: compact(item.description),
        tags: item.tags || [],
        developers: item.developers || [],
        relations: item.relations || [],
        externalLinks: item.extlinks || [],
        externalURLs,
        traceableURLs,
        providerHosts: [...new Set(traceableURLs.map(provider).filter(Boolean))].sort(),
        distinctProviderCount: [...new Set(traceableURLs.map(provider).filter(Boolean))].length,
      })
    }
    console.log(`VNDB ${Math.min(offset + batch.length, rows.length)}/${rows.length}`)
    await sleep(1200)
  }
  records.sort((a, b) => a.rowIndex - b.rowIndex)
  if (records.length !== 601 || new Set(records.map((row) => row.rowIndex)).size !== 601) throw new Error('VNDB evidence cardinality mismatch')
  writeJSONL(path.join(out, 'radar-blocked-vndb-evidence.jsonl'), records)
  writeJSONL(path.join(out, 'radar-blocked-vndb-evidence-errors.jsonl'), records.filter((row) => row.status !== 'ok'))
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rows: records.length,
    byStatus: Object.fromEntries([...new Set(records.map((row) => row.status))].sort().map((status) => [status, records.filter((row) => row.status === status).length])),
    withExternalProvider: records.filter((row) => (row.externalURLs || []).length > 0).length,
    safety: { payloadRead: false, payloadWrite: false, postgresqlRead: false, postgresqlWrite: false, productionApplyAuthorized: false },
  }
  writeJSON(path.join(out, 'vndb-fetch-summary.json'), summary)
  const manifest = fs.readdirSync(out).filter((name) => name !== 'manifest.json').sort().map((name) => {
    const bytes = fs.readFileSync(path.join(out, name))
    return { file: name, bytes: bytes.length, sha256: sha256(bytes) }
  })
  writeJSON(path.join(out, 'manifest.json'), manifest)
  console.log(summary)
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
