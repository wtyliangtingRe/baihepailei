#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonl } from '../lib/jsonl.mjs'
import { createCandidateWork } from '../lib/source-record.mjs'
import { bangumiSubjectToCandidateInput, bangumiSubjectToRawSource } from '../sources/bangumi.mjs'

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

function normalizeRecord(record, fetchedAt) {
  const subject = record.raw && record.source === 'bangumi' ? record.raw : record
  const rawSource = record.raw && record.source === 'bangumi' ? record : bangumiSubjectToRawSource(subject, { fetchedAt })
  const candidateInput = bangumiSubjectToCandidateInput(subject)

  return createCandidateWork({
    ...candidateInput,
    candidateSources: candidateInput.candidateSources.map((source) => ({
      ...source,
      fetchedAt: rawSource.fetchedAt || null,
    })),
    sourceRecord: rawSource,
  })
}

export function normalizeBangumiSubjects(records, { fetchedAt } = {}) {
  return records.map((record) => normalizeRecord(record, fetchedAt)).filter((candidate) => candidate.title)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out')
  const fetchedAt = args.get('fetched-at') || new Date().toISOString()

  if (!input || !output) {
    console.error('Usage: pnpm source:normalize:bangumi -- --in <bangumi-subjects.jsonl> --out <candidate-works.jsonl>')
    process.exitCode = 1
    return
  }

  const records = await readJsonl(input)
  const candidates = normalizeBangumiSubjects(records, { fetchedAt })
  await writeJsonl(output, candidates)

  console.log(`Normalized ${candidates.length} Bangumi subject candidates -> ${output}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
