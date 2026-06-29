#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_WORKS_INPUT = path.join('data_local', 'payload', 'bangumi-media-work-package-preview.json')
const DEFAULT_ENTITIES_INPUT = path.join('data_local', 'payload', 'bangumi-media-entity-seed-package-preview.json')
const DEFAULT_OUTPUT = path.join('data_local', 'payload', 'bgm-id-map.json')
const DEFAULT_REPORT = path.join('data_local', 'reports', 'bgm-id-map.md')
const DEFAULT_URL = 'http://127.0.0.1:3000'
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

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ')
}

function key(value) {
  return cleanText(value).toLowerCase()
}

function rows(value) {
  return Array.isArray(value) ? value : []
}

function normalizeDoc(doc, collection) {
  return {
    collection,
    id: cleanText(doc?.id),
    title: cleanText(doc?.title),
    name: cleanText(doc?.name),
    slug: cleanText(doc?.slug),
    siteId: cleanText(doc?.siteId),
    status: cleanText(doc?.status),
    updatedAt: cleanText(doc?.updatedAt),
  }
}

function uniqueDocs(docs, collection) {
  const seen = new Set()
  const out = []
  for (const doc of rows(docs)) {
    const normalized = normalizeDoc(doc, collection)
    const docKey = normalized.id || `${normalized.name || normalized.title}|${normalized.slug}|${normalized.siteId}`.toLowerCase()
    if (!docKey || seen.has(docKey)) continue
    seen.add(docKey)
    out.push(normalized)
  }
  return out
}

function workRow(work) {
  const bangumiSubjectId = cleanText(work?.bangumiSubjectId || work?.externalIds?.bangumiSubjectId)
  return {
    collection: 'works',
    title: cleanText(work?.title),
    slug: cleanText(work?.slug),
    siteId: bangumiSubjectId ? `bangumi-${bangumiSubjectId}` : cleanText(work?.siteId),
    bangumiSubjectId,
    mediaGroup: cleanText(work?.mediaGroup),
    mediaType: cleanText(work?.mediaType),
  }
}

function entityRow(entity, collection) {
  return {
    collection,
    name: cleanText(entity?.name),
    slug: cleanText(entity?.slug),
    status: cleanText(entity?.status || 'draft') || 'draft',
  }
}

async function defaultLookup(collection, queries, { url = DEFAULT_URL, token = '' } = {}) {
  const baseUrl = String(url || DEFAULT_URL).replace(/\/+$/u, '')
  const headers = token ? { Authorization: `JWT ${token}` } : {}
  const docs = []
  for (const item of queries) {
    const field = cleanText(item.field)
    const value = cleanText(item.value)
    if (!field || !value) continue
    const query = new URLSearchParams()
    query.set('limit', '20')
    query.set('depth', '0')
    query.set(`where[${field}][equals]`, value)
    const response = await fetch(`${baseUrl}/api/${collection}?${query.toString()}`, { headers })
    if (!response.ok) throw new Error(`${collection}.${field} query failed: ${response.status} ${response.statusText}`)
    const body = await response.json()
    docs.push(...rows(body?.docs))
  }
  return uniqueDocs(docs, collection)
}

function analyzeWork(work, existing, error = '') {
  if (error) return { status: 'query-error', item: null, matches: [], collisions: [], error }
  const siteIdKey = key(work.siteId)
  const slugKey = key(work.slug)
  const exact = existing.filter((doc) => (siteIdKey && key(doc.siteId) === siteIdKey) || (slugKey && key(doc.slug) === slugKey))
  if (exact.length === 1) return { status: 'matched', item: exact[0], matches: exact, collisions: [], error: '' }
  if (exact.length > 1) return { status: 'ambiguous', item: null, matches: exact, collisions: exact, error: '' }
  return { status: 'missing', item: null, matches: [], collisions: [], error: '' }
}

function analyzeEntity(entity, existing, error = '') {
  if (error) return { status: 'query-error', item: null, matches: [], nameCollisions: [], slugCollisions: [], error }
  const nameKey = key(entity.name)
  const slugKey = key(entity.slug)
  const exact = existing.filter((doc) => key(doc.name) === nameKey && key(doc.slug) === slugKey)
  const nameCollisions = existing.filter((doc) => key(doc.name) === nameKey && key(doc.slug) !== slugKey)
  const slugCollisions = existing.filter((doc) => key(doc.slug) === slugKey && key(doc.name) !== nameKey)
  if (exact.length === 1) return { status: 'matched', item: exact[0], matches: exact, nameCollisions, slugCollisions, error: '' }
  if (exact.length > 1 || slugCollisions.length > 0) return { status: 'ambiguous', item: null, matches: exact.length > 1 ? exact : slugCollisions, nameCollisions, slugCollisions, error: '' }
  return { status: 'missing', item: null, matches: [], nameCollisions, slugCollisions, error: '' }
}

