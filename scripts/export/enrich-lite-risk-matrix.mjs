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

function compactPlainText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join('\n')
}

function riskMatrix(value) {
  if (!value || typeof value !== 'object') return undefined

  const matrix = {
    maleImpact: normalizeText(value.maleImpact),
    relationshipClarity: normalizeText(value.relationshipClarity),
    endingSafety: normalizeText(value.endingSafety),
    creatorSpeechRisk: normalizeText(value.creatorSpeechRisk),
    note: compactPlainText(value.note),
  }

  return Object.values(matrix).some(Boolean) ? matrix : undefined
}

function visibilityParams(includeDrafts) {
  const params = new URLSearchParams()
  params.set('limit', '100')
  params.set('depth', '0')
  if (includeDrafts) params.set('draft', 'true')
  else {
    params.set('where[status][equals]', 'published')
    params.set('where[isLiteVisible][not_equals]', 'false')
  }
  return params
}

async function fetchWorks(baseUrl, includeDrafts) {
  const docs = []
  let page = 1
  let totalPages = 1

  do {
    const params = visibilityParams(includeDrafts)
    params.set('page', String(page))
    const result = await requestJson(`${baseUrl}/api/works?${params.toString()}`)
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

  const works = await fetchWorks(baseUrl, includeDrafts)
  const matrixById = new Map()

  for (const doc of works) {
    const matrix = riskMatrix(doc.riskMatrix)
    if (matrix) matrixById.set(`works:${doc.slug}`, matrix)
  }

  const items = (index.items || []).map((item) => {
    if (item.collection !== 'works') return item
    return {
      ...item,
      riskMatrix: matrixById.get(item.id) || item.riskMatrix,
    }
  })

  writeJson(file, { ...index, items })
  console.log('Lite risk matrix enriched')
  console.log(JSON.stringify({ file: path.resolve(file), works: works.length, riskMatrix: matrixById.size }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
