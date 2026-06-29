#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-package-preview.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-entity-seed-package-preview.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'
const PACKAGE_SOURCE = 'bangumi-media-entity-seed-package-preview'
const PACKAGE_MODE = 'package-preview-only-no-payload-write'
const INPUT_SOURCE = 'bangumi-media-entity-seed-preview'
const INPUT_MODE = 'preview-only-no-payload-write'

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

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function asRows(value) {
  return Array.isArray(value) ? value : []
}

function countBy(items, keyFn) {
  const counts = new Map()
  for (const item of items) {
    const key = cleanText(keyFn(item))
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

function packageEntity(seed) {
  const collection = cleanText(seed.collection)
  return {
    collection,
    kind: cleanText(seed.kind),
    name: cleanText(seed.name),
    slug: cleanText(seed.slug),
    status: 'draft',
    importAction: 'create-if-missing',
    source: PACKAGE_SOURCE,
    sourcePreview: {
      source: cleanText(seed.source),
      mode: cleanText(seed.mode),
      name: cleanText(seed.name),
      slug: cleanText(seed.slug),
    },
    aliases: asRows(seed.aliases),
    roles: asRows(seed.roles).map(cleanText).filter(Boolean),
    originalRoles: asRows(seed.originalRoles).map(cleanText).filter(Boolean),
    sourceWorks: asRows(seed.sourceWorks),
    evidence: asRows(seed.evidence),
    safety: {
      payloadWrite: false,
      databaseWrite: false,
      entityImport: false,
      worksPatch: false,
    },
  }
}

function skippedSeed(seed, reason) {
  return {
    collection: cleanText(seed.collection),
    kind: cleanText(seed.kind),
    name: cleanText(seed.name),
    slug: cleanText(seed.slug),
    roles: asRows(seed.roles).map(cleanText).filter(Boolean),
    sourceWorksTotal: asRows(seed.sourceWorks).length,
    evidenceTotal: asRows(seed.evidence).length,
    reason,
  }
}

function shouldSkipSeed(seed, { excludePlatformOrganizations }) {
  const collection = cleanText(seed.collection)
  const roles = asRows(seed.roles).map(cleanText).filter(Boolean)

  if (excludePlatformOrganizations && collection === 'organizations' && roles.includes('platform')) {
    return 'platform-organization-excluded-by-default'
  }

  return ''
}

export function buildBangumiMediaEntitySeedPackagePreview(seedPreview, {
  generatedAt = new Date().toISOString(),
  excludePlatformOrganizations = true,
} = {}) {
  const creatorsInput = asRows(seedPreview?.creators)
  const organizationsInput = asRows(seedPreview?.organizations)
  const creators = []
  const organizations = []
  const skippedSeeds = []

  for (const seed of creatorsInput) {
    const reason = shouldSkipSeed(seed, { excludePlatformOrganizations })
    if (reason) skippedSeeds.push(skippedSeed(seed, reason))
    else creators.push(packageEntity(seed))
  }

  for (const seed of organizationsInput) {
    const reason = shouldSkipSeed(seed, { excludePlatformOrganizations })
    if (reason) skippedSeeds.push(skippedSeed(seed, reason))
    else organizations.push(packageEntity(seed))
  }

  const entities = [...creators, ...organizations]

  return {
    meta: {
      source: PACKAGE_SOURCE,
      mode: PACKAGE_MODE,
      generatedAt,
      input: {
        source: cleanText(seedPreview?.meta?.source),
        mode: cleanText(seedPreview?.meta?.mode),
        generatedAt: cleanText(seedPreview?.meta?.generatedAt),
      },
      options: {
        excludePlatformOrganizations,
      },
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        entityImport: false,
        worksPatch: false,
      },
      stats: {
        inputCreatorsTotal: creatorsInput.length,
        inputOrganizationsTotal: organizationsInput.length,
        inputSeedsTotal: creatorsInput.length + organizationsInput.length,
        creatorsTotal: creators.length,
        organizationsTotal: organizations.length,
        entitiesTotal: entities.length,
        skippedSeedsTotal: skippedSeeds.length,
        excludedPlatformSeedsTotal: skippedSeeds.filter((seed) => seed.reason === 'platform-organization-excluded-by-default').length,
        packageEvidenceTotal: entities.reduce((sum, entity) => sum + entity.evidence.length, 0),
        skippedEvidenceTotal: skippedSeeds.reduce((sum, seed) => sum + seed.evidenceTotal, 0),
        creatorRoleCounts: countBy(creators.flatMap((entity) => entity.roles), (role) => role),
        organizationRoleCounts: countBy(organizations.flatMap((entity) => entity.roles), (role) => role),
      },
    },
    creators,
    organizations,
    skippedSeeds,
  }
}

export function createBangumiMediaEntitySeedPackagePreviewReport(pkg, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = pkg?.meta?.stats || {}
  const lines = [
    '# Bangumi media entity seed package preview',
    '',
    '## Summary',
    '',
    `- source: ${pkg?.meta?.source || ''}`,
    `- mode: ${pkg?.meta?.mode || ''}`,
    `- generatedAt: ${pkg?.meta?.generatedAt || ''}`,
    `- inputCreatorsTotal: ${stats.inputCreatorsTotal}`,
    `- inputOrganizationsTotal: ${stats.inputOrganizationsTotal}`,
    `- creatorsTotal: ${stats.creatorsTotal}`,
    `- organizationsTotal: ${stats.organizationsTotal}`,
    `- entitiesTotal: ${stats.entitiesTotal}`,
    `- skippedSeedsTotal: ${stats.skippedSeedsTotal}`,
    `- excludedPlatformSeedsTotal: ${stats.excludedPlatformSeedsTotal}`,
    `- packageEvidenceTotal: ${stats.packageEvidenceTotal}`,
    '',
    '## Safety',
    '',
    '- Package preview only.',
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

  lines.push('', '## Skipped seeds', '')
  if ((pkg.skippedSeeds || []).length === 0) {
    lines.push('- none')
  } else {
    for (const seed of (pkg.skippedSeeds || []).slice(0, topLimit)) {
      lines.push(`- ${seed.name}: reason=${seed.reason}; roles=${seed.roles.join(', ') || 'none'}; evidence=${seed.evidenceTotal}`)
    }
  }

  lines.push('', '## Package creators', '')
  for (const entity of (pkg.creators || []).slice(0, topLimit)) {
    lines.push(`- ${entity.name}: roles=${entity.roles.join(', ') || 'none'}; evidence=${entity.evidence.length}`)
  }

  lines.push('', '## Package organizations', '')
  for (const entity of (pkg.organizations || []).slice(0, topLimit)) {
    lines.push(`- ${entity.name}: roles=${entity.roles.join(', ') || 'none'}; evidence=${entity.evidence.length}`)
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
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
  const excludePlatformOrganizations = args.get('exclude-platform-organizations') !== 'false'

  const seedPreview = await readJson(input)
  if (seedPreview?.meta?.source !== INPUT_SOURCE || seedPreview?.meta?.mode !== INPUT_MODE) {
    throw new Error(`Unexpected seed preview input: ${seedPreview?.meta?.source || ''} / ${seedPreview?.meta?.mode || ''}`)
  }

  const pkg = buildBangumiMediaEntitySeedPackagePreview(seedPreview, { excludePlatformOrganizations })

  await writeJson(output, pkg)
  await writeText(report, createBangumiMediaEntitySeedPackagePreviewReport(pkg, { topLimit }))

  console.log(`Wrote Bangumi media entity seed package preview -> ${output}`)
  console.log(`Wrote Bangumi media entity seed package preview report -> ${report}`)
  console.log(`Package entities: creators=${pkg.meta.stats.creatorsTotal}; organizations=${pkg.meta.stats.organizationsTotal}; skipped=${pkg.meta.stats.skippedSeedsTotal}; evidence=${pkg.meta.stats.packageEvidenceTotal}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
