#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_INPUT = 'data_local/staging/wikidata-adult-marked/wikidata-adult-marked-v01-ready.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/wikidata-adult-marked'
const BASE_SCRIPT = 'scripts/import/apply-wikidata-adult-marked-v01.mjs'

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  const passthrough = [...argv]
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
  return { args, passthrough }
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function rowQid(row) {
  return val(row?.qid || row?.wikidataQid || row?.key).match(/^Q\d+$/iu)?.[0]?.toUpperCase() || ''
}

function rowWorkId(row) {
  return val(row?.work?.id || row?.workId || row?.matchedWork?.id || row?.rewriteCandidatePreview?.existingWorkId)
}

function dedupeKey(row) {
  const workId = rowWorkId(row)
  const qid = rowQid(row)
  if (workId || qid) return `${workId || 'no-work'}|${qid || 'no-qid'}`
  return val(row?.key) || JSON.stringify(row).slice(0, 500)
}

function betterRow(current, next) {
  if (!current) return next
  const currentReady = current.planStatus === 'ready_for_apply_review'
  const nextReady = next.planStatus === 'ready_for_apply_review'
  if (nextReady && !currentReady) return next
  return current
}

function dedupeRows(rows) {
  const byKey = new Map()
  const order = []
  for (const row of rows) {
    const key = dedupeKey(row)
    if (!byKey.has(key)) order.push(key)
    byKey.set(key, betterRow(byKey.get(key), row))
  }
  return order.map((key) => byKey.get(key)).filter(Boolean)
}

function replaceArg(argv, key, value) {
  const out = []
  let replaced = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${key}`) {
      out.push(argv[i], value)
      replaced = true
      i += 1
    } else out.push(argv[i])
  }
  if (!replaced) out.push(`--${key}`, value)
  return out
}

function main() {
  const { args, passthrough } = parseArgs(process.argv.slice(2))
  const input = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const dedupedInput = path.join(outDir, 'wikidata-adult-marked-v01-ready-deduped.jsonl')
  fs.mkdirSync(outDir, { recursive: true })
  writeJsonl(dedupedInput, dedupeRows(readJsonl(input)))

  const nextArgs = replaceArg(passthrough, 'input', dedupedInput)
  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...nextArgs], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)
}

main()