function countStatus(items, status) {
  return items.filter((item) => item.status === status).length
}

function stats(items) {
  return {
    total: items.length,
    matched: countStatus(items, 'matched'),
    missing: countStatus(items, 'missing'),
    ambiguous: countStatus(items, 'ambiguous'),
    queryErrors: countStatus(items, 'query-error'),
  }
}

export async function buildBgmIdMap(workPackage, entityPackage, { generatedAt = new Date().toISOString(), url = DEFAULT_URL, token = '', lookup = defaultLookup } = {}) {
  const works = rows(workPackage?.works).map(workRow)
  const creators = rows(entityPackage?.creators).map((item) => entityRow(item, 'creators'))
  const organizations = rows(entityPackage?.organizations).map((item) => entityRow(item, 'organizations'))
  const mappedWorks = []
  const mappedCreators = []
  const mappedOrganizations = []

  for (const work of works) {
    let existing = []
    let error = ''
    try {
      existing = await lookup('works', [{ field: 'siteId', value: work.siteId }, { field: 'slug', value: work.slug }], { url, token })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    const result = analyzeWork(work, existing, error)
    mappedWorks.push({ ...work, status: result.status, payload: result.item, matches: result.matches, collisions: result.collisions, error: result.error })
  }

  for (const creator of creators) {
    let existing = []
    let error = ''
    try {
      existing = await lookup('creators', [{ field: 'name', value: creator.name }, { field: 'slug', value: creator.slug }], { url, token })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    const result = analyzeEntity(creator, existing, error)
    mappedCreators.push({ ...creator, status: result.status, payload: result.item, matches: result.matches, nameCollisions: result.nameCollisions, slugCollisions: result.slugCollisions, error: result.error })
  }

  for (const organization of organizations) {
    let existing = []
    let error = ''
    try {
      existing = await lookup('organizations', [{ field: 'name', value: organization.name }, { field: 'slug', value: organization.slug }], { url, token })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    const result = analyzeEntity(organization, existing, error)
    mappedOrganizations.push({ ...organization, status: result.status, payload: result.item, matches: result.matches, nameCollisions: result.nameCollisions, slugCollisions: result.slugCollisions, error: result.error })
  }

  const workStats = stats(mappedWorks)
  const creatorStats = stats(mappedCreators)
  const organizationStats = stats(mappedOrganizations)
  const entityRows = [...mappedCreators, ...mappedOrganizations]
  const nameCollisionRows = entityRows.filter((row) => rows(row.nameCollisions).length > 0)
  const slugCollisionRows = entityRows.filter((row) => rows(row.slugCollisions).length > 0)

  return {
    meta: {
      source: 'bgm-id-map',
      mode: 'read-only-local-query',
      generatedAt,
      url: cleanText(url),
      safety: {
        localQuery: true,
        changes: false,
        relationPatch: false,
        coverUpload: false,
      },
      input: {
        worksSource: cleanText(workPackage?.meta?.source),
        worksMode: cleanText(workPackage?.meta?.mode),
        entitiesSource: cleanText(entityPackage?.meta?.source),
        entitiesMode: cleanText(entityPackage?.meta?.mode),
      },
      stats: {
        packageWorksTotal: workStats.total,
        packageCreatorsTotal: creatorStats.total,
        packageOrganizationsTotal: organizationStats.total,
        worksMatchedTotal: workStats.matched,
        worksMissingTotal: workStats.missing,
        worksAmbiguousTotal: workStats.ambiguous,
        worksQueryErrorsTotal: workStats.queryErrors,
        creatorsMatchedTotal: creatorStats.matched,
        creatorsMissingTotal: creatorStats.missing,
        creatorsAmbiguousTotal: creatorStats.ambiguous,
        creatorsQueryErrorsTotal: creatorStats.queryErrors,
        organizationsMatchedTotal: organizationStats.matched,
        organizationsMissingTotal: organizationStats.missing,
        organizationsAmbiguousTotal: organizationStats.ambiguous,
        organizationsQueryErrorsTotal: organizationStats.queryErrors,
        entityNameCollisionRowsTotal: nameCollisionRows.length,
        entityNameCollisionDocsTotal: nameCollisionRows.reduce((sum, row) => sum + rows(row.nameCollisions).length, 0),
        entitySlugCollisionRowsTotal: slugCollisionRows.length,
        entitySlugCollisionDocsTotal: slugCollisionRows.reduce((sum, row) => sum + rows(row.slugCollisions).length, 0),
      },
    },
    works: mappedWorks,
    creators: mappedCreators,
    organizations: mappedOrganizations,
  }
}

function reportTable(title, items, topLimit) {
  const lines = [`## ${title}`, '', '| Name | Slug | Site ID | ID | Status | Note |', '| --- | --- | --- | --- | --- | --- |']
  for (const item of rows(items).slice(0, topLimit)) {
    const label = item.title || item.name
    const note = [item.error, rows(item.nameCollisions).length ? `nameCollisions=${rows(item.nameCollisions).length}` : '', rows(item.slugCollisions).length ? `slugCollisions=${rows(item.slugCollisions).length}` : ''].filter(Boolean).join('; ')
    lines.push(`| ${label} | ${item.slug || ''} | ${item.siteId || ''} | ${item.payload?.id || ''} | ${item.status} | ${note} |`)
  }
  return lines.join('\n')
}

export function createBgmIdMapReport(map, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const s = map?.meta?.stats || {}
  return `${REPORT_UTF8_BOM}${[
    '# BGM ID map',
    '',
    '## Summary',
    '',
    `- source: ${map?.meta?.source || ''}`,
    `- mode: ${map?.meta?.mode || ''}`,
    `- generatedAt: ${map?.meta?.generatedAt || ''}`,
    `- url: ${map?.meta?.url || ''}`,
    `- works: ${s.worksMatchedTotal}/${s.packageWorksTotal}; missing=${s.worksMissingTotal}; ambiguous=${s.worksAmbiguousTotal}; queryErrors=${s.worksQueryErrorsTotal}`,
    `- creators: ${s.creatorsMatchedTotal}/${s.packageCreatorsTotal}; missing=${s.creatorsMissingTotal}; ambiguous=${s.creatorsAmbiguousTotal}; queryErrors=${s.creatorsQueryErrorsTotal}`,
    `- organizations: ${s.organizationsMatchedTotal}/${s.packageOrganizationsTotal}; missing=${s.organizationsMissingTotal}; ambiguous=${s.organizationsAmbiguousTotal}; queryErrors=${s.organizationsQueryErrorsTotal}`,
    `- entityNameCollisionRowsTotal: ${s.entityNameCollisionRowsTotal}`,
    `- entityNameCollisionDocsTotal: ${s.entityNameCollisionDocsTotal}`,
    '',
    '## Safety',
    '',
    '- Read-only local query.',
    '- No relation patch.',
    '- No cover upload.',
    '- Keep outputs under data_local.',
    '',
    reportTable('Works', map?.works, topLimit),
    '',
    reportTable('Creators', map?.creators, topLimit),
    '',
    reportTable('Organizations', map?.organizations, topLimit),
  ].join('\n')}\n`
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
  const worksInput = args.get('works') || DEFAULT_WORKS_INPUT
  const entitiesInput = args.get('entities') || DEFAULT_ENTITIES_INPUT
  const output = args.get('out') || DEFAULT_OUTPUT
  const report = args.get('report') || DEFAULT_REPORT
  const url = args.get('url') || DEFAULT_URL
  const token = args.get('token') || process.env.PAYLOAD_TOKEN || ''
  const topLimit = Number(args.get('top') || DEFAULT_TOP_LIMIT)

  const workPackage = await readJson(worksInput)
  const entityPackage = await readJson(entitiesInput)
  const map = await buildBgmIdMap(workPackage, entityPackage, { url, token })

  await writeJson(output, map)
  await writeText(report, createBgmIdMapReport(map, { topLimit }))

  const s = map.meta.stats
  console.log(`Wrote BGM ID map -> ${output}`)
  console.log(`Wrote BGM ID map report -> ${report}`)
  console.log(`ID map: works=${s.worksMatchedTotal}/${s.packageWorksTotal}; creators=${s.creatorsMatchedTotal}/${s.packageCreatorsTotal}; organizations=${s.organizationsMatchedTotal}/${s.packageOrganizationsTotal}; missing=${s.worksMissingTotal + s.creatorsMissingTotal + s.organizationsMissingTotal}; ambiguous=${s.worksAmbiguousTotal + s.creatorsAmbiguousTotal + s.organizationsAmbiguousTotal}; query-errors=${s.worksQueryErrorsTotal + s.creatorsQueryErrorsTotal + s.organizationsQueryErrorsTotal}`)
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}


