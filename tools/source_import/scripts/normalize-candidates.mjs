#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonl } from '../lib/jsonl.mjs'
import { sourceRecordToCandidateWork } from '../lib/source-record.mjs'

function parseArgs(argv) {
  const args = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue

    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true'
    args.set(key, value)

    if (value !== 'true') index += 1
  }

  return args
}

export function normalizeCandidateRecords(records) {
  return records.map((record) => sourceRecordToCandidateWork(record)).filter((candidate) => candidate.title)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out')

  if (!input || !output) {
    console.error('Usage: pnpm source:normalize -- --in <raw.jsonl> --out <candidate-works.jsonl>')
    process.exitCode = 1
    return
  }

  const records = await readJsonl(input)
  const candidates = normalizeCandidateRecords(records)
  await writeJsonl(output, candidates)

  console.log(`Normalized ${candidates.length} candidate works -> ${output}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
