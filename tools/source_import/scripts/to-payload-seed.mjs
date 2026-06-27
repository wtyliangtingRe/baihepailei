#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJsonl, writeJsonFile } from '../lib/jsonl.mjs'
import { normalizeMediaGroup } from '../lib/media-groups.mjs'
import { slugify, uniqueSlug } from '../lib/slug.mjs'

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

function cleanArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function cleanObject(value) {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function cleanSlugPart(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function externalIdSlug(candidate) {
  const externalIds = candidate.externalIds || {}
  const externalIdPairs = [
    ['bangumi', externalIds.bangumiSubjectId],
    ['anilist', externalIds.anilistMediaId],
    ['vndb', externalIds.vndbId],
    ['wikidata', externalIds.wikidataQid],
    ['mal', externalIds.malId],
  ]

  for (const [source, value] of externalIdPairs) {
    const part = cleanSlugPart(value)
    if (part) return `${source}-${part}`
  }

  for (const source of cleanArray(candidate.candidateSources)) {
    const sourceKey = cleanSlugPart(source.source || source.label)
    const externalId = cleanSlugPart(source.externalId)
    if (sourceKey && externalId) return `${sourceKey}-${externalId}`
  }

  return ''
}

export function candidateSlugBase(candidate) {
  return externalIdSlug(candidate)
    || candidate.slug
    || slugify(candidate.title, { fallback: 'candidate-work' })
}

export function toPayloadSeed(candidates) {
  const seenSlugs = new Set()

  const works = candidates.map((candidate) => {
    const slug = uniqueSlug(candidateSlugBase(candidate), seenSlugs)
    const mediaType = candidate.mediaType || 'unknown'

    return {
      siteId: candidate.siteId || undefined,
      title: candidate.title,
      slug,
      rank: 'unknown',
      reviewStatus: 'pending',
      evidenceStrength: 'unassessed',
      originalTitle: candidate.originalTitle || undefined,
      aliases: cleanArray(candidate.aliases),
      localizedTitles: cleanArray(candidate.localizedTitles),
      mediaGroup: normalizeMediaGroup(candidate.mediaGroup, mediaType),
      mediaType,
      format: candidate.format || 'unknown',
      firstPublishedAt: candidate.firstPublishedAt || undefined,
      firstPublishedPrecision: candidate.firstPublishedPrecision || 'unknown',
      firstPublishedLabel: candidate.firstPublishedLabel || undefined,
      externalIds: candidate.externalIds || {},
      candidateSources: cleanArray(candidate.candidateSources),
      externalCoverImages: cleanArray(candidate.externalCoverImages),
      workGroup: cleanObject(candidate.workGroup),
      yuriCandidateScore: candidate.yuriCandidateScore ?? undefined,
      isLiteVisible: false,
      isFullVisible: false,
      hasEvidence: false,
      status: 'draft',
    }
  })

  return { works }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const output = args.get('out')

  if (!input || !output) {
    console.error('Usage: pnpm source:to-payload -- --in <works.deduped.jsonl> --out <payload-candidates.json>')
    process.exitCode = 1
    return
  }

  const candidates = await readJsonl(input)
  const seed = toPayloadSeed(candidates)
  await writeJsonFile(output, seed)

  console.log(`Wrote ${seed.works.length} Payload candidate works -> ${output}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
