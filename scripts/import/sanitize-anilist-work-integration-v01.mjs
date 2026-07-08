#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'anilist-work-integration-sanitize-v0.1'
const DEFAULT_OUT_DIR = 'data_local/staging/anilist-work-integration'
const FILES = {
  rows: 'anilist-work-integration-v01.rows.jsonl',
  ready: 'anilist-work-integration-v01-ready.jsonl',
  blocked: 'anilist-work-integration-v01-blocked.jsonl',
  createCandidates: 'anilist-work-integration-v01-create-candidates.jsonl',
  yuriCreateCandidates: 'anilist-work-integration-v01-yuri-create-candidates.jsonl',
  sample: 'anilist-work-integration-v01-sample.jsonl',
}
const SUMMARY = 'anilist-work-integration-v01-summary.json'
const TITLE_SEPARATOR_RE = /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu
const INVISIBLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu
const CJKISH = '\\u3400-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\u31f0-\\u31ffー\\uac00-\\ud7af'
const CJKISH_SPACING_RE = new RegExp(`([${CJKISH}])${TITLE_SEPARATOR_RE.source}+([${CJKISH}])`, 'gu')
const CJKISH_BEFORE_PUNCT_RE = new RegExp(`([${CJKISH}])${TITLE_SEPARATOR_RE.source}+([）》」』】、。！？：；,.!?])`, 'gu')
const PUNCT_BEFORE_CJKISH_RE = new RegExp(`([（《「『【])${TITLE_SEPARATOR_RE.source}+([${CJKISH}])`, 'gu')
const ASCII_BEFORE_CJK_SUFFIX_RE = /([A-Za-z0-9])\s+([級级話集章部期季篇編卷巻回弾弹])\b/gu

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}
function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(TITLE_SEPARATOR_RE, ' ')
    .trim()
}
function repairTitleLine(value) {
  let text = cleanLine(value)
  for (let i = 0; i < 6; i += 1) {
    const before = text
    text = text
      .replace(CJKISH_SPACING_RE, '$1$2')
      .replace(CJKISH_BEFORE_PUNCT_RE, '$1$2')
      .replace(PUNCT_BEFORE_CJKISH_RE, '$1$2')
      .replace(ASCII_BEFORE_CJK_SUFFIX_RE, '$1$2')
      .replace(TITLE_SEPARATOR_RE, ' ')
      .trim()
    if (text === before) break
  }
  return text
}
function normalizeKey(value) { return repairTitleLine(value).toLowerCase() }
function uniqueTitleLines(values) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const clean = repairTitleLine(item)
    const key = normalizeKey(clean)
    if (!key || key === '[object object]' || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}
