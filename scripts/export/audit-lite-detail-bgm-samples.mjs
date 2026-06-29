#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = 'public/detail-index.json'

const REQUIRED_SAMPLES = [
  {
    slug: '百合星人奈绪子美眉',
    title: '百合星人奈绪子美眉',
    mediaGroup: 'manga',
    mediaType: 'manga',
    format: 'manga_series',
  },
  {
    slug: '百合少女',
    title: '百合少女',
    mediaGroup: 'manga',
    mediaType: 'manga',
    format: 'manga_series',
  },
  {
    slug: '百合少女-bgm-215570',
    title: '百合少女',
    mediaGroup: 'manga',
    mediaType: 'manga',
    format: 'manga_series',
  },
]

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

function readJson(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing detail index: ${resolved}`)
  }

  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

function assertNoObjectObject(value) {
  const text = JSON.stringify(value)
  if (text.includes('[object Object]')) {
    throw new Error('detail-index contains literal [object Object]')
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function findWork(items, slug) {
  return items.find((item) => item.collection === 'works' && item.slug === slug)
}

function assertNonEmptyArray(value, label) {
  const array = requireArray(value, label)
  if (!array.length) throw new Error(`${label} must not be empty`)
}

function assertSample(item, sample) {
  if (!item) throw new Error(`missing BGM lite detail sample: ${sample.slug}`)

  const expectedId = `works:${sample.slug}`
  const expectedUrl = `/works/${sample.slug}`

  const checks = [
    ['id', item.id, expectedId],
    ['collection', item.collection, 'works'],
    ['title', item.title, sample.title],
    ['slug', item.slug, sample.slug],
    ['url', item.url, expectedUrl],
    ['mediaGroup', item.mediaGroup, sample.mediaGroup],
    ['mediaType', item.mediaType, sample.mediaType],
    ['format', item.format, sample.format],
  ]

  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`${sample.slug}: expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }

  assertNonEmptyArray(item.organizations, `${sample.slug}.organizations`)
}

function assertUniqueWorkSlugs(items) {
  const seen = new Set()
  for (const item of items.filter((entry) => entry.collection === 'works')) {
    if (seen.has(item.slug)) throw new Error(`duplicate work slug in detail-index: ${item.slug}`)
    seen.add(item.slug)
  }
}

function auditDetailIndex(detailIndex) {
  assertNoObjectObject(detailIndex)
  const items = requireArray(detailIndex.items, 'detailIndex.items')
  assertUniqueWorkSlugs(items)

  const results = []
  for (const sample of REQUIRED_SAMPLES) {
    const item = findWork(items, sample.slug)
    assertSample(item, sample)
    results.push({
      slug: item.slug,
      title: item.title,
      mediaGroup: item.mediaGroup,
      mediaType: item.mediaType,
      format: item.format,
      organizations: item.organizations.length,
    })
  }

  return results
}

function printResults(results) {
  console.log('Lite detail BGM sample audit passed')
  console.table(results)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = args.file || DEFAULT_FILE
  const detailIndex = readJson(file)
  const results = auditDetailIndex(detailIndex)
  printResults(results)
}

main()
