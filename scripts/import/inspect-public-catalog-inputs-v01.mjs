#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const files = [
  {
    key: 'mergeGroupsV2DryrunV02',
    required: true,
    path: 'data_local/staging/merge-groups-v2/merge-groups-v2-dryrun-v02.jsonl',
    type: 'jsonl',
  },
  {
    key: 'mergeGroupsV2DryrunV02Summary',
    required: true,
    path: 'data_local/staging/merge-groups-v2/merge-groups-v2-dryrun-v02-summary.json',
    type: 'json',
  },
  {
    key: 'mergeGroupsV2DryrunV02Ready',
    required: true,
    path: 'data_local/staging/merge-groups-v2/MERGE_GROUPS_V2_DRYRUN_V02_READY.md',
    type: 'text',
  },
  {
    key: 'baselineRadarPublicSeedV02',
    required: true,
    path: 'data_local/staging/website-review-backend/baseline-radar-public-seed-v02.jsonl',
    type: 'jsonl',
  },
  {
    key: 'wikidataIdentityAutoV04',
    required: true,
    path: 'data_local/staging/wikidata-identity/wikidata-identity-auto-v04.jsonl',
    type: 'jsonl',
  },
  {
    key: 'wikidataCandidateReviewV04',
    required: false,
    path: 'data_local/staging/wikidata-identity/wikidata-identity-candidate-review-v04.jsonl',
    type: 'jsonl',
  },
  {
    key: 'wikidataQuarantineV04',
    required: false,
    path: 'data_local/staging/wikidata-identity/wikidata-identity-quarantine-v04.jsonl',
    type: 'jsonl',
  },
]

const outDir = path.join('data_local', 'staging', 'public-catalog-import')
const outJson = path.join(outDir, 'public-catalog-import-input-preflight-v01.json')
const outMd = path.join(outDir, 'public-catalog-import-input-preflight-v01.md')

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonlSample(filePath, limit = 3) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)

  const sample = []

  for (const line of lines.slice(0, limit)) {
    try {
      sample.push(JSON.parse(line))
    } catch (error) {
      sample.push({
        parseError: String(error?.message || error),
        raw: line.slice(0, 500),
      })
    }
  }

  return {
    count: lines.length,
    sample,
  }
}

function collectKeys(value, prefix = '', out = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 2) return out

  if (Array.isArray(value)) {
    if (value[0]) collectKeys(value[0], `${prefix}[]`, out, depth + 1)
    return out
  }

  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    out.add(fullKey)

    if (child && typeof child === 'object') {
      collectKeys(child, fullKey, out, depth + 1)
    }
  }

  return out
}

function compactSample(value) {
  if (!value || typeof value !== 'object') return value

  const result = {}

  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      result[key] = child.slice(0, 2)
    } else if (child && typeof child === 'object') {
      result[key] = Object.fromEntries(Object.entries(child).slice(0, 12))
    } else {
      result[key] = child
    }
  }

  return result
}

function markdownReport(payload) {
  return [
    '# Public Catalog Import Input Preflight v0.1',
    '',
    `Generated at: ${payload.generatedAt}`,
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No delete.',
    '- No importer apply.',
    '- Local input inspection only.',
    '',
    '## Ready',
    '',
    `readyForPublicCatalogImportPreview: ${payload.readyForPublicCatalogImportPreview}`,
    '',
    '## Files',
    '',
    '| key | required | exists | type | count | path |',
    '|---|---:|---:|---|---:|---|',
    ...payload.files.map((item) => `| ${item.key} | ${item.required} | ${item.exists} | ${item.type} | ${item.count ?? ''} | ${item.path} |`),
    '',
    '## Blockers',
    '',
    ...(payload.blockers.length ? payload.blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Warnings',
    '',
    ...(payload.warnings.length ? payload.warnings.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Merge group sample keys',
    '',
    '```json',
    JSON.stringify(payload.mergeGroupSampleKeys, null, 2),
    '```',
    '',
    '## Merge group first sample',
    '',
    '```json',
    JSON.stringify(payload.mergeGroupFirstSample, null, 2),
    '```',
    '',
    '## Summary snippets',
    '',
    '```json',
    JSON.stringify(payload.summarySnippets, null, 2),
    '```',
    '',
  ].join('\n')
}

const generatedAt = new Date().toISOString()
const blockers = []
const warnings = []
const fileReports = []
const summarySnippets = {}

let mergeGroupSampleKeys = []
let mergeGroupFirstSample = null

for (const file of files) {
  const exists = fileExists(file.path)
  const report = {
    key: file.key,
    required: file.required,
    path: file.path,
    type: file.type,
    exists,
    count: null,
    sampleKeys: [],
  }

  if (!exists) {
    if (file.required) blockers.push(`Missing required input: ${file.key} at ${file.path}`)
    else warnings.push(`Missing optional input: ${file.key} at ${file.path}`)
    fileReports.push(report)
    continue
  }

  try {
    if (file.type === 'jsonl') {
      const jsonl = readJsonlSample(file.path, 3)
      report.count = jsonl.count
      report.sampleKeys = Array.from(collectKeys(jsonl.sample[0] || {})).sort()

      if (file.key === 'mergeGroupsV2DryrunV02') {
        mergeGroupSampleKeys = report.sampleKeys
        mergeGroupFirstSample = compactSample(jsonl.sample[0] || null)
      }
    }

    if (file.type === 'json') {
      const json = readJson(file.path)
      summarySnippets[file.key] = compactSample(json)
      report.sampleKeys = Array.from(collectKeys(json)).sort()
    }

    if (file.type === 'text') {
      const text = fs.readFileSync(file.path, 'utf8')
      report.count = text.split(/\r?\n/).length
      summarySnippets[file.key] = text.slice(0, 1200)
    }
  } catch (error) {
    const message = `Failed to read ${file.key}: ${String(error?.message || error)}`
    if (file.required) blockers.push(message)
    else warnings.push(message)
  }

  fileReports.push(report)
}

const readyForPublicCatalogImportPreview = blockers.length === 0

const payload = {
  generatedAt,
  readyForPublicCatalogImportPreview,
  files: fileReports,
  blockers,
  warnings,
  mergeGroupSampleKeys,
  mergeGroupFirstSample,
  summarySnippets,
  safety: {
    payloadWrite: false,
    postgresqlWrite: false,
    delete: false,
    importerApply: false,
  },
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outJson, JSON.stringify(payload, null, 2), 'utf8')
fs.writeFileSync(outMd, markdownReport(payload), 'utf8')

console.log(JSON.stringify({
  ok: readyForPublicCatalogImportPreview,
  blockers: blockers.length,
  warnings: warnings.length,
  outputs: {
    json: outJson,
    md: outMd,
  },
}, null, 2))

process.exitCode = readyForPublicCatalogImportPreview ? 0 : 1
