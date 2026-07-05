#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const CANDIDATES = 'data_local/staging/identity/identity-match-candidates-v01.jsonl'
const OUT = 'data_local/staging/identity'

function val(value) {
  return String(value ?? '').trim()
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const text = line.trim()
    if (!text) continue
    try {
      rows.push(JSON.parse(text))
    } catch {
      failed += 1
    }
    read += 1
  }

  return { rows, read, failed }
}

function countBy(rows, key) {
  const out = {}
  for (const row of rows) {
    const value = val(row[key]) || 'missing'
    out[value] = (out[value] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  )
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ')
}

function asList(value) {
  return Array.isArray(value) ? value.map((item) => val(item)).filter(Boolean) : []
}

function hasVeryShortTitleSignal(row) {
  const normalizedTitle = val(row.normalizedTitle)
  const reasons = [...asList(row.scoreReasons), ...asList(row.conflictReasons)]
  return row.candidateType === 'title_match'
    && (
      normalizedTitle.length > 0 && normalizedTitle.length <= 2
      || reasons.some((reason) => reason.toLowerCase().includes('very short title'))
    )
}

function isTitleNoiseOnlyReason(reason) {
  const text = val(reason).toLowerCase()
  return text.includes('very short title')
    || text.includes('title-only')
    || text.includes('title only')
    || text.includes('normalized title match')
}

function isTitleNoisePromotedToConflict(row) {
  if (row.candidateType !== 'title_match') return false
  if (row.candidateClass !== 'identity_conflict') return false

  const conflicts = asList(row.conflictReasons)
  if (conflicts.length === 0) return hasVeryShortTitleSignal(row)
  return conflicts.every(isTitleNoiseOnlyReason)
}

function compact(row) {
  return {
    candidateId: val(row.candidateId),
    groupId: val(row.groupId),
    candidateType: val(row.candidateType),
    candidateClass: val(row.candidateClass),
    score: row.score,
    normalizedTitle: val(row.normalizedTitle),
    memberCount: row.memberCount,
    scoreReasons: asList(row.scoreReasons),
    conflictReasons: asList(row.conflictReasons),
    reviewOnly: row.reviewOnly === true,
    applyAllowed: row.applyAllowed === true,
  }
}

function markdown(summary, blockers, samples) {
  return [
    '# Identity Title Noise Audit v0.1',
    '',
    'This is a read-only guard for title-match noise classification.',
    '',
    '## Safety',
    '',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No importer action.',
    '- No production change.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- readyForCombinedReviewQueue: ${summary.readyForCombinedReviewQueue}`,
    `- candidateRows: ${summary.candidateRows}`,
    `- titleMatchRows: ${summary.titleMatchRows}`,
    `- shortTitleMatchRows: ${summary.shortTitleMatchRows}`,
    `- titleMatchIdentityConflictRows: ${summary.titleMatchIdentityConflictRows}`,
    `- titleNoisePromotedToConflictRows: ${summary.titleNoisePromotedToConflictRows}`,
    `- blockers: ${summary.blockers}`,
    '',
    '## By candidate class',
    '',
    '| Class | Count |',
    '|---|---:|',
    ...Object.entries(summary.byCandidateClass).map(([key, count]) => `| ${mdCell(key)} | ${count} |`),
    '',
    '## Blockers',
    '',
    blockers.length ? JSON.stringify(blockers.slice(0, 80), null, 2) : '- none',
    '',
    '## Short title samples',
    '',
    samples.length ? JSON.stringify(samples.slice(0, 80), null, 2) : '- none',
    '',
  ].join('\n')
}

async function main() {
  const candidatesPath = arg('candidates', CANDIDATES)
  const outDir = arg('out-dir', OUT)

  if (!fs.existsSync(candidatesPath)) throw new Error(`Input file not found: ${candidatesPath}`)

  const candidates = await readJsonl(candidatesPath)
  const titleMatches = candidates.rows.filter((row) => row.candidateType === 'title_match')
  const shortTitleMatches = candidates.rows.filter(hasVeryShortTitleSignal)
  const titleMatchIdentityConflicts = titleMatches.filter((row) => row.candidateClass === 'identity_conflict')
  const blockers = candidates.rows.filter(isTitleNoisePromotedToConflict).map(compact)
  const samples = shortTitleMatches.map(compact)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'identity-title-noise-audit-v0.1',
    readyForCombinedReviewQueue: blockers.length === 0,
    candidateRows: candidates.rows.length,
    titleMatchRows: titleMatches.length,
    shortTitleMatchRows: shortTitleMatches.length,
    titleMatchIdentityConflictRows: titleMatchIdentityConflicts.length,
    titleNoisePromotedToConflictRows: blockers.length,
    blockers: blockers.length,
    byCandidateClass: countBy(candidates.rows, 'candidateClass'),
    inputs: {
      candidates: candidatesPath,
      candidateRowsRead: candidates.read,
      candidateRowsFailed: candidates.failed,
    },
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      postgresqlWrite: false,
      importerAction: false,
      applyAllowedRows: candidates.rows.filter((row) => row.applyAllowed === true).length,
      notReviewOnlyRows: candidates.rows.filter((row) => row.reviewOnly !== true).length,
    },
  }

  fs.mkdirSync(outDir, { recursive: true })

  const outJson = path.join(outDir, 'identity-title-noise-audit-v01.json')
  const outSummary = path.join(outDir, 'identity-title-noise-audit-v01-summary.json')
  const outMd = path.join(outDir, 'identity-title-noise-audit-v01.md')

  fs.writeFileSync(outJson, JSON.stringify({ ok: true, summary, blockers, samples }, null, 2), 'utf8')
  fs.writeFileSync(outSummary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outMd, markdown(summary, blockers, samples), 'utf8')

  console.log(JSON.stringify({
    ok: true,
    summary,
    outputs: {
      json: outJson,
      summary: outSummary,
      md: outMd,
    },
  }, null, 2))

  if (blockers.length > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