function splitSearchText(value) {
  return val(value).split(/[\r\n|]+/u).filter(Boolean)
}
function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(CJKISH_SPACING_RE) || []).length
  score += (text.match(CJKISH_BEFORE_PUNCT_RE) || []).length
  score += (text.match(PUNCT_BEFORE_CJKISH_RE) || []).length
  score += (text.match(/\[object Object\]/u) || []).length
  return score
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
function sanitizeString(value, stats) {
  const before = val(value)
  const after = repairTitleLine(before)
  if (before !== after) stats.repairedTitleStrings += 1
  if (/\[object Object\]/u.test(before)) stats.objectObjectArtifactsRemoved += 1
  if (suspiciousTitleSpaceScore(after) > 0) stats.residualSuspiciousTitleStrings += 1
  return after
}
function sanitizePlan(row, stats) {
  const out = { ...row }
  if (Array.isArray(out.titleCandidates)) out.titleCandidates = uniqueTitleLines(out.titleCandidates)

  if (out.fieldUpdates && typeof out.fieldUpdates === 'object') {
    out.fieldUpdates = { ...out.fieldUpdates }
    if ('searchText' in out.fieldUpdates) {
      const before = val(out.fieldUpdates.searchText)
      const after = uniqueTitleLines(splitSearchText(before)).join('\n')
      if (before !== after) stats.repairedSearchTextRows += 1
      out.fieldUpdates.searchText = after
    }
  }

  if (out.createCandidatePreview && typeof out.createCandidatePreview === 'object') {
    out.createCandidatePreview = { ...out.createCandidatePreview }
    for (const key of ['title', 'originalTitle']) {
      if (key in out.createCandidatePreview) out.createCandidatePreview[key] = sanitizeString(out.createCandidatePreview[key], stats)
    }
    if (Array.isArray(out.createCandidatePreview.searchTextAdditions)) {
      const before = JSON.stringify(out.createCandidatePreview.searchTextAdditions)
      out.createCandidatePreview.searchTextAdditions = uniqueTitleLines(out.createCandidatePreview.searchTextAdditions)
      if (JSON.stringify(out.createCandidatePreview.searchTextAdditions) !== before) stats.repairedSearchTextAdditionRows += 1
    }
  }

  const titleValues = [
    ...list(out.titleCandidates),
    ...splitSearchText(out.fieldUpdates?.searchText),
    out.createCandidatePreview?.title,
    out.createCandidatePreview?.originalTitle,
    ...list(out.createCandidatePreview?.searchTextAdditions),
  ].filter(Boolean)
  const residual = titleValues.filter((item) => suspiciousTitleSpaceScore(item) > 0)
  if (residual.length) {
    out.blockers = [...new Set([...(out.blockers || []), 'suspicious_title_spacing_after_sanitize'])]
    out.suspiciousTitleValuesAfterSanitize = residual.slice(0, 20)
    stats.rowsWithResidualSuspiciousTitles += 1
    if (out.planStatus === 'ready_for_apply_review') out.planStatus = 'blocked_or_review_required'
  }

  out.sanitizedBy = VERSION
  return out
}
function sanitizeRows(rows, stats) {
  return rows.map((row) => sanitizePlan(row, stats))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const stats = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    outDir,
    filesProcessed: 0,
    rowsProcessed: 0,
    repairedTitleStrings: 0,
    repairedSearchTextRows: 0,
    repairedSearchTextAdditionRows: 0,
    objectObjectArtifactsRemoved: 0,
    residualSuspiciousTitleStrings: 0,
    rowsWithResidualSuspiciousTitles: 0,
  }

  const sanitizedByFile = {}
  for (const [key, name] of Object.entries(FILES)) {
    const file = path.join(outDir, name)
    if (!fs.existsSync(file)) continue
    const rows = readJsonl(file)
    const sanitized = sanitizeRows(rows, stats)
    stats.filesProcessed += 1
    stats.rowsProcessed += rows.length
    sanitizedByFile[key] = sanitized.length
    writeJsonl(file, sanitized)
  }

  const summaryFile = path.join(outDir, SUMMARY)
  if (fs.existsSync(summaryFile)) {
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))
    const ready = readJsonl(path.join(outDir, FILES.ready)).filter((row) => row.planStatus === 'ready_for_apply_review')
    const blocked = readJsonl(path.join(outDir, FILES.blocked))
    const rows = readJsonl(path.join(outDir, FILES.rows))
    const allBlocked = rows.filter((row) => row.planStatus !== 'ready_for_apply_review')
    summary.version = `${summary.version}+sanitized`
    summary.sanitizedAt = stats.generatedAt
    summary.sanitizerVersion = VERSION
    summary.readyRows = ready.length
    summary.blockedRows = allBlocked.length
    summary.byPlanStatus = countBy(rows, 'planStatus')
    summary.byBlocker = countBy(allBlocked.flatMap((row) => row.blockers || []), (item) => item)
    summary.byWarning = countBy(rows.flatMap((row) => row.warnings || []), (item) => item)
    summary.byChangedField = countBy(ready.flatMap((row) => row.changedFields || []), (item) => item)
    summary.sanitizer = { ...stats, sanitizedByFile, blockedFileRows: blocked.length }
    summary.safety = {
      ...(summary.safety || {}),
      repairsCjkTitleSpacingBeforeApply: true,
      removesObjectObjectTitleArtifactsBeforeApply: true,
      blocksResidualSuspiciousTitleSpacing: true,
    }
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8')
  }

  console.log(JSON.stringify({ ok: stats.rowsWithResidualSuspiciousTitles === 0, summary: stats }, null, 2))
}

main()
