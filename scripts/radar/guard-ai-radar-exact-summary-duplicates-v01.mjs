#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'ai-radar-exact-summary-duplicate-guard-v0.1'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
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

export function normalizeComparableSummary(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function findExactSummaryDuplicateGroups(rows, minimumLength = 80) {
  const groups = new Map()
  for (const row of rows) {
    const normalized = normalizeComparableSummary(row?.summaryText)
    if (normalized.length < minimumLength) continue
    const bucket = groups.get(normalized) || []
    bucket.push(row)
    groups.set(normalized, bucket)
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([normalizedSummary, members]) => ({
      normalizedSummary,
      memberCount: members.length,
      members: members.map((row) => ({
        workId: val(row?.workId),
        siteId: val(row?.siteId),
        title: val(row?.title),
        seriesKey: val(row?.series?.seriesKey),
        bangumiSubjectId: val(row?.externalIds?.bangumiSubjectId),
      })),
    }))
    .filter((group) => new Set(group.members.map((member) => `${member.seriesKey}|${member.workId}`)).size > 1)
}

export function applyExactSummaryDuplicateGuard(rows, minimumLength = 80) {
  const groups = findExactSummaryDuplicateGroups(rows, minimumLength)
  const byWorkId = new Map()

  for (const group of groups) {
    const ids = group.members.map((member) => member.workId).filter(Boolean)
    for (const member of group.members) {
      const peers = ids.filter((id) => id !== member.workId)
      byWorkId.set(member.workId, {
        peers,
        group,
      })
    }
  }

  const guarded = rows.map((row) => {
    const hit = byWorkId.get(val(row?.workId))
    if (!hit) return row

    const inputAudit = row?.inputAudit || {}
    return {
      ...row,
      writeProtection: {
        ...(row?.writeProtection || {}),
        protected: true,
        reasons: unique([
          ...list(row?.writeProtection?.reasons).map(val),
          ...hit.peers.map((peer) => `exact_summary_duplicate_with_work:${peer}`),
        ]),
      },
      inputAudit: {
        ...inputAudit,
        assessmentReadiness: 'needs_identity_or_series_review',
        flags: unique([
          ...list(inputAudit.flags).map(val),
          'exact_summary_duplicate_different_identity',
        ]),
        warnings: unique([
          ...list(inputAudit.warnings).map(val),
          `exact_summary_duplicate_peers:${hit.peers.join(',')}`,
        ]),
        blockers: unique([
          ...list(inputAudit.blockers).map(val),
          'exact_summary_duplicate_requires_identity_review',
        ]),
      },
      exactSummaryDuplicateGroup: hit.group,
    }
  })

  return { rows: guarded, groups }
}

function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const input = val(args.input) || path.join(outDir, 'ai-radar-clean-input-v01.jsonl')
  const minimumLength = Number(args['minimum-length']) > 0 ? Number(args['minimum-length']) : 80

  if (!fs.existsSync(input)) throw new Error(`Clean radar input not found: ${input}`)
  const sourceRows = readJsonl(input)
  const { rows, groups } = applyExactSummaryDuplicateGuard(sourceRows, minimumLength)

  const ready = rows.filter((row) => row?.inputAudit?.assessmentReadiness === 'ready_for_ai_assessment_with_warnings')
  const externalResearch = rows.filter((row) => row?.inputAudit?.assessmentReadiness === 'needs_external_research')
  const identityReview = rows.filter((row) => row?.inputAudit?.assessmentReadiness === 'needs_identity_or_series_review')

  const outputs = {
    cleaned: path.join(outDir, 'ai-radar-clean-input-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-clean-ready-v01.jsonl'),
    externalResearch: path.join(outDir, 'ai-radar-clean-needs-external-research-v01.jsonl'),
    identityReview: path.join(outDir, 'ai-radar-clean-needs-identity-review-v01.jsonl'),
    duplicateGroups: path.join(outDir, 'ai-radar-clean-exact-summary-duplicate-groups-v01.json'),
    summary: path.join(outDir, 'ai-radar-exact-summary-duplicate-guard-v01-summary.json'),
  }

  writeJsonl(outputs.cleaned, rows)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.externalResearch, externalResearch)
  writeJsonl(outputs.identityReview, identityReview)
  fs.writeFileSync(outputs.duplicateGroups, JSON.stringify(groups, null, 2), 'utf8')

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    input,
    rowsRead: sourceRows.length,
    rowsWritten: rows.length,
    exactSummaryDuplicateGroups: groups.length,
    exactSummaryDuplicateRows: groups.reduce((sum, group) => sum + group.memberCount, 0),
    readyRows: ready.length,
    externalResearchRows: externalResearch.length,
    identityReviewRows: identityReview.length,
    byReadiness: countBy(rows, (row) => row?.inputAudit?.assessmentReadiness),
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      onlyRewritesLocalStagingFiles: true,
    },
    nextStep: 'Review exact-summary duplicate groups before assessment. Duplicate rows are removed from the ready queue and retained in identity review.',
  }

  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('guard-ai-radar-exact-summary-duplicates-v01.mjs')) {
  try {
    main()
  } catch (error) {
    console.error(error?.stack || error)
    process.exitCode = 1
  }
}
