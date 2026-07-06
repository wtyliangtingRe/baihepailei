#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PREVIEW = 'data_local/staging/work-merge/work-merge-safe-preview-v01.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const VERSION = 'work-merge-safe-strict-v0.1'

const GENERIC_TITLE_KEYS = new Set([
  'game',
  'her',
  'green',
  'prism',
  'seasons',
  'perfectday',
  'schoolgirl',
])

function val(value) {
  return String(value ?? '').trim()
}

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

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }
  return { rows, read, failed }
}

function titleKey(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/gu, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function words(value) {
  return val(value)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/gu)
    .map((word) => word.trim())
    .filter(Boolean)
}

function titlesOf(item) {
  const values = [
    item?.master?.title,
    ...(Array.isArray(item?.master?.titles) ? item.master.titles : []),
    ...((item?.supplements || []).flatMap((doc) => [doc.title, ...(Array.isArray(doc.titles) ? doc.titles : [])])),
    ...(Array.isArray(item?.preservedDataPreview?.titles) ? item.preservedDataPreview.titles : []),
  ]
  return [...new Set(values.map(val).filter(Boolean))]
}

function isGenericTitle(title) {
  const key = titleKey(title)
  if (!key) return false
  if (GENERIC_TITLE_KEYS.has(key)) return true
  const titleWords = words(title)
  if (key.length <= 3) return true
  if (titleWords.length === 1 && key.length <= 6 && /^[a-z0-9]+$/u.test(key)) return true
  if (titleWords.length <= 2 && key.length <= 10 && /^[a-z0-9]+$/u.test(key)) return true
  return false
}

function hasOnlyCaseOrPunctuationDifference(item) {
  const titles = titlesOf(item)
  if (titles.length < 2) return false
  const keys = new Set(titles.map(titleKey).filter(Boolean))
  if (keys.size !== 1) return false
  const raw = new Set(titles.map((title) => val(title)).filter(Boolean))
  return raw.size > 1
}

function classify(item) {
  const titles = titlesOf(item)
  const reasons = []
  const reviewReasons = []

  if (item.reviewBucket !== 'safe') reviewReasons.push('not_safe_preview')
  if (item.groupSize !== 2) reviewReasons.push('not_one_to_one')
  if ((item.warnings || []).length) reviewReasons.push('preview_has_warnings')

  const genericTitles = titles.filter(isGenericTitle)
  if (genericTitles.length) reviewReasons.push('generic_or_short_title')
  if (hasOnlyCaseOrPunctuationDifference(item)) reasons.push('case_or_punctuation_variant')

  const masterSource = val(item.master?.source)
  const supplementSources = (item.supplements || []).map((doc) => val(doc.source)).filter(Boolean)
  if (masterSource !== 'bangumi') reviewReasons.push('master_not_bangumi')
  if (supplementSources.length !== 1 || supplementSources[0] !== 'anilist') reviewReasons.push('supplement_not_single_anilist')

  const output = {
    ...item,
    strictBucket: reviewReasons.length ? 'review' : 'safe',
    strictReasons: reasons,
    strictReviewReasons: [...new Set(reviewReasons)],
    strictReviewTitleSamples: genericTitles,
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }
  return output
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function markdown(summary, samples) {
  return [
    '# Strict Safe Work Merge Refinement v0.1',
    '',
    'Read-only refinement for safe same-work previews. It moves generic or short titles into manual review before any future write step.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- previewsRead: ${summary.previewsRead}`,
    `- previewsLoaded: ${summary.previewsLoaded}`,
    `- parseFailures: ${summary.parseFailures}`,
    `- strictSafeGroups: ${summary.strictSafeGroups}`,
    `- strictReviewGroups: ${summary.strictReviewGroups}`,
    '',
    '## Safety',
    '',
    '- Read local safe preview report only.',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '',
    '## Review reasons',
    '',
    '| Reason | Count |',
    '|---|---:|',
    ...Object.entries(summary.byReviewReason).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = String(args.preview || DEFAULT_PREVIEW)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  if (!fs.existsSync(inputPath)) throw new Error(`safe preview file not found: ${inputPath}`)

  const input = await readJsonl(inputPath)
  const classified = input.rows.map(classify)
  const strictSafe = classified.filter((item) => item.strictBucket === 'safe')
  const strictReview = classified.filter((item) => item.strictBucket === 'review')
  const reviewReasons = strictReview.flatMap((item) => item.strictReviewReasons || [])

  const outputs = {
    safe: path.join(outDir, 'work-merge-safe-strict-v01-safe.groups.jsonl'),
    review: path.join(outDir, 'work-merge-safe-strict-v01-review.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-safe-strict-v01-summary.json'),
    json: path.join(outDir, 'work-merge-safe-strict-v01.json'),
    md: path.join(outDir, 'work-merge-safe-strict-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0,
    inputFile: inputPath,
    previewsRead: input.read,
    previewsLoaded: input.rows.length,
    parseFailures: input.failed,
    strictSafeGroups: strictSafe.length,
    strictReviewGroups: strictReview.length,
    byReviewReason: countBy(reviewReasons, (value) => value),
    outputs,
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  const samples = { strictSafe: strictSafe.slice(0, 20), strictReview: strictReview.slice(0, 30) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.safe, strictSafe.map((item) => JSON.stringify(item)).join('\n') + (strictSafe.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.review, strictReview.map((item) => JSON.stringify(item)).join('\n') + (strictReview.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
