#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeText, slugify } from '../lib/slug.mjs'

const DEFAULT_INPUT = path.join('data_local', 'normalized', 'bangumi-media-subjects.candidate-works.jsonl')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-preview.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-preview.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'

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

function cleanName(value) {
  return normalizeText(value)
}

function collectionForKind(kind) {
  return kind === 'creator' ? 'creators' : 'organizations'
}

function sourceWorkRef(work) {
  const bangumiSubjectId = normalizeText(work?.externalIds?.bangumiSubjectId || work?.candidateSources?.find((source) => source?.source === 'bangumi')?.externalId)
  return {
    title: normalizeText(work?.title),
    slug: normalizeText(work?.slug),
    mediaGroup: normalizeText(work?.mediaGroup),
    mediaType: normalizeText(work?.mediaType),
    bangumiSubjectId,
  }
}

function createSeedKey(kind, name) {
  return `${kind}:${cleanName(name).toLowerCase()}`
}

function addHintSeed(index, { kind, hint, work }) {
  const name = cleanName(hint?.name)
  if (!name) return

  const key = createSeedKey(kind, name)
  if (!index.has(key)) {
    index.set(key, {
      collection: collectionForKind(kind),
      kind,
      name,
      slug: slugify(name, { fallback: kind }),
      status: 'draft',
      source: 'bangumi-media-candidate-work-hints',
      mode: 'preview-only-no-payload-write',
      aliases: [],
      roles: [],
      originalRoles: [],
      sourceWorks: [],
      evidence: [],
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
    })
  }

  const seed = index.get(key)
  const role = normalizeText(hint?.role || 'other')
  const originalRole = normalizeText(hint?.originalRole || '')
  const workRef = sourceWorkRef(work)
  const evidenceKey = [workRef.bangumiSubjectId, role, originalRole].join('|')

  if (role && !seed.roles.includes(role)) seed.roles.push(role)
  if (originalRole && !seed.originalRoles.includes(originalRole)) seed.originalRoles.push(originalRole)

  if (workRef.bangumiSubjectId && !seed.sourceWorks.some((row) => row.bangumiSubjectId === workRef.bangumiSubjectId)) {
    seed.sourceWorks.push(workRef)
  }

  if (!seed.evidence.some((row) => row.key === evidenceKey)) {
    seed.evidence.push({
      key: evidenceKey,
      source: 'bangumi',
      role,
      originalRole,
      note: normalizeText(hint?.note || ''),
      work: workRef,
    })
  }
}

function sortSeed(seed) {
  return {
    ...seed,
    roles: seed.roles.toSorted((a, b) => a.localeCompare(b)),
    originalRoles: seed.originalRoles.toSorted((a, b) => a.localeCompare(b)),
    sourceWorks: seed.sourceWorks.toSorted((a, b) => a.title.localeCompare(b.title) || a.bangumiSubjectId.localeCompare(b.bangumiSubjectId)),
    evidence: seed.evidence.toSorted((a, b) => a.work.title.localeCompare(b.work.title) || a.role.localeCompare(b.role)),
  }
}

function countBy(items, keyFn) {
  const counts = new Map()
  for (const item of items) {
    const key = normalizeText(keyFn(item))
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

export function buildBangumiMediaEntitySeedPreview(candidateWorks, { generatedAt = new Date().toISOString() } = {}) {
  const works = Array.isArray(candidateWorks) ? candidateWorks : []
  const creatorIndex = new Map()
  const organizationIndex = new Map()

  for (const work of works) {
    for (const hint of Array.isArray(work?.creatorCreditHints) ? work.creatorCreditHints : []) {
      addHintSeed(creatorIndex, { kind: 'creator', hint, work })
    }

    for (const hint of Array.isArray(work?.organizationCreditHints) ? work.organizationCreditHints : []) {
      addHintSeed(organizationIndex, { kind: 'organization', hint, work })
    }
  }

  const creators = [...creatorIndex.values()].map(sortSeed).toSorted((a, b) => a.name.localeCompare(b.name))
  const organizations = [...organizationIndex.values()].map(sortSeed).toSorted((a, b) => a.name.localeCompare(b.name))
  const allSeeds = [...creators, ...organizations]

  return {
    meta: {
      source: 'bangumi-media-entity-seed-preview',
      mode: 'preview-only-no-payload-write',
      generatedAt,
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        candidateWorksTotal: works.length,
        creatorsTotal: creators.length,
        organizationsTotal: organizations.length,
        seedsTotal: allSeeds.length,
        creatorRoleCounts: countBy(creators.flatMap((seed) => seed.roles), (role) => role),
        organizationRoleCounts: countBy(organizations.flatMap((seed) => seed.roles), (role) => role),
        seedEvidenceTotal: allSeeds.reduce((sum, seed) => sum + seed.evidence.length, 0),
      },
    },
    creators,
    organizations,
  }
}

export function createBangumiMediaEntitySeedPreviewReport(preview, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = preview?.meta?.stats || {}
  const lines = [
    '# Bangumi media entity seed preview',
    '',
    '## Summary',
    '',
    `- source: ${preview?.meta?.source || ''}`,
    `- mode: ${preview?.meta?.mode || ''}`,
    `- generatedAt: ${preview?.meta?.generatedAt || ''}`,
    `- candidateWorksTotal: ${stats.candidateWorksTotal}`,
    `- creatorsTotal: ${stats.creatorsTotal}`,
    `- organizationsTotal: ${stats.organizationsTotal}`,
    `- seedsTotal: ${stats.seedsTotal}`,
    `- seedEvidenceTotal: ${stats.seedEvidenceTotal}`,
    '',
    '## Safety',
    '',
    '- Preview only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No entity import.',
    '- No works patch.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Creator role counts',
    '',
  ]

  for (const [role, count] of Object.entries(stats.creatorRoleCounts || {})) lines.push(`- ${role}: ${count}`)

  lines.push('', '## Organization role counts', '')
  for (const [role, count] of Object.entries(stats.organizationRoleCounts || {})) lines.push(`- ${role}: ${count}`)

  lines.push('', '## Sample creators', '')
  for (const seed of (preview.creators || []).slice(0, topLimit)) {
    lines.push(`- ${seed.name}: roles=${seed.roles.join(', ') || 'none'}; works=${seed.sourceWorks.length}`)
  }

  lines.push('', '## Sample organizations', '')
  for (const seed of (preview.organizations || []).slice(0, topLimit)) {
    lines.push(`- ${seed.name}: roles=${seed.roles.join(', ') || 'none'}; works=${seed.sourceWorks.length}`)
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

async function readJsonl(filePath) {
  const text = await readFile(filePath, 'utf8')
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in') || DEFAULT_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)

  const candidateWorks = await readJsonl(input)
  const preview = buildBangumiMediaEntitySeedPreview(candidateWorks)

  await writeJson(output, preview)
  await writeText(report, createBangumiMediaEntitySeedPreviewReport(preview, { topLimit }))

  console.log(`Wrote Bangumi media entity seed preview -> ${output}`)
  console.log(`Wrote Bangumi media entity seed preview report -> ${report}`)
  console.log(`Seeds: creators=${preview.meta.stats.creatorsTotal}; organizations=${preview.meta.stats.organizationsTotal}; evidence=${preview.meta.stats.seedEvidenceTotal}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
