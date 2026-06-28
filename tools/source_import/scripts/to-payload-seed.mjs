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

function cleanText(value) {
  return String(value || '').trim()
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

function creditHintLine(hint) {
  const name = cleanText(hint?.name)
  if (!name) return ''

  const role = cleanText(hint?.role) || 'other'
  const originalRole = cleanText(hint?.originalRole)
  const note = cleanText(hint?.note)
  const source = cleanText(hint?.source)
  return [
    `- ${name}`,
    `role=${role}`,
    originalRole ? `originalRole=${originalRole}` : '',
    source ? `source=${source}` : '',
    note ? `note=${note}` : '',
  ].filter(Boolean).join(' | ')
}

function candidateEnrichmentNote(candidate) {
  const sections = []
  const summaryText = cleanText(candidate.summaryText || candidate.summaryPlainText)
  const creatorHints = cleanArray(candidate.creatorCreditHints).map(creditHintLine).filter(Boolean)
  const organizationHints = cleanArray(candidate.organizationCreditHints).map(creditHintLine).filter(Boolean)

  if (summaryText) {
    sections.push(`## Bangumi 简介候选\n${summaryText}`)
  }

  if (creatorHints.length > 0) {
    sections.push(`## Bangumi 创作者职位候选\n${creatorHints.join('\n')}`)
  }

  if (organizationHints.length > 0) {
    sections.push(`## Bangumi 机构/制作候选\n${organizationHints.join('\n')}`)
  }

  return sections.join('\n\n')
}

function mergeNotes(...notes) {
  return notes.map(cleanText).filter(Boolean).join('\n\n') || undefined
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
    const evidenceNote = mergeNotes(candidate.evidenceNote, candidateEnrichmentNote(candidate))

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
      evidenceNote,
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
