#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'bangumi-media-type-repair-plan-v0.1'
const DEFAULT_INPUT = 'data_local/staging/work-source-metadata/bangumi-media-coverage-audit-v01.rows.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-source-metadata'
const TARGETS = new Set(['anime', 'manga', 'novel', 'game'])
const MATCH_STATUSES = new Set(['external_id_matched', 'title_exact_unique'])

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

function clean(value) {
  return String(value ?? '')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = String(typeof getKey === 'function' ? getKey(row) : row[getKey] || 'missing')
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function uniqueBy(rows, keyFn) {
  const seen = new Set()
  const out = []
  for (const row of rows.filter(Boolean)) {
    const key = keyFn(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function selectedMatches(row) {
  const matches = Array.isArray(row.matchedWorks) ? row.matchedWorks : []
  if (row.status === 'external_id_matched') return matches.filter((work) => clean(work.match) === 'external_id')
  if (row.status === 'title_exact_unique') return matches.filter((work) => clean(work.match) === 'title_exact')
  return []
}

function buildPlan(auditRows) {
  const workRows = []
  const skippedRows = []

  for (const row of auditRows) {
    const target = clean(row.rawBucket)
    if (!TARGETS.has(target)) {
      skippedRows.push({ bangumiId: row.bangumiId, rawBucket: row.rawBucket, status: row.status, reason: 'unsupported_raw_bucket' })
      continue
    }
    if (!MATCH_STATUSES.has(row.status)) {
      skippedRows.push({ bangumiId: row.bangumiId, rawBucket: row.rawBucket, status: row.status, reason: 'unsupported_status' })
      continue
    }

    for (const work of selectedMatches(row)) {
      if (!work?.id) continue
      workRows.push({
        workId: work.id,
        slug: work.slug,
        title: work.title,
        bangumiId: row.bangumiId,
        rawBucket: target,
        targetMediaGroup: target,
        targetMediaType: target,
        matchStatus: row.status,
        matchMode: work.match,
        currentMediaGroup: clean(work.mediaGroup) || 'unknown',
        currentMediaType: clean(work.mediaType) || 'unknown',
        currentFormat: clean(work.format) || 'unknown',
        isLiteVisible: work.isLiteVisible,
      })
    }
  }

  const byWork = new Map()
  for (const row of workRows) {
    if (!byWork.has(row.workId)) byWork.set(row.workId, [])
    byWork.get(row.workId).push(row)
  }

  const plans = []
  const blocked = []
  for (const [workId, rows] of byWork.entries()) {
    const targets = Array.from(new Set(rows.map((row) => row.targetMediaGroup)))
    const sample = rows[0]
    if (targets.length !== 1) {
      blocked.push({ workId, slug: sample.slug, title: sample.title, reason: 'conflicting_targets', targets, rows })
      continue
    }
    const target = targets[0]
    const currentGroups = Array.from(new Set(rows.map((row) => row.currentMediaGroup)))
    const currentTypes = Array.from(new Set(rows.map((row) => row.currentMediaType)))
    const needsChange = !currentGroups.includes(target) || currentGroups.length > 1 || !currentTypes.includes(target) || currentTypes.length > 1
    plans.push({
      workId,
      slug: sample.slug,
      title: sample.title,
      targetMediaGroup: target,
      targetMediaType: target,
      currentMediaGroups: currentGroups,
      currentMediaTypes: currentTypes,
      needsChange,
      matchedBangumiIds: uniqueBy(rows, (row) => row.bangumiId).map((row) => row.bangumiId),
      matches: uniqueBy(rows, (row) => `${row.bangumiId}|${row.matchMode}`),
    })
  }

  return { plans, blocked, skippedRows }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputFile = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  const auditRows = readJsonl(inputFile)
  const { plans, blocked, skippedRows } = buildPlan(auditRows)
  const changePlans = plans.filter((plan) => plan.needsChange)
  const alreadyCurrent = plans.filter((plan) => !plan.needsChange)

  const outputs = {
    plans: path.join(outDir, 'bangumi-media-type-repair-v01-plans.jsonl'),
    alreadyCurrent: path.join(outDir, 'bangumi-media-type-repair-v01-already-current.jsonl'),
    blocked: path.join(outDir, 'bangumi-media-type-repair-v01-blocked.jsonl'),
    skipped: path.join(outDir, 'bangumi-media-type-repair-v01-skipped.jsonl'),
    summary: path.join(outDir, 'bangumi-media-type-repair-v01-summary.json'),
    json: path.join(outDir, 'bangumi-media-type-repair-v01.json'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: true,
    inputFile,
    auditRowsRead: auditRows.length,
    plannedWorks: plans.length,
    needsChange: changePlans.length,
    alreadyCurrent: alreadyCurrent.length,
    blockedWorks: blocked.length,
    skippedRows: skippedRows.length,
    byTarget: countBy(plans, 'targetMediaGroup'),
    byCurrentMediaGroup: countBy(plans.flatMap((plan) => plan.currentMediaGroups), (value) => value),
    byChangeTarget: countBy(changePlans, 'targetMediaGroup'),
    byBlocker: countBy(blocked, 'reason'),
    bySkippedReason: countBy(skippedRows, 'reason'),
    outputs,
    safety: {
      readOnly: true,
      localReportWrite: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.plans, changePlans.map((row) => JSON.stringify(row)).join('\n') + (changePlans.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.alreadyCurrent, alreadyCurrent.map((row) => JSON.stringify(row)).join('\n') + (alreadyCurrent.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((row) => JSON.stringify(row)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.skipped, skippedRows.map((row) => JSON.stringify(row)).join('\n') + (skippedRows.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify({ ok: true, summary, samples: { plans: changePlans.slice(0, 50), blocked: blocked.slice(0, 50), alreadyCurrent: alreadyCurrent.slice(0, 50) } }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary, outputs }, null, 2))
}

main()
