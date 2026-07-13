#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'ai-radar-input-v0.1'
const DEFAULT_OUT_DIR = 'data_local/staging/ai-radar'

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function unique(values) {
  return [...new Set(values.map(val).filter(Boolean))]
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

function readInputFile(file) {
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['docs', 'rows', 'records', 'items', 'works', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key]
  }
  return [parsed]
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function lexicalText(value) {
  const parts = []
  const walk = (node) => {
    if (node == null) return
    if (typeof node === 'string') {
      parts.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    for (const child of list(node.children)) walk(child)
    if (node.root) walk(node.root)
  }
  walk(value)
  return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

function relationLabel(value) {
  if (typeof value === 'string' || typeof value === 'number') return val(value)
  return val(value?.name || value?.title || value?.label || value?.slug || value?.id)
}

function normalizeSourceLinks(value) {
  return list(value).map((item) => ({
    label: val(item?.label),
    url: val(item?.url),
  })).filter((item) => item.label || item.url)
}

function normalizeCandidateSources(value) {
  return list(value).map((item) => ({
    source: val(item?.source),
    label: val(item?.label),
    externalId: val(item?.externalId),
    url: val(item?.url),
    fetchedAt: val(item?.fetchedAt),
    note: val(item?.note),
  })).filter((item) => item.source || item.label || item.externalId || item.url || item.note)
}

function workProtection(work) {
  const reasons = []
  if (work?.ratingNotice === 'manual_reviewed') reasons.push('manual_rating_notice')
  if (work?.humanVerified === true) reasons.push('human_verified')
  if (work?.locked === true) reasons.push('locked')
  return { protected: reasons.length > 0, reasons }
}

function buildEvidencePacket(work) {
  const aliases = list(work?.aliases).map((item) => val(item?.value || item)).filter(Boolean)
  const localizedTitles = list(work?.localizedTitles).map((item) => val(item?.title || item?.value || item)).filter(Boolean)
  const sourceLinks = normalizeSourceLinks(work?.sourceLinks)
  const candidateSources = normalizeCandidateSources(work?.candidateSources)
  const externalIds = Object.fromEntries(
    Object.entries(work?.externalIds || {}).filter(([, value]) => val(value)),
  )
  const creators = unique([
    ...list(work?.creators).map(relationLabel),
    ...list(work?.creatorCredits).map((item) => relationLabel(item?.creator)),
  ])
  const organizations = unique(list(work?.organizations).map((item) => relationLabel(item?.organization)))
  const tags = unique(list(work?.tags).map(relationLabel))
  const warnings = unique(list(work?.warnings).map(relationLabel))
  const summaryText = lexicalText(work?.summary)
  const analysisText = lexicalText(work?.analysis)
  const evidenceNote = val(work?.evidenceNote)
  const searchText = val(work?.searchText)
  const protection = workProtection(work)

  const evidenceSignals = [
    summaryText && { type: 'summary', text: summaryText },
    analysisText && { type: 'analysis', text: analysisText },
    evidenceNote && { type: 'evidence_note', text: evidenceNote },
    work?.riskMatrix?.note && { type: 'risk_matrix_note', text: val(work.riskMatrix.note) },
    ...candidateSources.filter((item) => item.note).map((item) => ({
      type: 'candidate_source_note',
      source: item.source || item.label,
      text: item.note,
      url: item.url || undefined,
    })),
  ].filter(Boolean)

  return {
    packetVersion: VERSION,
    policyVersion: 'radar-rating-policy-v0.4-draft',
    generatedAt: new Date().toISOString(),
    workId: val(work?.id),
    siteId: val(work?.siteId),
    title: val(work?.title),
    titles: unique([work?.title, work?.originalTitle, ...aliases, ...localizedTitles]),
    media: {
      mediaGroup: val(work?.mediaGroup),
      mediaType: val(work?.mediaType),
      format: val(work?.format),
      firstPublishedAt: val(work?.firstPublishedAt),
      firstPublishedLabel: val(work?.firstPublishedLabel),
    },
    existingState: {
      rank: val(work?.rank),
      reviewStatus: val(work?.reviewStatus),
      reviewReasons: list(work?.reviewReasons).map(val).filter(Boolean),
      ratingNotice: val(work?.ratingNotice),
      evidenceStrength: val(work?.evidenceStrength),
      status: val(work?.status),
      importBatch: val(work?.importBatch),
      humanVerified: work?.humanVerified === true,
      locked: work?.locked === true,
    },
    writeProtection: protection,
    summaryText,
    analysisText,
    evidenceNote,
    searchText,
    riskMatrix: work?.riskMatrix || {},
    creators,
    organizations,
    tags,
    warnings,
    externalIds,
    sourceLinks,
    candidateSources,
    evidenceSignals,
    assessmentInstructions: {
      evaluateEveryRule: true,
      preserveAllMatches: true,
      resolveByLowestGrade: true,
      unknownFallsBackTo: 'D-UNCLEAR',
      outputNotice: 'ai_synthesized_pending_review',
      doNotTreatExistingRankAsGroundTruth: true,
      doNotOverwriteHumanReviewed: true,
    },
  }
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Payload login failed: ${response.status} ${await response.text()}`)
  const body = await response.json()
  const token = val(body?.token)
  if (!token) throw new Error('Payload login response did not include a token')
  return token
}

async function readWorksFromPayload(baseUrl, token, limit) {
  const rows = []
  let page = 1
  while (true) {
    const query = new URLSearchParams({
      limit: '100',
      page: String(page),
      depth: '1',
      draft: 'true',
      sort: 'id',
    })
    const response = await fetch(`${baseUrl}/api/works?${query}`, {
      headers: { authorization: `JWT ${token}` },
    })
    if (!response.ok) throw new Error(`Payload works read failed: ${response.status} ${await response.text()}`)
    const body = await response.json()
    const docs = list(body?.docs)
    rows.push(...docs)
    if ((limit && rows.length >= limit) || !body?.hasNextPage || docs.length === 0) break
    page += 1
  }
  return limit ? rows.slice(0, limit) : rows
}

function countBy(rows, getter) {
  const out = {}
  for (const row of rows) {
    const key = val(getter(row)) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = val(args['out-dir']) || DEFAULT_OUT_DIR
  const output = val(args.output) || path.join(outDir, 'ai-radar-input-v01.jsonl')
  const summaryFile = val(args.summary) || path.join(outDir, 'ai-radar-input-v01-summary.json')
  const limit = Number(args.limit) > 0 ? Number(args.limit) : 0

  let works = []
  let inputMode = 'payload'
  let inputReference = null

  if (args.file) {
    inputMode = 'file'
    inputReference = val(args.file)
    works = readInputFile(inputReference)
  } else {
    const baseUrl = val(args.url || process.env.PAYLOAD_URL || 'http://localhost:3000').replace(/\/$/u, '')
    const email = val(args.email || process.env.RADAR_PAYLOAD_EMAIL || process.env.PAYLOAD_EXPORT_EMAIL)
    const password = val(args.password || process.env.RADAR_PAYLOAD_PASSWORD || process.env.PAYLOAD_EXPORT_PASSWORD)
    if (!email || !password) {
      throw new Error('Payload credentials are required. Set RADAR_PAYLOAD_EMAIL/RADAR_PAYLOAD_PASSWORD or PAYLOAD_EXPORT_EMAIL/PAYLOAD_EXPORT_PASSWORD, or use --file.')
    }
    inputReference = baseUrl
    const token = await login(baseUrl, email, password)
    works = await readWorksFromPayload(baseUrl, token, limit)
  }

  if (limit && inputMode === 'file') works = works.slice(0, limit)
  const packets = works.map(buildEvidencePacket)
  writeJsonl(output, packets)

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    policyVersion: 'radar-rating-policy-v0.4-draft',
    inputMode,
    inputReference,
    worksRead: works.length,
    packetsWritten: packets.length,
    protectedRows: packets.filter((row) => row.writeProtection.protected).length,
    byExistingRank: countBy(packets, (row) => row.existingState.rank),
    byReviewStatus: countBy(packets, (row) => row.existingState.reviewStatus),
    byEvidenceStrength: countBy(packets, (row) => row.existingState.evidenceStrength),
    byMediaType: countBy(packets, (row) => row.media.mediaType),
    outputs: { packets: output, summary: summaryFile },
    safety: {
      payloadRead: inputMode === 'payload',
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      exportsCredentials: false,
    },
    nextStep: 'Use the evidence packets to produce ruleAssessments, then run pnpm radar:resolve. This script never assigns or writes a rating.',
  }

  fs.mkdirSync(path.dirname(summaryFile), { recursive: true })
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
