#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-stage2-visibility-verify-v01-verified.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const DEFAULT_SEARCH_INDEX = 'public/search-index.json'
const DEFAULT_DETAIL_INDEX = 'public/detail-index.json'
const VERSION = 'work-merge-stage2-index-verify-v0.1'

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }
  return { rows, read, failed }
}

function readIndex(file) {
  const body = JSON.parse(fs.readFileSync(file, 'utf8'))
  const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : []
  return { body, items }
}

function typeOf(item) {
  return val(item.type || item.collection || item.kind || item.docType || 'works')
}

function idOf(item) {
  return val(item.id || item.docId || item.value || item.workId)
}

function slugOf(item) {
  return val(item.slug || item.path || item.urlSlug)
}

function titleOf(item) {
  return val(item.title || item.name || item.label)
}

function workItems(index) {
  return index.items.filter((item) => typeOf(item) === 'works' || typeOf(item) === 'work')
}

function countTypes(index) {
  const out = {}
  for (const item of index.items) {
    const type = typeOf(item) || 'unknown'
    out[type] = (out[type] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])))
}

function indexLookup(index) {
  const byId = new Map()
  const bySlug = new Map()
  const byTitle = new Map()
  for (const item of workItems(index)) {
    const id = idOf(item)
    const slug = slugOf(item)
    const title = titleOf(item).toLowerCase()
    if (id) byId.set(id, item)
    if (slug) bySlug.set(slug, item)
    if (title) {
      const arr = byTitle.get(title) || []
      arr.push(item)
      byTitle.set(title, arr)
    }
  }
  return { byId, bySlug, byTitle }
}

function hasWork(lookup, doc) {
  const id = val(doc?.id)
  const slug = val(doc?.slug)
  const title = val(doc?.title).toLowerCase()
  if (id && lookup.byId.has(id)) return true
  if (slug && lookup.bySlug.has(slug)) return true
  if (title && (lookup.byTitle.get(title) || []).length) return true
  return false
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, samples) {
  return [
    '# Work Merge Stage 2 Index Verify v0.1',
    '',
    'Read-only verification for stage 2 work merge search/detail indexes.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- verifiedGroups: ${summary.verifiedGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    `- searchIndexWorkItems: ${summary.searchIndex.workItems}`,
    `- detailIndexWorkItems: ${summary.detailIndex.workItems}`,
    '',
    '## Safety',
    '',
    '- Index read only.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '',
    '## Status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Blockers',
    '',
    '| Blocker | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBlocker).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const searchIndexFile = String(args['search-index'] || DEFAULT_SEARCH_INDEX)
  const detailIndexFile = String(args['detail-index'] || DEFAULT_DETAIL_INDEX)

  if (!fs.existsSync(inputPath)) throw new Error(`stage 2 verified group file not found: ${inputPath}`)
  if (!fs.existsSync(searchIndexFile)) throw new Error(`search index file not found: ${searchIndexFile}`)
  if (!fs.existsSync(detailIndexFile)) throw new Error(`detail index file not found: ${detailIndexFile}`)

  const input = await readJsonl(inputPath)
  const searchIndex = readIndex(searchIndexFile)
  const detailIndex = readIndex(detailIndexFile)
  const searchLookup = indexLookup(searchIndex)
  const detailLookup = indexLookup(detailIndex)
  const rows = []

  for (const group of input.rows) {
    const blockers = []
    const master = group.master
    const supplement = group.supplement
    const masterInSearch = hasWork(searchLookup, master)
    const masterInDetail = hasWork(detailLookup, master)
    const supplementInSearch = hasWork(searchLookup, supplement)
    const supplementInDetail = hasWork(detailLookup, supplement)

    if (!master) blockers.push('master_missing_from_input')
    if (!supplement) blockers.push('supplement_missing_from_input')
    if (!masterInSearch) blockers.push('search_index_missing_master')
    if (!masterInDetail) blockers.push('detail_index_missing_master')
    if (supplementInSearch) blockers.push('search_index_contains_hidden_supplement')
    if (supplementInDetail) blockers.push('detail_index_contains_hidden_supplement')

    const status = blockers.length ? 'blocked' : 'verified'
    rows.push({
      mergeGroupId: val(group.mergeGroupId),
      status,
      blockers: [...new Set(blockers)],
      master: {
        id: val(master?.id),
        title: val(master?.title),
        slug: val(master?.slug),
        inSearchIndex: masterInSearch,
        inDetailIndex: masterInDetail,
      },
      supplement: {
        id: val(supplement?.id),
        title: val(supplement?.title),
        slug: val(supplement?.slug),
        inSearchIndex: supplementInSearch,
        inDetailIndex: supplementInDetail,
      },
      safety: {
        readOnly: true,
        payloadRead: false,
        payloadWrite: false,
        directPostgresqlWrite: false,
        indexReadOnly: true,
        dataChanged: false,
      },
    })
  }

  const verified = rows.filter((row) => row.status === 'verified')
  const blocked = rows.filter((row) => row.status === 'blocked')
  const blockers = rows.flatMap((row) => row.blockers || [])

  const outputs = {
    rows: path.join(outDir, 'work-merge-stage2-index-verify-v01.rows.jsonl'),
    verified: path.join(outDir, 'work-merge-stage2-index-verify-v01-verified.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-stage2-index-verify-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-stage2-index-verify-v01-summary.json'),
    json: path.join(outDir, 'work-merge-stage2-index-verify-v01.json'),
    md: path.join(outDir, 'work-merge-stage2-index-verify-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    verifiedGroups: verified.length,
    blockedGroups: blocked.length,
    searchIndex: {
      file: searchIndexFile,
      total: searchIndex.items.length,
      counts: countTypes(searchIndex),
      workItems: workItems(searchIndex).length,
    },
    detailIndex: {
      file: detailIndexFile,
      total: detailIndex.items.length,
      counts: countTypes(detailIndex),
      workItems: workItems(detailIndex).length,
    },
    byStatus: countBy(rows, 'status'),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      indexReadOnly: true,
      dataChanged: false,
    },
  }

  const samples = { verified: verified.slice(0, 30), blocked: blocked.slice(0, 30) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.rows, rows.map((item) => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.verified, verified.map((item) => JSON.stringify(item)).join('\n') + (verified.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((item) => JSON.stringify(item)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
