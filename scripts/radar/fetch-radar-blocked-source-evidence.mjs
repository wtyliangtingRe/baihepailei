#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = process.cwd()
const INPUT = path.join(ROOT, 'data/radar-blocked-research/source-ids.json.gz.b64')
const OUT = path.join(ROOT, 'exports/radar-blocked-source-evidence')
const UA = 'Baihepailei-Radar-Research/1.0 (+private evidence audit)'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function readIds() {
  const b64 = fs.readFileSync(INPUT, 'utf8').replace(/\s+/gu, '')
  const json = zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')
  const rows = JSON.parse(json)
  if (!Array.isArray(rows) || rows.length !== 1805) throw new Error(`Expected 1805 IDs, received ${rows?.length}`)
  return rows.map(([source, id], index) => ({ index: index + 1, source, id: String(id) }))
}

async function requestJson(url, options = {}, retries = 5) {
  let last
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { accept: 'application/json', 'user-agent': UA, ...(options.headers || {}) },
        signal: AbortSignal.timeout(45_000),
      })
      const text = await response.text()
      if (response.ok) return text ? JSON.parse(text) : null
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`)
      error.status = response.status
      throw error
    } catch (error) {
      last = error
      const retryable = !error.status || error.status === 429 || error.status >= 500
      if (!retryable || attempt === retries) break
      await sleep(Math.min(20_000, 750 * (2 ** attempt)))
    }
  }
  throw last
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    url.hash = ''
    return url.toString()
  } catch { return '' }
}
function host(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./u, '') } catch { return '' }
}
function urlsFrom(value, out = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/[^\s<>"')\]]+/giu)) {
      const url = normalizeUrl(match[0].replace(/[.,;:!?]+$/u, ''))
      if (url) out.add(url)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) urlsFrom(item, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) urlsFrom(item, out)
  }
  return [...out]
}
function compactText(value, max = 12_000) {
  return String(value || '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max)
}
function recordBase(row, canonicalURL, apiURL) {
  return {
    schemaVersion: 1,
    rowIndex: row.index,
    sourceCode: row.source,
    sourceId: row.id,
    canonicalURL,
    apiURL,
    fetchedAt: new Date().toISOString(),
  }
}
function finalizeRecord(record) {
  const all = [...new Set([record.canonicalURL, record.apiURL, ...(record.externalURLs || [])].map(normalizeUrl).filter(Boolean))]
  const providers = [...new Set(all.map(host).filter(Boolean))].sort()
  return { ...record, traceableURLs: all, providerHosts: providers, distinctProviderCount: providers.length }
}

async function fetchBangumi(row) {
  const canonicalURL = `https://bgm.tv/subject/${row.id}`
  const apiURL = `https://api.bgm.tv/v0/subjects/${row.id}`
  try {
    const data = await requestJson(apiURL)
    return finalizeRecord({
      ...recordBase(row, canonicalURL, apiURL), status: 'ok',
      title: data?.name_cn || data?.name || '', originalTitle: data?.name || '',
      summary: compactText(data?.summary),
      tags: (data?.tags || []).slice(0, 80).map((tag) => ({ name: tag.name, count: Number(tag.count || 0) })),
      metaTags: data?.meta_tags || [],
      infobox: data?.infobox || [],
      externalURLs: urlsFrom(data?.infobox || []),
    })
  } catch (error) {
    return finalizeRecord({ ...recordBase(row, canonicalURL, apiURL), status: 'error', error: String(error?.message || error), externalURLs: [] })
  }
}

async function fetchAniListBatch(rows) {
  const fields = `id idMal siteUrl title { romaji english native } description(asHtml:false) genres tags { name rank isMediaSpoiler category } externalLinks { url site type language } relations { edges { relationType node { id siteUrl title { romaji english native } } } }`
  const aliases = rows.map((row) => `m${row.id}: Media(id:${Number(row.id)}) { ${fields} }`).join('\n')
  try {
    const payload = await requestJson('https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `query { ${aliases} }` }),
    })
    return rows.map((row) => {
      const data = payload?.data?.[`m${row.id}`]
      const canonicalURL = data?.siteUrl || `https://anilist.co/anime/${row.id}`
      const externalURLs = [
        ...(data?.externalLinks || []).map((item) => item?.url),
        ...(data?.relations?.edges || []).map((item) => item?.node?.siteUrl),
        data?.idMal ? `https://myanimelist.net/anime/${data.idMal}` : '',
      ].filter(Boolean)
      return finalizeRecord({
        ...recordBase(row, canonicalURL, 'https://graphql.anilist.co'), status: data ? 'ok' : 'not_found',
        title: data?.title?.english || data?.title?.romaji || data?.title?.native || '',
        titles: data?.title || {}, summary: compactText(data?.description), genres: data?.genres || [],
        tags: (data?.tags || []).map((tag) => ({ name: tag.name, rank: tag.rank, category: tag.category, spoiler: tag.isMediaSpoiler })),
        externalLinks: data?.externalLinks || [], relations: data?.relations?.edges || [], externalURLs,
      })
    })
  } catch (error) {
    return rows.map((row) => finalizeRecord({ ...recordBase(row, `https://anilist.co/anime/${row.id}`, 'https://graphql.anilist.co'), status: 'error', error: String(error?.message || error), externalURLs: [] }))
  }
}

