#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'discovered-work-candidate-plan-v0.1'

function val(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return raw ? raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function normalize(value) {
  return val(value).normalize('NFKC').toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function textValues(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : item?.value || item?.title || item?.name)
    .map(val).filter(Boolean)
}

function externalValues(value) {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, raw]) => {
    const text = val(raw)
    return text ? [`${key}:${text}`] : []
  })
}

function sourceLinks(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    label: val(item?.label || item?.source || item?.title),
    url: val(item?.url),
    sourceType: val(item?.sourceType || item?.type),
    fetchedAt: val(item?.fetchedAt),
  })).filter((item) => item.url)
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function candidateIdentity(candidate) {
  const title = val(candidate?.title)
  const originalTitle = val(candidate?.originalTitle)
  const aliases = textValues(candidate?.aliases)
  const titles = [...new Set([title, originalTitle, ...aliases].map(normalize).filter(Boolean))]
  const mediaGroup = val(candidate?.mediaGroup || 'unknown')
  const mediaType = val(candidate?.mediaType || 'unknown')
  return {
    title,
    originalTitle,
    aliases,
    titles,
    mediaGroup,
    mediaType,
    externalIds: externalValues(candidate?.externalIds),
    sourceLinks: sourceLinks(candidate?.sourceLinks || candidate?.sources),
  }
}

function workIdentity(work) {
  const titles = [
    work?.title,
    work?.originalTitle,
    ...textValues(work?.aliases),
    ...textValues(work?.localizedTitles),
  ].map(normalize).filter(Boolean)
  return {
    id: val(work?.workId || work?.id),
    siteId: val(work?.siteId),
    title: val(work?.title),
    mediaGroup: val(work?.media?.mediaGroup || work?.mediaGroup || 'unknown'),
    mediaType: val(work?.media?.mediaType || work?.mediaType || 'unknown'),
    titles: [...new Set(titles)],
    externalIds: externalValues(work?.externalIds),
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function planCandidate(candidate, existingWorks) {
  const identity = candidateIdentity(candidate)
  const blockers = []
  const warnings = []
  if (!identity.title) blockers.push('missing_title')
  if (!identity.sourceLinks.length) blockers.push('missing_traceable_source_link')
  if (identity.sourceLinks.some((item) => !isHttpUrl(item.url))) blockers.push('invalid_source_url')
  if (!identity.externalIds.length) warnings.push('no_external_id')

  const externalMatches = []
  const titleMatches = []
  for (const work of existingWorks) {
    const externalOverlap = identity.externalIds.filter((item) => work.externalIds.includes(item))
    if (externalOverlap.length) externalMatches.push({ ...work, matchedBy: 'external_id', values: externalOverlap })
    if (
      identity.titles.some((title) => work.titles.includes(title))
      && identity.mediaGroup === work.mediaGroup
      && identity.mediaType === work.mediaType
    ) {
      titleMatches.push({ ...work, matchedBy: 'title_media', values: [] })
    }
  }

  const duplicateMatches = unique([
    ...externalMatches.map((item) => `${item.id}:${item.matchedBy}`),
    ...titleMatches.map((item) => `${item.id}:${item.matchedBy}`),
  ])
  let planStatus = 'ready_for_editor_draft'
  if (blockers.length) planStatus = 'blocked'
  else if (duplicateMatches.length) planStatus = 'possible_duplicate'

  return {
    version: VERSION,
    action: 'create_discovered_work_draft',
    discoveryId: val(candidate?.discoveryId || candidate?.id || candidate?.sourceId),
    sourceSnapshotAt: val(candidate?.sourceSnapshotAt || candidate?.fetchedAt),
    candidate: {
      title: identity.title,
      originalTitle: identity.originalTitle,
      aliases: identity.aliases,
      mediaGroup: identity.mediaGroup,
      mediaType: identity.mediaType,
      format: val(candidate?.format || 'unknown'),
      firstPublishedAt: val(candidate?.firstPublishedAt),
      firstPublishedPrecision: val(candidate?.firstPublishedPrecision || 'unknown'),
      externalIds: candidate?.externalIds && typeof candidate.externalIds === 'object' ? candidate.externalIds : {},
      sourceLinks: identity.sourceLinks,
      discoveryNote: val(candidate?.discoveryNote || candidate?.note),
    },
    planStatus,
    blockers: unique(blockers),
    warnings: unique(warnings),
    duplicateMatches: [...externalMatches, ...titleMatches].map((item) => ({
      workId: item.id,
      siteId: item.siteId,
      title: item.title,
      matchedBy: item.matchedBy,
      values: item.values,
    })),
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsPublicWork: false,
      requiresEditorConfirmation: true,
      humanAssessmentCreated: false,
      radarAssessmentCreated: false,
    },
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write) {
    throw new Error('Discovered-work planning is read-only. It never creates Payload rows.')
  }
  const candidatesFile = val(args.candidates)
  const worksFile = val(args.works)
  const outDir = val(args['out-dir']) || 'data_local/staging/ai-radar/discovered-work-candidates-v01'
  if (!candidatesFile || !worksFile) throw new Error('--candidates and --works are required')
  const candidates = readJsonl(candidatesFile)
  const existingWorks = readJsonl(worksFile).map(workIdentity)
  const plans = candidates.map((candidate) => planCandidate(candidate, existingWorks))
  const ready = plans.filter((row) => row.planStatus === 'ready_for_editor_draft')
  const duplicates = plans.filter((row) => row.planStatus === 'possible_duplicate')
  const blocked = plans.filter((row) => row.planStatus === 'blocked')
  const outputs = {
    all: path.join(outDir, 'discovered-work-candidate-plan-v01.jsonl'),
    ready: path.join(outDir, 'discovered-work-candidate-plan-v01-ready.jsonl'),
    duplicates: path.join(outDir, 'discovered-work-candidate-plan-v01-possible-duplicate.jsonl'),
    blocked: path.join(outDir, 'discovered-work-candidate-plan-v01-blocked.jsonl'),
    summary: path.join(outDir, 'discovered-work-candidate-plan-v01-summary.json'),
  }
  writeJsonl(outputs.all, plans)
  writeJsonl(outputs.ready, ready)
  writeJsonl(outputs.duplicates, duplicates)
  writeJsonl(outputs.blocked, blocked)
  const summary = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    candidatesFile,
    candidatesSha256: sha256File(candidatesFile),
    worksFile,
    worksSha256: sha256File(worksFile),
    candidatesRead: candidates.length,
    existingWorksRead: existingWorks.length,
    readyForEditorDraft: ready.length,
    possibleDuplicate: duplicates.length,
    blocked: blocked.length,
    outputs,
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      sourceSnapshotRequired: true,
      titleOnlyAutoMergeAllowed: false,
      autoPublish: false,
      autoAssessment: false,
    },
    nextStep: 'Review ready rows and duplicate candidates. Editor confirmation must create a draft before the item enters the AI assessment scope.',
  }
  writeJson(outputs.summary, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
