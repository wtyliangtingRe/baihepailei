#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_INPUT = path.join('data_local', 'normalized', 'bangumi-media-subjects.candidate-works.jsonl')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bangumi-media-work-package-preview.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bangumi-media-work-package-preview.md')
const DEFAULT_TOP_LIMIT = 100
const REPORT_UTF8_BOM = '\uFEFF'

const PACKAGE_SOURCE = 'bangumi-media-work-package-preview'
const PACKAGE_MODE = 'package-preview-only-no-payload-write'
const INPUT_SOURCE = 'bangumi-media-normalize-preview'

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

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ''
}

function readCreditHints(value) {
  return asRows(value).map((hint) => ({
    name: cleanText(hint?.name),
    role: cleanText(hint?.role),
    originalRole: cleanText(hint?.originalRole),
    source: cleanText(hint?.source),
    note: cleanText(hint?.note),
  })).filter((hint) => hint.name)
}

function pickBangumiSubjectId(row) {
  return firstText(
    row?.bangumiSubjectId,
    row?.bangumiId,
    row?.subjectId,
    row?.sourceIds?.bangumiSubjectId,
    row?.sourceIds?.bangumi,
    row?.externalIds?.bangumiSubjectId,
    row?.externalIds?.bangumi,
  )
}

function pickCoverReference(row) {
  const cover = row?.cover || row?.coverImage || row?.image || row?.images || null
  return {
    source: 'bangumi',
    upload: false,
    referenceOnly: true,
    value: cover,
  }
}

