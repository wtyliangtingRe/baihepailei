#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = 'public/detail-index.json'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i += 1
    }
  }
  return args
}

async function requestJson(url) {
  const response = await fetch(url)
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`)
  return payload
}

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) throw new Error(`Missing file: ${resolved}`)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeText(value) {
  return String(value || '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function relationshipName(item) {
  if (!item) return ''
  if (typeof item === 'string') return item
  return item.title || item.name || item.slug || ''
}

function relationshipNames(values) {
  if (!Array.isArray(values)) return []
  return values.map(relationshipName).map(normalizeText).filter(Boolean)
}

function sourceLinks(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => ({ label: normalizeText(item?.label), url: normalizeText(item?.url) }))
    .filter((item) => item.url)
}

function mediaImage(value) {
  if (!value || typeof value === 'string') return undefined
  const url = normalizeText(value.url)
  if (!url) return undefined
  return {
    url,
    alt: normalizeText(value.alt),
    filename: normalizeText(value.filename),
    width: Number(value.width) || undefined,
    height: Number(value.height) || undefined,
  }
}

function itemUrl(slug) {
  return `/evidence/${slug}`
}

function mapEvidence(doc) {
  return {
    id: `evidence:${doc.slug}`,
    collection: 'evidence',
    typeLabel: '证据材料',
    title: doc.title || '',
    slug: doc.slug || '',
    url: itemUrl(doc.slug),
    evidenceType: doc.evidenceType || 'other',
    reviewStatus: doc.reviewStatus || 'pending',
    evidenceStrength: doc.evidenceStrength || 'unassessed',
    relatedWorks: relationshipNames(doc.relatedWorks),
    relatedCreators: relationshipNames(doc.relatedCreators),
    relatedOrganizations: relationshipNames(doc.relatedOrganizations),
    image: mediaImage(doc.image),
    description: normalizeText(doc.description),
    sourceLinks: sourceLinks(doc.sourceLinks),
    capturedAt: doc.capturedAt || '',
    isPublic: Boolean(doc.isPublic),
    sections: [],
    updatedAt: doc.updatedAt || '',
    createdAt: doc.createdAt || '',
    status: doc.status || '',
  }
}

function visibilityParams(includeDrafts) {
  const params = new URLSearchParams()
  params.set('limit', '100')
  params.set('depth', '1')
  if (includeDrafts) params.set('draft', 'true')
  else {
    params.set('where[status][equals]', 'confirmed')
    params.set('where[isPublic][equals]', 'true')
  }
  return params
}

async function fetchEvidence(baseUrl, includeDrafts) {
  const docs = []
  let page = 1
  let totalPages = 1

  do {
    const params = visibilityParams(includeDrafts)
    params.set('page', String(page))
    const result = await requestJson(`${baseUrl}/api/evidence?${params.toString()}`)
    docs.push(...(result?.docs || []))
    totalPages = Number(result?.totalPages || 1)
    page += 1
  } while (page <= totalPages)

  return docs
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = String(args.file || args.out || DEFAULT_FILE)
  const index = readJson(file)
  const baseUrl = String(args.url || index.source || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '')
  const includeDrafts = Boolean(args['include-drafts']) || index.mode === 'drafts-and-published'
  const evidenceItems = (await fetchEvidence(baseUrl, includeDrafts)).map(mapEvidence)
  const byId = new Map((index.items || []).map((item) => [item.id, item]))

  for (const item of evidenceItems) {
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item })
  }

  const items = Array.from(byId.values()).sort((a, b) => {
    const byCollection = String(a.collection).localeCompare(String(b.collection), 'zh-CN')
    if (byCollection !== 0) return byCollection
    return String(a.title).localeCompare(String(b.title), 'zh-CN')
  })

  const counts = items.reduce((acc, item) => {
    acc[item.collection] = (acc[item.collection] || 0) + 1
    return acc
  }, {})

  writeJson(file, { ...index, counts, total: items.length, items })
  console.log('Lite evidence details enriched')
  console.log(JSON.stringify({ file: path.resolve(file), evidence: evidenceItems.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
