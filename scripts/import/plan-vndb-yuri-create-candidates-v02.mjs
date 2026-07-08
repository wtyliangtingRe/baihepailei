#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'vndb-yuri-create-candidates-v0.2'
const BASE_SCRIPT = 'scripts/import/plan-vndb-yuri-create-candidates-v01.mjs'
const DEFAULT_OUT_DIR = 'data_local/staging/vndb-yuri-create-candidates'
const ROMANCE_TAG_IDS = new Set(['g97'])
const SEX_ONLY_TAG_IDS = new Set(['g82'])

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

function unique(values) {
  return [...new Set((values || []).filter(Boolean))]
}

function tags(row) {
  return list(row?.yuriCreateCandidate?.matchedTags)
}

function hasRomanceTag(row) {
  return tags(row).some((tag) => ROMANCE_TAG_IDS.has(val(tag.id).toLowerCase()))
}

function hasSexOnlyTag(row) {
  return tags(row).some((tag) => SEX_ONLY_TAG_IDS.has(val(tag.id).toLowerCase()))
}

function sensitiveReasons(row) {
  return list(row?.yuriCreateCandidate?.sensitiveReasons).map(val).filter(Boolean)
}

function classify(row) {
  const romance = hasRomanceTag(row)
  const sexOnly = hasSexOnlyTag(row) && !romance
  const sensitive = sensitiveReasons(row).length > 0
  if (romance && !sensitive) return 'ordinary_romance_create_review'
  if (romance && sensitive) return 'sensitive_romance_create_review'
  if (sexOnly) return 'lesbian_sex_only_review'
  return sensitive ? 'other_sensitive_yuri_review' : 'other_ordinary_yuri_review'
}

function main() {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)
  const outDir = String(args['out-dir'] || args.outDir || DEFAULT_OUT_DIR)

  const run = spawnSync(process.execPath, [BASE_SCRIPT, ...argv], { stdio: 'inherit' })
  if (run.status) process.exit(run.status || 1)

  const v1SummaryFile = `${outDir}/vndb-yuri-create-candidates-v01-summary.json`
  const v1RowsFile = `${outDir}/vndb-yuri-create-candidates-v01.rows.jsonl`
  const v1Summary = fs.existsSync(v1SummaryFile) ? JSON.parse(fs.readFileSync(v1SummaryFile, 'utf8')) : {}
  const rows = readJsonl(v1RowsFile).map((row) => {
    const status = classify(row)
    return {
      ...row,
      yuriCreateCandidateV2: {
        version: VERSION,
        status,
        hasRomanceTag: hasRomanceTag(row),
        hasSexOnlyTag: hasSexOnlyTag(row),
        sensitiveReasons: sensitiveReasons(row),
        note: status === 'ordinary_romance_create_review'
          ? 'First-wave candidate: no existing Work match, VNDB Girl x Girl Romance tag, and no sensitive guard reason detected.'
          : 'Report-only. Not eligible for first-wave creation without separate review/allowlist.',
      },
    }
  })

  const ordinaryRomance = rows.filter((row) => row.yuriCreateCandidateV2.status === 'ordinary_romance_create_review')
  const sensitiveRomance = rows.filter((row) => row.yuriCreateCandidateV2.status === 'sensitive_romance_create_review')
  const sexOnly = rows.filter((row) => row.yuriCreateCandidateV2.status === 'lesbian_sex_only_review')
  const other = rows.filter((row) => row.yuriCreateCandidateV2.status.startsWith('other_'))
  const firstWave = ordinaryRomance

  const outputs = {
    rows: `${outDir}/vndb-yuri-create-candidates-v02.rows.jsonl`,
    firstWave: `${outDir}/vndb-yuri-create-candidates-v02-first-wave-ordinary-romance.jsonl`,
    ordinaryRomance: `${outDir}/vndb-yuri-create-candidates-v02-ordinary-romance-review.jsonl`,
    sensitiveRomance: `${outDir}/vndb-yuri-create-candidates-v02-sensitive-romance-review.jsonl`,
    sexOnly: `${outDir}/vndb-yuri-create-candidates-v02-lesbian-sex-only-review.jsonl`,
    other: `${outDir}/vndb-yuri-create-candidates-v02-other-yuri-review.jsonl`,
    summary: `${outDir}/vndb-yuri-create-candidates-v02-summary.json`,
  }

  const summary = {
    ...v1Summary,
    generatedAt: new Date().toISOString(),
    version: VERSION,
    upstreamVersion: v1Summary.version,
    yuriCreateCandidateRows: rows.length,
    romanceCreateCandidateRows: rows.filter(hasRomanceTag).length,
    ordinaryRomanceCreateReviewRows: ordinaryRomance.length,
    sensitiveRomanceCreateReviewRows: sensitiveRomance.length,
    lesbianSexOnlyReviewRows: sexOnly.length,
    otherYuriReviewRows: other.length,
    firstWaveCreateReviewRows: firstWave.length,
    byV2Status: countBy(rows, (row) => row.yuriCreateCandidateV2.status),
    byMatchedTagId: countBy(rows.flatMap((row) => tags(row).map((tag) => tag.id)), (item) => item),
    byMatchedTagLabel: countBy(rows.flatMap((row) => tags(row).map((tag) => tag.label || tag.id)), (item) => item),
    bySensitiveReasonV2: countBy(rows.flatMap((row) => sensitiveReasons(row)), (item) => item),
    outputs,
    safety: {
      ...(v1Summary.safety || {}),
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      deletesWorks: false,
      reportOnly: true,
      firstWaveRequiresRomanceTagG97: true,
      lesbianSexOnlyRowsExcludedFromFirstWave: true,
      sensitiveRowsExcludedFromFirstWave: true,
    },
    nextStep: 'Review the first-wave ordinary romance sample first. Lesbian Sex only and sensitive romance rows are separated and should not be created in the first wave.',
  }

  writeJsonl(outputs.rows, rows)
  writeJsonl(outputs.firstWave, firstWave)
  writeJsonl(outputs.ordinaryRomance, ordinaryRomance)
  writeJsonl(outputs.sensitiveRomance, sensitiveRomance)
  writeJsonl(outputs.sexOnly, sexOnly)
  writeJsonl(outputs.other, other)
  writeJson(outputs.summary, summary)

  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main()