function packageWork(row, index) {
  const creatorCreditHints = readCreditHints(row?.creatorCreditHints)
  const organizationCreditHints = readCreditHints(row?.organizationCreditHints)
  const bangumiSubjectId = pickBangumiSubjectId(row)

  return {
    collection: 'works',
    kind: 'media-work',
    title: firstText(row?.title, row?.name),
    slug: cleanText(row?.slug),
    status: 'draft',
    importAction: 'create-if-missing',
    source: PACKAGE_SOURCE,
    sourceCandidate: {
      index,
      source: cleanText(row?.source || INPUT_SOURCE),
      mode: cleanText(row?.mode),
      bangumiSubjectId,
      title: firstText(row?.title, row?.name),
      slug: cleanText(row?.slug),
    },
    mediaGroup: cleanText(row?.mediaGroup),
    mediaType: cleanText(row?.mediaType),
    bangumiSubjectId,
    aliases: asRows(row?.aliases).map(cleanText).filter(Boolean),
    summary: cleanText(row?.summary || row?.description),
    startDate: cleanText(row?.startDate || row?.date || row?.airDate || row?.releaseDate),
    rating: row?.rating ?? null,
    tags: asRows(row?.tags).map((tag) => typeof tag === 'string' ? { name: cleanText(tag) } : tag).filter(Boolean),
    coverPreview: pickCoverReference(row),
    creatorCreditHints,
    organizationCreditHints,
    sourceWork: row,
    evidence: [
      {
        source: 'bangumi',
        bangumiSubjectId,
        title: firstText(row?.title, row?.name),
        mediaGroup: cleanText(row?.mediaGroup),
        mediaType: cleanText(row?.mediaType),
      },
    ],
    safety: {
      payloadWrite: false,
      databaseWrite: false,
      workImport: false,
      entityImport: false,
      worksPatch: false,
      coverUpload: false,
    },
  }
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

export function buildBangumiMediaWorkPackagePreview(candidateWorks, { generatedAt = new Date().toISOString() } = {}) {
  const inputWorks = asRows(candidateWorks)
  const works = inputWorks.map((row, index) => packageWork(row, index))

  return {
    meta: {
      source: PACKAGE_SOURCE,
      mode: PACKAGE_MODE,
      generatedAt,
      input: {
        source: INPUT_SOURCE,
        format: 'jsonl',
      },
      safety: {
        payloadWrite: false,
        databaseWrite: false,
        workImport: false,
        entityImport: false,
        worksPatch: false,
        coverUpload: false,
      },
      stats: {
        inputWorksTotal: inputWorks.length,
        worksTotal: works.length,
        creatorCreditHintsTotal: works.reduce((sum, work) => sum + work.creatorCreditHints.length, 0),
        organizationCreditHintsTotal: works.reduce((sum, work) => sum + work.organizationCreditHints.length, 0),
        rowsWithCreatorHints: works.filter((work) => work.creatorCreditHints.length > 0).length,
        rowsWithOrganizationHints: works.filter((work) => work.organizationCreditHints.length > 0).length,
        rowsWithCoverReferences: works.filter((work) => work.coverPreview?.value).length,
        mediaGroupCounts: countBy(works, (work) => work.mediaGroup),
        mediaTypeCounts: countBy(works, (work) => work.mediaType),
      },
    },
    works,
  }
}

export function createBangumiMediaWorkPackagePreviewReport(pkg, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const stats = pkg?.meta?.stats || {}
  const lines = [
    '# Bangumi media work package preview',
    '',
    '## Summary',
    '',
    `- source: ${pkg?.meta?.source || ''}`,
    `- mode: ${pkg?.meta?.mode || ''}`,
    `- generatedAt: ${pkg?.meta?.generatedAt || ''}`,
    `- inputWorksTotal: ${stats.inputWorksTotal}`,
    `- worksTotal: ${stats.worksTotal}`,
    `- creatorCreditHintsTotal: ${stats.creatorCreditHintsTotal}`,
    `- organizationCreditHintsTotal: ${stats.organizationCreditHintsTotal}`,
    `- rowsWithCreatorHints: ${stats.rowsWithCreatorHints}`,
    `- rowsWithOrganizationHints: ${stats.rowsWithOrganizationHints}`,
    `- rowsWithCoverReferences: ${stats.rowsWithCoverReferences}`,
    '',
    '## Safety',
    '',
    '- Package preview only.',
    '- No Payload connection.',
    '- No database writes.',
    '- No work import.',
    '- No entity import.',
    '- No works patch.',
    '- Cover values are reference-only; no upload is performed.',
    '- Outputs should stay under data_local and must not be committed.',
    '',
    '## Media group counts',
    '',
  ]

  for (const [group, count] of Object.entries(stats.mediaGroupCounts || {})) lines.push(`- ${group}: ${count}`)

  lines.push('', '## Media type counts', '')
  for (const [type, count] of Object.entries(stats.mediaTypeCounts || {})) lines.push(`- ${type}: ${count}`)

  lines.push('', '## Works', '')
  for (const work of asRows(pkg?.works).slice(0, topLimit)) {
    lines.push(`- ${work.title}: bangumi=${work.bangumiSubjectId}; media=${work.mediaGroup}/${work.mediaType}; creatorHints=${work.creatorCreditHints.length}; organizationHints=${work.organizationCreditHints.length}`)
  }

  return `${REPORT_UTF8_BOM}${lines.join('\n')}\n`
}

export function parseJsonLines(text) {
  return String(text || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function readCandidateWorks(filePath) {
  const text = await readFile(filePath, 'utf8')
  if (filePath.endsWith('.json')) return JSON.parse(text)
  return parseJsonLines(text)
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

  const candidateWorks = await readCandidateWorks(input)
  const pkg = buildBangumiMediaWorkPackagePreview(candidateWorks)

  await writeJson(output, pkg)
  await writeText(report, createBangumiMediaWorkPackagePreviewReport(pkg, { topLimit }))

  console.log(`Wrote Bangumi media work package preview -> ${output}`)
  console.log(`Wrote Bangumi media work package preview report -> ${report}`)
  console.log(`Package works: works=${pkg.meta.stats.worksTotal}; creatorHints=${pkg.meta.stats.creatorCreditHintsTotal}; organizationHints=${pkg.meta.stats.organizationCreditHintsTotal}; coverRefs=${pkg.meta.stats.rowsWithCoverReferences}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
