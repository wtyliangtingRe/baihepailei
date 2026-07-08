#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'vndb-yuri-create-candidates-v0.3'
const BASE_SCRIPT = 'scripts/import/plan-vndb-yuri-create-candidates-v02.mjs'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-yuri-create-candidates'
const TITLE_SEPARATOR_RE = /[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu
const INVISIBLE_TITLE_RE = /[\u200b\u200c\u200d\u2060\ufeff]/gu
const CJKISH_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\u31f0-\u31ffー\uac00-\ud7af]/u
const CJKISH_BLOCK = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\u31f0-\\u31ffー\\uac00-\\ud7af]'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function countBy(items, key) {
  const out = {}
  for (const item of items) {
    const value = typeof key === 'function' ? key(item) : item?.[key]
    const name = val(value) || 'missing'
    out[name] = (out[name] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function cleanLine(value) {
  return val(value)
    .normalize('NFKC')
    .replace(INVISIBLE_TITLE_RE, '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(TITLE_SEPARATOR_RE, ' ')
    .trim()
}

function repairInternalTitleSpaces(value) {
  let text = cleanLine(value)
  for (let i = 0; i < 10; i += 1) {
    const next = text
      .replace(new RegExp(`(${CJKISH_BLOCK})[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+(${CJKISH_BLOCK})`, 'gu'), '$1$2')
      .replace(new RegExp(`(${CJKISH_BLOCK})[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+([）》」』】、。！？：；,.!?])`, 'gu'), '$1$2')
      .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([!！?？])/gu, '$1')
      .replace(/([A-Za-z])[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+([級级])/gu, '$1$2')
      .replace(TITLE_SEPARATOR_RE, ' ')
      .trim()
    if (next === text) break
    text = next
  }
  return text
}

function cleanTitleText(value) {
  return repairInternalTitleSpaces(value)
}

function normalizeText(value) {
  return cleanTitleText(value).normalize('NFKC').toLowerCase()
}

function uniqueBy(values, getKey = normalizeText) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const clean = cleanTitleText(item)
    const key = getKey(clean)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

function cleanUrl(value) {
  return val(value)
    .replace(/[\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/gu, '')
    .replace(/\/+$/u, '')
}

function suspiciousTitleSpaceScore(value) {
  const text = cleanLine(value)
  let score = 0
  score += (text.match(new RegExp(`${CJKISH_BLOCK}[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+${CJKISH_BLOCK}`, 'gu')) || []).length
  score += (text.match(new RegExp(`${CJKISH_BLOCK}[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+[）》」』】、。！？：；,.!?]`, 'gu')) || []).length
  score += (text.match(/[A-Za-z][\s\u00a0\u1680\u180e\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+[級级]/gu) || []).length
  return score
}

function titleValues(row) {
  return [
    ...list(row?.titleCandidates),
    ...list(row?.fieldAdditions?.searchTextAdditions),
    row?.createCandidatePreview?.title,
    row?.createCandidatePreview?.originalTitle,
    ...list(row?.createCandidatePreview?.searchTextAdditions),
  ].map(val).filter(Boolean)
}

function sanitizeSourceLinks(rows) {
  return list(rows).map((item) => ({ ...item, label: cleanLine(item?.label), url: cleanUrl(item?.url) })).filter((item) => item.url)
}

function sanitizeCandidateSources(rows) {
  return list(rows).map((item) => ({
    ...item,
    source: val(item?.source),
    label: cleanLine(item?.label),
    externalId: val(item?.externalId),
    url: cleanUrl(item?.url),
    note: cleanLine(item?.note),
  })).filter((item) => item.source || item.externalId || item.url || item.note)
}

function sanitizeRow(row) {
  const original = JSON.stringify(row)
  const out = JSON.parse(original)
  out.titleCandidates = uniqueBy(out.titleCandidates)
  if (out.fieldAdditions) {
    out.fieldAdditions.searchTextAdditions = uniqueBy(out.fieldAdditions.searchTextAdditions)
    out.fieldAdditions.sourceLinks = sanitizeSourceLinks(out.fieldAdditions.sourceLinks)
    out.fieldAdditions.candidateSources = sanitizeCandidateSources(out.fieldAdditions.candidateSources)
  }
  if (out.createCandidatePreview) {
    out.createCandidatePreview.title = cleanTitleText(out.createCandidatePreview.title)
    out.createCandidatePreview.originalTitle = cleanTitleText(out.createCandidatePreview.originalTitle)
    out.createCandidatePreview.searchTextAdditions = uniqueBy(out.createCandidatePreview.searchTextAdditions)
    out.createCandidatePreview.sourceLinks = sanitizeSourceLinks(out.createCandidatePreview.sourceLinks)
    out.createCandidatePreview.candidateSources = sanitizeCandidateSources(out.createCandidatePreview.candidateSources)
  }
  if (out.yuriCreateCandidate?.title) out.yuriCreateCandidate.title = cleanTitleText(out.yuriCreateCandidate.title)
  const sanitized = JSON.stringify(out)
  const suspiciousValues = titleValues(out).filter((item) => suspiciousTitleSpaceScore(item) > 0 || (CJKISH_RE.test(item) && /^\s|\s$/u.test(item)))
  const repaired = original !== sanitized
  out.yuriCreateCandidateV3 = {
    version: VERSION,
    status: suspiciousValues.length ? 'spacing_repair_review' : out.yuriCreateCandidateV2?.status,
    repairedTitleFields: repaired,
    suspiciousTitleValuesAfterRepair: suspiciousValues.slice(0, 20),
    firstWaveEligible: out.yuriCreateCandidateV2?.status === 'ordinary_romance_create_review' && suspiciousValues.length === 0,
  }
  return out
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const outDir = String(args['out-dir'] || args.outDir || DEFAULT_OUT_DIR)

  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...argv], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const v2SummaryFile = `${outDir}/vndb-yuri-create-candidates-v02-summary.json`
  const v2RowsFile = `${outDir}/vndb-yuri-create-candidates-v02.rows.jsonl`
  const v2Summary = fs.existsSync(v2SummaryFile) ? JSON.parse(fs.readFileSync(v2SummaryFile, 'utf8')) : {}
  const rows = readJsonl(v2RowsFile).map(sanitizeRow)

  const repairedRows = rows.filter((row) => row.yuriCreateCandidateV3.repairedTitleFields)
  const spacingReviewRows = rows.filter((row) => row.yuriCreateCandidateV3.status === 'spacing_repair_review')
  const firstWave = rows.filter((row) => row.yuriCreateCandidateV3.firstWaveEligible)
  const ordinaryRomance = rows.filter((row) => row.yuriCreateCandidateV2?.status === 'ordinary_romance_create_review' && row.yuriCreateCandidateV3.status !== 'spacing_repair_review')
  const sensitiveRomance = rows.filter((row) => row.yuriCreateCandidateV2?.status === 'sensitive_romance_create_review' && row.yuriCreateCandidateV3.status !== 'spacing_repair_review')
  const sexOnly = rows.filter((row) => row.yuriCreateCandidateV2?.status === 'lesbian_sex_only_review' && row.yuriCreateCandidateV3.status !== 'spacing_repair_review')
  const other = rows.filter((row) => String(row.yuriCreateCandidateV2?.status || '').startsWith('other_') && row.yuriCreateCandidateV3.status !== 'spacing_repair_review')

  const outputs = {
    rows: `${outDir}/vndb-yuri-create-candidates-v03.rows.jsonl`,
    firstWave: `${outDir}/vndb-yuri-create-candidates-v03-first-wave-ordinary-romance.jsonl`,
    ordinaryRomance: `${outDir}/vndb-yuri-create-candidates-v03-ordinary-romance-review.jsonl`,
    sensitiveRomance: `${outDir}/vndb-yuri-create-candidates-v03-sensitive-romance-review.jsonl`,
    sexOnly: `${outDir}/vndb-yuri-create-candidates-v03-lesbian-sex-only-review.jsonl`,
    other: `${outDir}/vndb-yuri-create-candidates-v03-other-yuri-review.jsonl`,
    repaired: `${outDir}/vndb-yuri-create-candidates-v03-repaired-title-fields.jsonl`,
    spacingReview: `${outDir}/vndb-yuri-create-candidates-v03-spacing-repair-review.jsonl`,
    summary: `${outDir}/vndb-yuri-create-candidates-v03-summary.json`,
  }

  const summary = {
    ...v2Summary,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    upstreamVersion: v2Summary.version,
    yuriCreateCandidateRows: rows.length,
    titleFieldRepairedRows: repairedRows.length,
    spacingRepairReviewRows: spacingReviewRows.length,
    firstWaveCreateReviewRows: firstWave.length,
    ordinaryRomanceCreateReviewRows: ordinaryRomance.length,
    sensitiveRomanceCreateReviewRows: sensitiveRomance.length,
    lesbianSexOnlyReviewRows: sexOnly.length,
    otherYuriReviewRows: other.length,
    byV3Status: countBy(rows, (row) => row.yuriCreateCandidateV3.status),
    byV2StatusAfterSanitize: countBy(rows.filter((row) => row.yuriCreateCandidateV3.status !== 'spacing_repair_review'), (row) => row.yuriCreateCandidateV2?.status),
    outputs,
    safety: {
      ...(v2Summary.safety || {}),
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      firstWaveRowsUseSanitizedTitleFields: true,
      spacingRepairRowsExcludedFromFirstWave: true,
    },
    nextStep: 'Review the v03 first-wave sample. Do not create from v01/v02 candidate files; use v03 outputs after title spacing repair.',
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.firstWave, firstWave)
  writeJsonl(outputs.ordinaryRomance, ordinaryRomance)
  writeJsonl(outputs.sensitiveRomance, sensitiveRomance)
  writeJsonl(outputs.sexOnly, sexOnly)
  writeJsonl(outputs.other, other)
  writeJsonl(outputs.repaired, repairedRows)
  writeJsonl(outputs.spacingReview, spacingReviewRows)
  writeJson(outputs.summary, summary)

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main()
