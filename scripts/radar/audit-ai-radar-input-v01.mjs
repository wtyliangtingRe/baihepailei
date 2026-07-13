#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'ai-radar-input-audit-v0.1'
const DEFAULT_INPUT = 'data_local/staging/ai-radar/ai-radar-input-v01.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar'

function val(value) { return String(value ?? '').trim() }
function list(value) { return Array.isArray(value) ? value : [] }
function unique(values) { return [...new Set(values.filter(Boolean))] }
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
function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['rows', 'docs', 'records', 'items', 'works', 'data']) if (Array.isArray(parsed?.[key])) return parsed[key]
  return [parsed]
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}
function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

export function parseSeriesTitle(title) {
  let text = val(title).normalize('NFKC')
  let volumeLabel = ''
  const patterns = [
    /\s*[（(]\s*(\d+)\s*[）)]\s*$/u,
    /\s+第?\s*(\d+)\s*[巻卷册集]?\s*$/u,
    /\s*第\s*(\d+)\s*[巻卷册集]\s*$/u,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    volumeLabel = match[1]
    text = text.slice(0, match.index).trim()
    break
  }
  return { seriesKey: text || val(title), volumeLabel, isVolumeLevel: Boolean(volumeLabel) }
}

export function inferEffectiveMediaType(row) {
  const current = val(row?.media?.mediaType) || 'unknown'
  if (!['other', 'unknown'].includes(current)) return { value: current, inferred: false, reason: 'existing' }
  for (const source of list(row?.candidateSources)) {
    const match = val(source?.note).match(/(?:^|;\s*)mediaType=([a-z_]+)/u)
    if (match) return { value: match[1], inferred: true, reason: 'candidate_source_note' }
  }
  if (list(row?.candidateSources).some((source) => source?.source === 'mangadex')) {
    return { value: 'manga', inferred: true, reason: 'mangadex_source_family' }
  }
  return { value: current, inferred: false, reason: 'unresolved' }
}

const GENERIC_FAMILY_TOKENS = new Set([
  '学園', '学校', '高校', '少女', '女子', '漫画', '作品', '登場', '大人気', '待望',
  '生活', '毎日', '青春', '恋愛', '主人公', '物語', '内容', '発売', '収録', 'コミック', 'ドラマ',
])

export function lexicalFamilyTokens(text) {
  const source = val(text)
  const tokens = new Set()
  for (const match of source.matchAll(/[\u3400-\u9fff]{2,8}/gu)) {
    const chunk = match[0]
    tokens.add(chunk)
    if (chunk.length > 4) {
      for (const size of [2, 3, 4]) {
        for (let i = 0; i <= chunk.length - size; i += 1) tokens.add(chunk.slice(i, i + size))
      }
    }
  }
  for (const match of source.matchAll(/[\u30a0-\u30ffー]{3,}/gu)) tokens.add(match[0])
  for (const match of source.matchAll(/[A-Za-z]{3,}/gu)) tokens.add(match[0].toLowerCase())
  return new Set([...tokens].filter((token) => !GENERIC_FAMILY_TOKENS.has(token)))
}

function sourceGroupKey(source) {
  const type = val(source?.source) || 'other'
  const note = val(source?.note)
  const groupKey = note.match(/(?:^|;\s*)groupKey=([^;]+)/u)?.[1]?.trim()
  if (groupKey) return `${type}|group:${groupKey}`
  const externalId = val(source?.externalId)
  if (externalId) return `${type}|id:${externalId}`
  const url = val(source?.url)
  if (url) return `${type}|url:${url}`
  return `${type}|label:${val(source?.label)}`
}

function metadataSignalFromSource(source) {
  const note = val(source?.note)
  const semantic = /(?:trustedYuriSource=true|yuriMarked=true|関係性=|人物=|ジャンル=|その他=|出版形式=)/u.test(note)
  if (!semantic) return null
  return {
    type: 'source_metadata',
    source: val(source?.source),
    label: val(source?.label),
    url: val(source?.url) || undefined,
    externalId: val(source?.externalId) || undefined,
    text: note,
  }
}

function collapseSourceRecords(candidateSources) {
  const groups = new Map()
  for (const source of list(candidateSources)) {
    const key = sourceGroupKey(source)
    const existing = groups.get(key) || {
      key,
      source: val(source?.source) || 'other',
      labels: [], externalIds: [], urls: [], notes: [], recordCount: 0,
    }
    existing.recordCount += 1
    existing.labels.push(val(source?.label))
    existing.externalIds.push(val(source?.externalId))
    existing.urls.push(val(source?.url))
    existing.notes.push(val(source?.note))
    groups.set(key, existing)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    labels: unique(group.labels),
    externalIds: unique(group.externalIds),
    urls: unique(group.urls),
    notes: unique(group.notes),
  }))
}

