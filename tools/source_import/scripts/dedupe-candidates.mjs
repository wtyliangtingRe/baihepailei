#!/usr/bin/env node

import path from 'node:path'

import { readJsonl, writeJsonl } from '../lib/jsonl.mjs'
import { normalizeText } from '../lib/slug.mjs'

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

function externalIdKeys(candidate) {
  return Object.entries(candidate.externalIds || {})
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `external:${key}:${String(value).trim().toLowerCase()}`)
}

function titleKey(candidate) {
  const title = normalizeText(candidate.originalTitle || candidate.title).toLowerCase()
  const mediaType = candidate.mediaType || 'unknown'
  return title ? `title:${mediaType}:${title}` : null
}

function candidateKeys(candidate) {
  return [
    candidate.siteId ? `site:${candidate.siteId}` : null,
    ...externalIdKeys(candidate),
    titleKey(candidate),
  ].filter(Boolean)
}

function mergeCandidate(base, next) {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined && value !== '')),
    aliases: [...(base.aliases || []), ...(next.aliases || [])],
    externalIds: { ...(base.externalIds || {}), ...(next.externalIds || {}) },
    candidateSources: [...(base.candidateSources || []), ...(next.candidateSources || [])],
  }
}

export function dedupeCandidates(candidates) {
  const deduped = []
  const conflicts = []
  const indexByKey = new Map()

  for (const candidate of candidates) {
    const keys = candidateKeys(candidate)
    const existingIndexes = [...new Set(keys.map((key) => indexByKey.get(key)).filter((value) => value !== undefined))]

    if (existingIndexes.length === 0) {
      const index = deduped.length
      deduped.push(candidate)
      keys.forEach((key) => indexByKey.set(key, index))
      continue
    }

    if (existingIndexes.length > 1) {
      conflicts.push({ reason: 'candidate matched multiple existing records', candidate, existingIndexes })
      continue
    }

    const index = existingIndexes[0]
    deduped[index] = mergeCandidate(deduped[index], candidate)
    candidateKeys(deduped[index]).forEach((key) => indexByKey.set(key, index))
  }

  return { deduped, conflicts }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out')
  const conflictsOutput = args.get('conflicts') || path.join(path.dirname(output || '.'), 'conflicts.jsonl')

  if (!input || !output) {
    console.error('Usage: pnpm source:dedupe -- --in <candidate-works.jsonl> --out <works.deduped.jsonl> [--conflicts <conflicts.jsonl>]')
    process.exitCode = 1
    return
  }

  const candidates = await readJsonl(input)
  const result = dedupeCandidates(candidates)
  await writeJsonl(output, result.deduped)
  await writeJsonl(conflictsOutput, result.conflicts)

  console.log(`Deduped ${candidates.length} candidates -> ${result.deduped.length} records, ${result.conflicts.length} conflicts`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
