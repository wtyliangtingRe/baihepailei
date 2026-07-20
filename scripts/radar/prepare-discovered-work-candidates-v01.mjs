#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const VERSION = 'discovered-work-candidate-plan-v0.2'

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

function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Discovered-work candidate artifacts must remain below ignored data_local/.')
  }
}

function normalize(value) {
  return val(value).normalize('NFKC').toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function normalizeSlug(value) {
  return val(value).normalize('NFKC').toLowerCase().replace(/^\/+|\/+$/gu, '')
}

function normalizeDate(value) {
  const text = val(value)
  const match = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/u)
  if (!match) return ''
  return [match[1], match[2], match[3]].filter(Boolean).join('-')
}

function datesCompatible(left, right) {
  if (!left || !right) return false
  return left === right || left.startsWith(`${right}-`) || right.startsWith(`${left}-`)
}

function textValues(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : item?.value || item?.title || item?.name)
    .map(val).filter(Boolean)
}

function externalValues(value) {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, raw]) => {
    const values = Array.isArray(raw) ? raw : [raw]
    return values.map(val).filter(Boolean).map((item) => `${key}:${item}`)
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
    siteId: val(candidate?.siteId),
    slug: normalizeSlug(candidate?.slug),
    firstPublishedAt: normalizeDate(candidate?.firstPublishedAt || candidate?.firstPublishedLabel),
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
    slug: normalizeSlug(work?.slug),
    title: val(work?.title),
    firstPublishedAt: normalizeDate(work?.firstPublishedAt || work?.firstPublishedLabel || work?.releaseDate),
    mediaGroup: val(work?.media?.mediaGroup || work?.mediaGroup || 'unknown'),
    mediaType: val(work?.media?.mediaType || work?.mediaType || 'unknown'),
    titles: [...new Set(titles)],
    externalIds: externalValues(work?.externalIds),
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function sameMedia(candidate, work) {
  return candidate.mediaGroup === work.mediaGroup && candidate.mediaType === work.mediaType
}

function matchSummary(item, matchedBy, values = []) {
  return {
    workId: item.id,
    siteId: item.siteId,
    slug: item.slug,
    title: item.title,
    firstPublishedAt: item.firstPublishedAt,
    matchedBy,
    values,
  }
}

function planCandidate(candidate, existingWorks) {
  const identity = candidateIdentity(candidate)
  const blockers = unique(Array.isArray(candidate?.discoveryBlockers) ? candidate.discoveryBlockers.map(val) : [])
  const warnings = unique(Array.isArray(candidate?.discoveryWarnings) ? candidate.discoveryWarnings.map(val) : [])
  if (!identity.title) blockers.push('missing_title')
  if (!identity.sourceLinks.length) blockers.push('missing_traceable_source_link')
  if (identity.sourceLinks.some((item) => !isHttpUrl(item.url))) blockers.push('invalid_source_url')
  if (!identity.externalIds.length) warnings.push('no_external_id')

  const byTier = {
    site_id: [],
    external_id: [],
    slug: [],
    title_media_date: [],
    title_media_weak: [],
  }

  for (const work of existingWorks) {
    if (identity.siteId && identity.siteId === work.siteId) {
      byTier.site_id.push(matchSummary(work, 'site_id', [identity.siteId]))
    }

    const externalOverlap = identity.externalIds.filter((item) => work.externalIds.includes(item))
    if (externalOverlap.length) byTier.external_id.push(matchSummary(work, 'external_id', externalOverlap))

    if (identity.slug && identity.slug === work.slug) {
      byTier.slug.push(matchSummary(work, 'slug', [identity.slug]))
    }

    const titleOverlap = identity.titles.filter((title) => work.titles.includes(title))
    if (!titleOverlap.length || !sameMedia(identity, work)) continue
    if (datesCompatible(identity.firstPublishedAt, work.firstPublishedAt)) {
      byTier.title_media_date.push(matchSummary(work, 'title_media_date', titleOverlap))
    } else {
      byTier.title_media_weak.push(matchSummary(work, 'title_media_weak', titleOverlap))
    }
  }

  const tierOrder = ['site_id', 'external_id', 'slug', 'title_media_date']
  const primaryTier = tierOrder.find((tier) => byTier[tier].length) || ''
  const primaryMatches = primaryTier ? byTier[primaryTier] : []
  const primaryIds = new Set(primaryMatches.map((item) => item.workId))
  const lowerTierConflicts = primaryTier
    ? tierOrder.slice(tierOrder.indexOf(primaryTier) + 1)
      .flatMap((tier) => byTier[tier])
      .filter((item) => !primaryIds.has(item.workId))
    : []

  if (lowerTierConflicts.length) blockers.push('identity_tier_conflict')
  if (primaryMatches.length > 1) blockers.push(`ambiguous_${primaryTier}_match`)
  if (!primaryTier && byTier.title_media_weak.length) {
    warnings.push(identity.firstPublishedAt ? 'title_media_date_missing_or_conflicting' : 'title_media_missing_date')
  }

  const weakMatches = byTier.title_media_weak
  const duplicateMatches = primaryMatches.length ? primaryMatches : weakMatches
  let action = 'create_discovered_work_draft'
  let planStatus = 'ready_for_editor_draft'
  if (blockers.length) {
    action = 'blocked_discovered_work_candidate'
    planStatus = 'blocked'
  } else if (primaryMatches.length === 1 && ['site_id', 'external_id', 'slug'].includes(primaryTier)) {
    action = 'update_existing_work_candidate'
    planStatus = 'ready_for_editor_update'
  } else if (duplicateMatches.length) {
    action = 'review_possible_duplicate'
    planStatus = 'possible_duplicate'
  }

  return {
    version: VERSION,
    action,
    discoveryId: val(candidate?.discoveryId || candidate?.id || candidate?.sourceId),
    source: val(candidate?.source),
    sourceRecordId: val(candidate?.sourceRecordId),
    sourceSnapshotAt: val(candidate?.sourceSnapshotAt || candidate?.fetchedAt),
    sourceInput: candidate?.sourceInput,
    candidate: {
      title: identity.title,
      originalTitle: identity.originalTitle,
      aliases: identity.aliases,
      siteId: identity.siteId,
      slug: identity.slug,
      mediaGroup: identity.mediaGroup,
      mediaType: identity.mediaType,
      format: val(candidate?.format || 'unknown'),
      firstPublishedAt: val(candidate?.firstPublishedAt),
      firstPublishedPrecision: val(candidate?.firstPublishedPrecision || 'unknown'),
      externalIds: candidate?.externalIds && typeof candidate.externalIds === 'object' ? candidate.externalIds : {},
      sourceLinks: identity.sourceLinks,
      discoveryNote: val(candidate?.discoveryNote || candidate?.note),
      discoverySignals: candidate?.discoverySignals,
      sourcePolicy: candidate?.sourcePolicy,
      relatedDiscoveryIds: Array.isArray(candidate?.relatedDiscoveryIds) ? candidate.relatedDiscoveryIds : [],
    },
    planStatus,
    primaryMatchTier: primaryTier || (weakMatches.length ? 'title_media_weak' : 'none'),
    blockers: unique(blockers),
    warnings: unique(warnings),
    duplicateMatches,
    identityMatchesByTier: byTier,
    safety: {
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsPublicWork: false,
      requiresEditorConfirmation: true,
      humanAssessmentCreated: false,
      radarAssessmentCreated: false,
      titleOnlyAutoMergeAllowed: false,
    },
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write) {
    throw new Error('Discovered-work planning is read-only. It never creates or updates Payload rows.')
  }
  const candidatesFile = val(args.candidates)
  const worksFile = val(args.works)
  const outDir = val(args['out-dir']) || 'data_local/staging/ai-radar/discovered-work-candidates-v01'
  assertUnderDataLocal(outDir)
  if (!candidatesFile || !worksFile) throw new Error('--candidates and --works are required')
  const candidates = readJsonl(candidatesFile)
  const existingWorks = readJsonl(worksFile).map(workIdentity)
  const plans = candidates.map((candidate) => planCandidate(candidate, existingWorks))
  const readyCreate = plans.filter((row) => row.planStatus === 'ready_for_editor_draft')
  const readyUpdate = plans.filter((row) => row.planStatus === 'ready_for_editor_update')
  const duplicates = plans.filter((row) => row.planStatus === 'possible_duplicate')
  const blocked = plans.filter((row) => row.planStatus === 'blocked')
  const outputs = {
    all: path.join(outDir, 'discovered-work-candidate-plan-v01.jsonl'),
    readyCreate: path.join(outDir, 'discovered-work-candidate-plan-v01-ready-create.jsonl'),
    readyUpdate: path.join(outDir, 'discovered-work-candidate-plan-v01-ready-update.jsonl'),
    duplicates: path.join(outDir, 'discovered-work-candidate-plan-v01-possible-duplicate.jsonl'),
    blocked: path.join(outDir, 'discovered-work-candidate-plan-v01-blocked.jsonl'),
    summary: path.join(outDir, 'discovered-work-candidate-plan-v01-summary.json'),
  }
  writeJsonl(outputs.all, plans)
  writeJsonl(outputs.readyCreate, readyCreate)
  writeJsonl(outputs.readyUpdate, readyUpdate)
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
    wouldCreateDraft: readyCreate.length,
    wouldUpdateExisting: readyUpdate.length,
    possibleDuplicate: duplicates.length,
    blocked: blocked.length,
    outputs,
    identityPriority: ['site_id', 'external_id', 'slug', 'title_media_date'],
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      sourceSnapshotRequired: true,
      titleOnlyAutoMergeAllowed: false,
      autoPublish: false,
      autoAssessment: false,
      humanAssessmentMutable: false,
      radarAssessmentMutable: false,
    },
    nextStep: 'Review create, update, duplicate and blocked rows. A separately checkpoint-gated editor workflow must approve any temporary draft creation or metadata update before AI assessment.',
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
