#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'vndb-work-integration-input-v0.2'
const BASE_SCRIPT = 'scripts/import/plan-vndb-work-integration-v01.mjs'
const DEFAULT_INPUTS = [
  'data_local/raw/vndb',
  'data_local/staging/vndb/vndb.json',
  'data_local/staging/vndb/vndb.jsonl',
  'data_local/staging/vndb/vndb-vn.json',
  'data_local/staging/vndb/vndb-vn.jsonl',
  'data_local/staging/vndb/vns.json',
  'data_local/staging/vndb/vns.jsonl',
]
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-work-integration'
const NORMALIZED_INPUT = 'data_local/staging/vndb/vndb-normalized-from-inputs-v01.jsonl'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = { input: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = key === 'input' ? args.input : true
    else {
      if (key === 'input') args.input.push(next)
      else args[key] = next
      i += 1
    }
  }
  return args
}

function walkFiles(input) {
  if (!fs.existsSync(input)) return []
  const stat = fs.statSync(input)
  if (stat.isFile()) return [/\.jsonl?$/iu.test(input) ? input : []].flat()
  if (!stat.isDirectory()) return []
  const out = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else if (/\.jsonl?$/iu.test(entry.name)) out.push(full)
  }
  return out
}

function vndbIdOf(row) {
  const raw = val(row?.id || row?.vndbId || row?.vnid || row?.vn?.id)
  const hit = raw.match(/^v?\d+$/iu)?.[0]
  return hit ? `v${hit.replace(/^v/iu, '')}`.toLowerCase() : ''
}

function looksLikeVndbRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false
  if (vndbIdOf(row)) return true
  if (typeof row.title === 'string' && (Array.isArray(row.titles) || Array.isArray(row.aliases))) return true
  if (row.vn && vndbIdOf(row.vn)) return true
  return false
}

function unwrapRows(value, sourceFile) {
  const rows = []
  const push = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    const candidate = row.vn && vndbIdOf(row.vn) ? { ...row.vn, __wrapper: row } : row
    if (looksLikeVndbRow(candidate)) rows.push({ ...candidate, __inputFile: sourceFile })
  }

  if (Array.isArray(value)) {
    for (const item of value) rows.push(...unwrapRows(item, sourceFile))
    return rows
  }
  if (!value || typeof value !== 'object') return rows

  for (const key of ['results', 'items', 'docs', 'data', 'vns', 'records']) {
    if (Array.isArray(value[key])) {
      for (const item of value[key]) rows.push(...unwrapRows(item, sourceFile))
      return rows
    }
  }
  push(value)
  return rows
}

function readRowsFromFile(file) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8').trim() } catch { return [] }
  if (!raw) return []
  const rows = []
  if (/\.jsonl$/iu.test(file)) {
    for (const line of raw.split(/\r?\n/u).filter(Boolean)) {
      try { rows.push(...unwrapRows(JSON.parse(line), file)) } catch {}
    }
    return rows
  }
  try { return unwrapRows(JSON.parse(raw), file) } catch { return [] }
}

function uniqueRows(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    const key = vndbIdOf(row) || `${val(row.title).normalize('NFKC').toLowerCase()}|${val(row.alttitle).normalize('NFKC').toLowerCase()}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function stripInputArgs(argv) {
  const out = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--input') {
      i += 1
      continue
    }
    out.push(argv[i])
  }
  return out
}

function writePreSummary(outDir, summary) {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'vndb-work-integration-v01-input-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const inputs = args.input.length ? args.input : DEFAULT_INPUTS
  const files = inputs.flatMap(walkFiles)
  const rows = uniqueRows(files.flatMap(readRowsFromFile))
  writeJsonl(NORMALIZED_INPUT, rows)

  const preSummary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    inputs,
    filesScanned: files.length,
    rowsExtracted: rows.length,
    normalizedInput: NORMALIZED_INPUT,
    note: 'This wrapper expands raw VNDB directories/files into a normalized JSONL input, then calls the v0.1 planner.',
  }
  writePreSummary(outDir, preSummary)
  console.log(JSON.stringify({ ok: true, inputSummary: preSummary }, null, 2))

  const nextArgs = [...stripInputArgs(argv), '--input', NORMALIZED_INPUT]
  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...nextArgs], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)
}

main()
