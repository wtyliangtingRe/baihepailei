#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'

import { readJsonl, writeJsonl } from '../lib/jsonl.mjs'
import { compareWorkCandidates } from '../lib/match-work.mjs'
import { createDedupeReport } from '../lib/dedupe-report.mjs'

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

function uniqueByJson(values) {
  const seen = new Set()
  const result = []

  for (const value of values || []) {
    const key = JSON.stringify(value)
    if (seen.has(key)) continue

    seen.add(key)
    result.push(value)
  }

  return result
}

function normalizeKeyPart(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase()
}

function candidateSourceKey(source) {
  return [
    normalizeKeyPart(source?.source || source?.label),
    normalizeKeyPart(source?.externalId),
    normalizeKeyPart(source?.url),
  ].join('|')
}

function mergeNotes(existingNote, nextNote) {
  const notes = String(existingNote || '')
    .split('；')
    .map((note) => note.trim())
    .filter(Boolean)

  for (const note of String(nextNote || '').split('；').map((value) => value.trim()).filter(Boolean)) {
    if (!notes.includes(note)) notes.push(note)
  }

  return notes.join('；')
}

export function uniqueCandidateSources(values) {
  const byKey = new Map()
  const passthrough = []

  for (const source of values || []) {
    if (!source) continue

    const key = candidateSourceKey(source)
    if (key === '||') {
      passthrough.push(source)
      continue
    }

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...source })
      continue
    }

    byKey.set(key, {
      ...existing,
      ...source,
      label: existing.label || source.label,
      source: existing.source || source.source,
      externalId: existing.externalId || source.externalId,
      url: existing.url || source.url,
      fetchedAt: existing.fetchedAt || source.fetchedAt || null,
      note: mergeNotes(existing.note, source.note),
    })
  }

  return [...byKey.values(), ...uniqueByJson(passthrough)]
}

function mergeScalar(baseValue, nextValue) {
  return nextValue !== null && nextValue !== undefined && nextValue !== '' ? nextValue : baseValue
}

export function mergeCandidate(base, next) {
  return {
    ...base,
    title: mergeScalar(base.title, next.title),
    originalTitle: mergeScalar(base.originalTitle, next.originalTitle),
    slug: mergeScalar(base.slug, next.slug),
    siteId: mergeScalar(base.siteId, next.siteId),
    mediaType: mergeScalar(base.mediaType, next.mediaType),
    format: mergeScalar(base.format, next.format),
    firstPublishedAt: mergeScalar(base.firstPublishedAt, next.firstPublishedAt),
    firstPublishedPrecision: mergeScalar(base.firstPublishedPrecision, next.firstPublishedPrecision),
    firstPublishedLabel: mergeScalar(base.firstPublishedLabel, next.firstPublishedLabel),
    yuriCandidateScore: Math.max(Number(base.yuriCandidateScore || 0), Number(next.yuriCandidateScore || 0)),
    aliases: uniqueByJson([...(base.aliases || []), ...(next.aliases || [])]),
    externalIds: { ...(base.externalIds || {}), ...(next.externalIds || {}) },
    candidateSources: uniqueCandidateSources([...(base.candidateSources || []), ...(next.candidateSources || [])]),
    externalCoverImages: uniqueByJson([...(base.externalCoverImages || []), ...(next.externalCoverImages || [])]),
    workGroup: base.workGroup || next.workGroup,
  }
}

function conflictRecord(candidate, existing, match, existingIndex) {
  return {
    type: 'possible_duplicate',
    confidence: match.confidence,
    signals: match.signals,
    existingIndex,
    candidate,
    existing,
  }
}

function mergeRecord(candidate, existing, match, existingIndex) {
  return {
    confidence: match.confidence,
    signals: match.signals,
    existingIndex,
    candidate,
    existing,
  }
}

export function dedupeCandidates(candidates) {
  const deduped = []
  const conflicts = []
  const merges = []

  for (const candidate of candidates) {
    const matches = deduped
      .map((existing, existingIndex) => ({ existing, existingIndex, match: compareWorkCandidates(candidate, existing) }))
      .filter(({ match }) => match.action !== 'new')

    const mergeMatches = matches.filter(({ match }) => match.action === 'merge')
    const conflictMatches = matches.filter(({ match }) => match.action === 'conflict')

    if (mergeMatches.length === 1) {
      const { existing, existingIndex, match } = mergeMatches[0]
      merges.push(mergeRecord(candidate, existing, match, existingIndex))
      deduped[existingIndex] = mergeCandidate(existing, candidate)
      continue
    }

    if (mergeMatches.length > 1) {
      for (const { existing, existingIndex, match } of mergeMatches) {
        conflicts.push(conflictRecord(candidate, existing, { ...match, confidence: `multi_match_${match.confidence}` }, existingIndex))
      }
      continue
    }

    if (conflictMatches.length > 0) {
      for (const { existing, existingIndex, match } of conflictMatches) {
        conflicts.push(conflictRecord(candidate, existing, match, existingIndex))
      }
      deduped.push(candidate)
      continue
    }

    deduped.push(candidate)
  }

  return { deduped, conflicts, merges }
}

async function writeTextFile(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, text, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out')
  const conflictsOutput = args.get('conflicts') || path.join(path.dirname(output || '.'), 'conflicts.jsonl')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'dedupe-conflicts.md')

  if (!input || !output) {
    console.error('Usage: pnpm source:dedupe -- --in <candidate-works.jsonl> --out <works.deduped.jsonl> [--conflicts <conflicts.jsonl>] [--report <dedupe-conflicts.md>]')
    process.exitCode = 1
    return
  }

  const candidates = await readJsonl(input)
  const result = dedupeCandidates(candidates)
  await writeJsonl(output, result.deduped)
  await writeJsonl(conflictsOutput, result.conflicts)
  await writeTextFile(reportOutput, createDedupeReport({ inputCount: candidates.length, ...result }))

  console.log(`Deduped ${candidates.length} candidates -> ${result.deduped.length} records, ${result.conflicts.length} conflicts, ${result.merges.length} auto merges`)
  console.log(`Wrote dedupe report -> ${reportOutput}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