export function auditAndCleanRows(rows) {
  const families = new Map()
  for (const row of rows) {
    const series = parseSeriesTitle(row?.title)
    const family = families.get(series.seriesKey) || []
    family.push(row)
    families.set(series.seriesKey, family)
  }

  const familyRepeatedTokens = new Map()
  for (const [seriesKey, family] of families) {
    const counts = new Map()
    for (const row of family) {
      for (const token of lexicalFamilyTokens(row?.summaryText)) counts.set(token, (counts.get(token) || 0) + 1)
    }
    familyRepeatedTokens.set(seriesKey, new Set([...counts].filter(([, count]) => count >= 2).map(([token]) => token)))
  }

  return rows.map((row) => {
    const series = parseSeriesTitle(row?.title)
    const family = families.get(series.seriesKey) || []
    const flags = []
    const warnings = []
    const blockers = []
    const summaryText = val(row?.summaryText)
    const media = inferEffectiveMediaType(row)
    const sourceGroups = collapseSourceRecords(row?.candidateSources)
    const sourceCounts = countBy(list(row?.candidateSources), (source) => source?.source)

    if (media.inferred) {
      flags.push('media_type_inferred_from_source')
      warnings.push(`media_type:${val(row?.media?.mediaType) || 'unknown'}->${media.value}`)
    }
    if (!summaryText) flags.push('summary_missing')
    else if (summaryText.length < 40) flags.push('summary_too_short')
    if (series.isVolumeLevel) flags.push('volume_level_record')
    if (family.length > 1) flags.push('multi_record_series_family')
    if (Object.values(sourceCounts).some((count) => count > 1)) flags.push('repeated_source_records')

    const repeatedTokens = familyRepeatedTokens.get(series.seriesKey) || new Set()
    const sharedTokens = [...lexicalFamilyTokens(summaryText)].filter((token) => repeatedTokens.has(token))
    const nonEmptyFamilySummaries = family.filter((item) => val(item?.summaryText)).length
    if (family.length >= 3 && nonEmptyFamilySummaries >= 3 && summaryText.length >= 80 && sharedTokens.length === 0) {
      flags.push('series_summary_outlier')
      warnings.push('summary_has_no_repeated_distinctive_terms_in_series_family')
    }

    const originalSignals = list(row?.evidenceSignals)
    const contentEvidenceSignals = originalSignals.filter((signal) => ['summary', 'analysis', 'risk_matrix_note'].includes(signal?.type))
    const metadataEvidenceSignals = []
    const seenMetadataGroups = new Set()
    for (const source of list(row?.candidateSources)) {
      const signal = metadataSignalFromSource(source)
      if (!signal) continue
      const key = sourceGroupKey(source)
      if (seenMetadataGroups.has(key)) continue
      seenMetadataGroups.add(key)
      metadataEvidenceSignals.push(signal)
    }
    const provenanceSignals = [
      ...originalSignals.filter((signal) => ['evidence_note', 'candidate_source_note'].includes(signal?.type)),
    ]
    if (provenanceSignals.some((signal) => signal?.type === 'evidence_note')) flags.push('operational_note_mixed_into_evidence')
    if (provenanceSignals.some((signal) => signal?.type === 'candidate_source_note')) flags.push('provenance_note_mixed_into_evidence')

    const assessmentReadiness = flags.includes('series_summary_outlier')
      ? 'needs_identity_or_series_review'
      : flags.includes('summary_missing')
        ? 'needs_external_research'
        : 'ready_for_ai_assessment_with_warnings'

    return {
      ...row,
      effectiveMedia: media,
      series: { ...series, familySize: family.length },
      sourceEvidenceGroups: sourceGroups,
      contentEvidenceSignals,
      metadataEvidenceSignals,
      provenanceSignals,
      inputAudit: {
        version: VERSION,
        assessmentReadiness,
        flags: unique(flags),
        warnings: unique(warnings),
        blockers: unique(blockers),
        summaryLength: summaryText.length,
        sharedSeriesTokens: sharedTokens.slice(0, 50),
        originalSourceRecordCount: list(row?.candidateSources).length,
        collapsedSourceGroupCount: sourceGroups.length,
      },
      evidenceSignals: undefined,
    }
  }).map((row) => JSON.parse(JSON.stringify(row)))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = val(args.input) || DEFAULT_INPUT
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`)
  const rows = readRows(input)
  const cleaned = auditAndCleanRows(rows)
  const outputs = {
    cleaned: path.join(outDir, 'ai-radar-clean-input-v01.jsonl'),
    ready: path.join(outDir, 'ai-radar-clean-ready-v01.jsonl'),
    externalResearch: path.join(outDir, 'ai-radar-clean-needs-external-research-v01.jsonl'),
    identityReview: path.join(outDir, 'ai-radar-clean-needs-identity-review-v01.jsonl'),
    summary: path.join(outDir, 'ai-radar-input-audit-v01-summary.json'),
  }
  const ready = cleaned.filter((row) => row.inputAudit.assessmentReadiness === 'ready_for_ai_assessment_with_warnings')
  const externalResearch = cleaned.filter((row) => row.inputAudit.assessmentReadiness === 'needs_external_research')
  const identityReview = cleaned.filter((row) => row.inputAudit.assessmentReadiness === 'needs_identity_or_series_review')
  writeJsonl(outputs.cleaned, cleaned)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.externalResearch, externalResearch)
  writeJsonl(outputs.identityReview, identityReview)
  const summary = {
    generatedAt: new Date().toISOString(), version: VERSION, input, rowsRead: rows.length,
    readyRows: ready.length, externalResearchRows: externalResearch.length, identityReviewRows: identityReview.length,
    byReadiness: countBy(cleaned, (row) => row.inputAudit.assessmentReadiness),
    byFlag: countBy(cleaned.flatMap((row) => row.inputAudit.flags), (item) => item),
    byCurrentMediaType: countBy(cleaned, (row) => row.media?.mediaType),
    byEffectiveMediaType: countBy(cleaned, (row) => row.effectiveMedia?.value),
    multiRecordSeriesFamilies: new Set(cleaned.filter((row) => row.series.familySize > 1).map((row) => row.series.seriesKey)).size,
    outputs,
    safety: { payloadRead: false, payloadWrite: false, directPostgresqlWrite: false, modifiesWorks: false },
    nextStep: 'Review identity outliers first. Use clean input rather than raw evidenceSignals for AI rule assessment.',
  }
  fs.mkdirSync(path.dirname(outputs.summary), { recursive: true })
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
}