async function fetchVndb(row) {
  const canonicalURL = `https://vndb.org/${row.id}`
  const apiURL = 'https://api.vndb.org/kana/vn'
  try {
    const body = {
      filters: ['id', '=', row.id],
      fields: 'id,title,alttitle,aliases,description,tags{id,name,rating,spoiler},extlinks{url,label},developers{id,name,original},relations{id,relation,title,official}',
      results: 1,
    }
    const payload = await requestJson(apiURL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = payload?.results?.[0]
    const externalURLs = (data?.extlinks || []).map((item) => item?.url).filter(Boolean)
    return finalizeRecord({
      ...recordBase(row, canonicalURL, apiURL), status: data ? 'ok' : 'not_found',
      title: data?.title || '', alternateTitle: data?.alttitle || '', aliases: data?.aliases || [],
      summary: compactText(data?.description), tags: data?.tags || [], developers: data?.developers || [],
      relations: data?.relations || [], externalLinks: data?.extlinks || [], externalURLs,
    })
  } catch (error) {
    return finalizeRecord({ ...recordBase(row, canonicalURL, apiURL), status: 'error', error: String(error?.message || error), externalURLs: [] })
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8') }

async function main() {
  const ids = readIds()
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  const bangumi = ids.filter((row) => row.source === 'b')
  const anilist = ids.filter((row) => row.source === 'a')
  const vndb = ids.filter((row) => row.source === 'v')
  const mgv2 = ids.filter((row) => row.source === 'm')
  console.log({ total: ids.length, bangumi: bangumi.length, anilist: anilist.length, vndb: vndb.length, mgv2: mgv2.length })

  const bangumiRecords = await mapLimit(bangumi, 2, async (row, index) => {
    const result = await fetchBangumi(row)
    if ((index + 1) % 50 === 0) console.log(`Bangumi ${index + 1}/${bangumi.length}`)
    await sleep(250)
    return result
  })
  const aniBatches = []
  for (let index = 0; index < anilist.length; index += 12) aniBatches.push(anilist.slice(index, index + 12))
  const anilistRecords = (await mapLimit(aniBatches, 1, async (batch, index) => {
    const result = await fetchAniListBatch(batch)
    console.log(`AniList ${Math.min((index + 1) * 12, anilist.length)}/${anilist.length}`)
    await sleep(800)
    return result
  })).flat()
  const vndbRecords = await mapLimit(vndb, 3, async (row, index) => {
    const result = await fetchVndb(row)
    if ((index + 1) % 50 === 0) console.log(`VNDB ${index + 1}/${vndb.length}`)
    await sleep(350)
    return result
  })
  const mgv2Records = mgv2.map((row) => finalizeRecord({
    ...recordBase(row, '', ''), status: 'manual_source_required',
    error: 'Synthetic MGV2 catalog identity has no public structured endpoint.', externalURLs: [],
  }))
  const all = [...bangumiRecords, ...anilistRecords, ...vndbRecords, ...mgv2Records].sort((a, b) => a.rowIndex - b.rowIndex)
  if (all.length !== 1805 || new Set(all.map((row) => row.rowIndex)).size !== 1805) throw new Error('Evidence cache cardinality mismatch')
  writeJsonl(path.join(OUT, 'radar-blocked-source-evidence.jsonl'), all)
  writeJsonl(path.join(OUT, 'radar-blocked-source-evidence-errors.jsonl'), all.filter((row) => row.status !== 'ok'))
  const byStatus = Object.fromEntries([...new Set(all.map((row) => row.status))].sort().map((status) => [status, all.filter((row) => row.status === status).length]))
  const summary = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), rows: all.length,
    sourceCounts: { bangumi: bangumi.length, anilist: anilist.length, vndb: vndb.length, mgv2: mgv2.length },
    byStatus, withTwoDistinctProviders: all.filter((row) => row.distinctProviderCount >= 2).length,
    withThreeDistinctProviders: all.filter((row) => row.distinctProviderCount >= 3).length,
    safety: { payloadRead: false, payloadWrite: false, postgresqlRead: false, postgresqlWrite: false, productionApplyAuthorized: false },
  }
  writeJson(path.join(OUT, 'research-fetch-summary.json'), summary)
  const manifest = fs.readdirSync(OUT).filter((name) => name !== 'manifest.json').sort().map((name) => {
    const file = path.join(OUT, name); const bytes = fs.readFileSync(file)
    return { file: name, bytes: bytes.length, sha256: sha256(bytes) }
  })
  writeJson(path.join(OUT, 'manifest.json'), manifest)
  console.log(summary)
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
