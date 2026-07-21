#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { bangumiSubjectToCandidateInput } from '../../tools/source_import/sources/bangumi.mjs'

const VERSION = 'controlled-source-discovery-v0.1'
const DEFAULT_ROOT = 'data_local/staging/ai-radar/controlled-source-discovery-v01'
const SOURCE_KEYS = ['bangumi', 'yurizukan', 'vndb', 'steam']

const SOURCE_POLICY = {
  bangumi: {
    role: 'broad_catalog_discovery',
    authority: 'candidate_signal_only',
    acceptedHosts: ['bgm.tv', 'bangumi.tv'],
  },
  yurizukan: {
    role: 'trusted_yuri_discovery',
    authority: 'yuri_candidate_anchor',
    acceptedHosts: ['yurizukan.com'],
  },
  vndb: {
    role: 'visual_novel_discovery',
    authority: 'tag_gated_candidate_signal',
    acceptedHosts: ['vndb.org'],
  },
  steam: {
    role: 'storefront_discovery_and_metadata',
    authority: 'store_text_candidate_signal',
    acceptedHosts: ['store.steampowered.com'],
  },
}

function val(value) {
  return String(value ?? '').trim()
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function cleanText(value) {
  return val(value)
    .normalize('NFKC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\s\u3000]+/gu, ' ')
    .trim()
}

function normalizeIdentityText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function uniqueText(values = []) {
  const seen = new Set()
  const output = []
  for (const raw of values.flatMap((item) => list(item).length ? item : [item])) {
    const value = typeof raw === 'string' ? cleanText(raw) : cleanText(raw?.value || raw?.title || raw?.name)
    const key = normalizeIdentityText(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(value)
  }
  return output
}

function uniqueRows(rows, keyBuilder) {
  const seen = new Set()
  const output = []
  for (const row of rows.filter(Boolean)) {
    const key = keyBuilder(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(row)
  }
  return output
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Controlled discovery artifacts must remain below ignored data_local/.')
  }
}

function isSnapshotFile(file) {
  const name = path.basename(file)
  return /\.jsonl?$/iu.test(name)
    && !/\.compact\.jsonl$/iu.test(name)
    && !/(?:^|[-_.])summary(?:[-_.]|$)/iu.test(name)
}

function collectInputFiles(input) {
  if (!fs.existsSync(input)) throw new Error(`Source input not found: ${input}`)
  const stat = fs.statSync(input)
  if (stat.isFile()) {
    if (!isSnapshotFile(input)) throw new Error(`Unsupported source snapshot file: ${input}`)
    return [input]
  }
  if (!stat.isDirectory()) throw new Error(`Source input is not a file or directory: ${input}`)
  const files = []
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, entry.name)
    if (entry.isDirectory()) files.push(...collectInputFiles(full))
    else if (isSnapshotFile(full)) files.push(full)
  }
  return files.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function unwrapJson(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  for (const key of ['rows', 'docs', 'results', 'items', 'records']) {
    if (Array.isArray(value[key])) return value[key]
  }
  return [value]
}

function readSnapshotRows(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  if (!raw) return []
  if (/\.jsonl$/iu.test(file)) {
    return raw.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`${file}:${index + 1}: invalid JSONL: ${error.message}`)
      }
    })
  }
  try {
    return unwrapJson(JSON.parse(raw))
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error.message}`)
  }
}

function datePrecision(value) {
  const text = val(value)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return 'day'
  if (/^\d{4}-\d{2}$/u.test(text)) return 'month'
  if (/^\d{4}$/u.test(text)) return 'year'
  return 'unknown'
}

function sourcePage(source, id) {
  if (!id) return ''
  if (source === 'bangumi') return `https://bgm.tv/subject/${id}`
  if (source === 'yurizukan') return `https://www.yurizukan.com/articles/articleDetail/${id}`
  if (source === 'vndb') return `https://vndb.org/${id}`
  if (source === 'steam') return `https://store.steampowered.com/app/${id}`
  return ''
}

function normalizedHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

function hostAllowed(source, url) {
  const host = normalizedHost(url)
  return SOURCE_POLICY[source].acceptedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

function candidateSources(row) {
  return [
    ...list(row?.sourceLinks),
    ...list(row?.candidateSources),
    ...list(row?.groupPreview?.sourceLinks),
    ...list(row?.groupPreview?.candidateSources),
    ...list(row?.createCandidatePreview?.sourceLinks),
    ...list(row?.createCandidatePreview?.candidateSources),
    ...list(row?.createCandidatePreview?.payloadPreview?.sourceLinks),
    ...list(row?.createCandidatePreview?.payloadPreview?.candidateSources),
    ...list(row?.fieldAdditions?.sourceLinks),
    ...list(row?.fieldAdditions?.candidateSources),
  ]
}

function sourceIdFromRows(source, row) {
  const candidates = candidateSources(row)
  const sourceRow = candidates.find((item) => val(item?.source).toLowerCase() === source)
  if (sourceRow?.externalId) return val(sourceRow.externalId)
  const urlRow = candidates.find((item) => hostAllowed(source, val(item?.url)))
  const url = val(urlRow?.url)
  if (source === 'yurizukan') return url.match(/articleDetail\/(\d+)/iu)?.[1] || ''
  if (source === 'vndb') return url.match(/vndb\.org\/(v\d+)/iu)?.[1] || ''
  if (source === 'steam') return url.match(/\/app\/(\d+)/iu)?.[1] || ''
  if (source === 'bangumi') return url.match(/\/subject\/(\d+)/iu)?.[1] || ''
  return ''
}

function sourceLink(source, id, row) {
  const rows = candidateSources(row)
    .map((item) => ({
      label: cleanText(item?.label || item?.source || source),
      url: val(item?.url),
      sourceType: val(item?.sourceType || item?.type || 'catalog'),
      fetchedAt: val(item?.fetchedAt || row?.fetchedAt || row?.sourceSnapshotAt),
    }))
    .filter((item) => item.url && hostAllowed(source, item.url))
  const fallback = sourcePage(source, id)
  if (fallback) rows.push({ label: source, url: fallback, sourceType: 'catalog', fetchedAt: val(row?.fetchedAt || row?.sourceSnapshotAt) })
  return uniqueRows(rows, (item) => item.url.replace(/\/+$/u, ''))
}

function baseCandidate({ source, id, title, originalTitle, aliases, mediaGroup, mediaType, format, firstPublishedAt, externalIds, links, note, signals, blockers, warnings, row, snapshot }) {
  const safeLinks = uniqueRows(links, (item) => item.url)
  const discoveredAt = val(row?.fetchedAt || row?.sourceSnapshotAt || snapshot.modifiedAt)
  const result = {
    version: VERSION,
    discoveryId: `${source}:${id || `row-${snapshot.rowNumber}`}`,
    source,
    sourceRecordId: id,
    sourceSnapshotAt: discoveredAt,
    sourceInput: {
      path: snapshot.path,
      sha256: snapshot.sha256,
      rowNumber: snapshot.rowNumber,
    },
    title: cleanText(title),
    originalTitle: cleanText(originalTitle),
    aliases: uniqueText(aliases).filter((item) => normalizeIdentityText(item) !== normalizeIdentityText(title)),
    mediaGroup: val(mediaGroup || 'unknown'),
    mediaType: val(mediaType || 'unknown'),
    format: val(format || 'unknown'),
    firstPublishedAt: val(firstPublishedAt),
    firstPublishedPrecision: datePrecision(firstPublishedAt),
    externalIds: externalIds && typeof externalIds === 'object' ? externalIds : {},
    sourceLinks: safeLinks,
    discoveryNote: cleanText(note),
    discoverySignals: signals,
    discoveryBlockers: [...new Set(blockers.filter(Boolean))],
    discoveryWarnings: [...new Set(warnings.filter(Boolean))],
    sourcePolicy: SOURCE_POLICY[source],
  }
  if (!result.title) result.discoveryBlockers.push('missing_title')
  if (!result.sourceRecordId) result.discoveryBlockers.push('missing_source_record_id')
  if (!result.sourceLinks.length) result.discoveryBlockers.push('missing_canonical_source_page')
  if (result.sourceLinks.some((item) => !hostAllowed(source, item.url))) result.discoveryBlockers.push('source_page_host_mismatch')
  return result
}

function normalizeBangumi(row, snapshot) {
  const subject = row?.raw || row?.subject || row
  const input = bangumiSubjectToCandidateInput(subject)
  const id = val(row?.sourceRecordId || subject?.id || subject?.subject_id)
  const signal = subject?._baihepailei?.yuriTagSignal
  const warnings = []
  if (!list(signal?.matchedTags).length && !list(subject?._baihepailei?.searchSignals).length) {
    warnings.push('bangumi_yuri_signal_not_embedded')
  }
  return baseCandidate({
    source: 'bangumi',
    id,
    title: input.title,
    originalTitle: input.originalTitle,
    aliases: input.aliases,
    mediaGroup: input.mediaGroup,
    mediaType: input.mediaType,
    format: input.format,
    firstPublishedAt: input.firstPublishedLabel,
    externalIds: { ...input.externalIds, bangumiSubjectId: id },
    links: sourceLink('bangumi', id, { ...row, candidateSources: input.candidateSources }),
    note: input.candidateSources?.[0]?.note,
    signals: {
      yuriTagSignal: signal || null,
      yuriCandidateScore: input.yuriCandidateScore,
    },
    blockers: [],
    warnings,
    row,
    snapshot,
  })
}

function normalizeYurizukan(row, snapshot) {
  const payload = row?.createPayload || row?.createCandidatePreview?.payloadPreview || {}
  const ids = uniqueText([row?.yurizukanIds, row?.firstYurizukanId, sourceIdFromRows('yurizukan', row)])
  const id = ids[0] || ''
  return baseCandidate({
    source: 'yurizukan',
    id,
    title: row?.title || payload?.title,
    originalTitle: payload?.originalTitle || row?.title,
    aliases: payload?.aliases,
    mediaGroup: row?.mediaGroup || payload?.mediaGroup,
    mediaType: row?.mediaType || payload?.mediaType,
    format: row?.format || payload?.format,
    firstPublishedAt: payload?.firstPublishedAt,
    externalIds: { yurizukanArticleIds: ids },
    links: sourceLink('yurizukan', id, row),
    note: row?.groupPreview?.evidenceNoteAppend || payload?.evidenceNote,
    signals: {
      trustedYuriSource: true,
      groupedArticleIds: ids,
      planStatus: val(row?.planStatus),
    },
    blockers: row?.action && row.action !== 'yurizukan_create_work' ? ['yurizukan_row_is_not_create_candidate'] : [],
    warnings: [],
    row,
    snapshot,
  })
}

function normalizeVndb(row, snapshot) {
  const preview = row?.createCandidatePreview || {}
  const payload = preview?.payloadPreview || preview
  const raw = row?.raw || preview?.raw || {}
  const id = val(row?.vndbId || row?.vnId || raw?.id || sourceIdFromRows('vndb', row))
  const status = val(row?.yuriCreateCandidateV3?.status || row?.yuriCreateCandidateV2?.status || row?.yuriCreateCandidate?.status)
  const blockers = []
  const warnings = []
  if (!status) blockers.push('vndb_yuri_gate_missing')
  if (/sensitive|sex_only|spacing_repair/iu.test(status)) warnings.push(`vndb_review_bucket:${status}`)
  return baseCandidate({
    source: 'vndb',
    id,
    title: payload?.title || row?.yuriCreateCandidate?.title || row?.titleCandidates?.[0] || raw?.title,
    originalTitle: payload?.originalTitle || (raw?.olang === 'ja' ? raw?.title : ''),
    aliases: [row?.titleCandidates, payload?.aliases, raw?.alttitle, raw?.titles?.map?.((item) => item?.title)],
    mediaGroup: payload?.mediaGroup || preview?.mediaGroup || 'game',
    mediaType: payload?.mediaType || preview?.mediaType || 'visual_novel',
    format: payload?.format || preview?.format || 'visual_novel',
    firstPublishedAt: payload?.firstPublishedAt || raw?.released,
    externalIds: { ...(payload?.externalIds || {}), vndbId: id },
    links: sourceLink('vndb', id, row),
    note: row?.yuriCreateCandidateV2?.note || row?.yuriCreateCandidate?.note,
    signals: {
      gateStatus: status,
      matchedTags: list(row?.yuriCreateCandidate?.matchedTags),
      sensitiveReasons: list(row?.yuriCreateCandidate?.sensitiveReasons),
    },
    blockers,
    warnings,
    row,
    snapshot,
  })
}

function steamBucket(row, snapshotPath) {
  const explicit = val(row?.bucket || row?.steamDiscoveryBucket)
  if (explicit) return explicit
  return path.basename(snapshotPath).match(/p[0-9]-[a-z0-9-]+/iu)?.[0] || ''
}

function normalizeSteam(row, snapshot) {
  const preview = row?.createCandidatePreview || {}
  const payload = preview?.payloadPreview || preview
  const raw = row?.raw || preview?.raw || {}
  const id = val(row?.steamAppId || raw?.appid || raw?.appId || sourceIdFromRows('steam', row))
  const bucket = steamBucket(row, snapshot.path)
  const accepted = /^p[1-4]-/u.test(bucket)
  const blockers = accepted ? [] : ['steam_input_not_in_yuri_discovery_bucket']
  const warnings = /^p[2-4]-/u.test(bucket) ? [`steam_review_bucket:${bucket}`] : []
  return baseCandidate({
    source: 'steam',
    id,
    title: row?.title || raw?.name || payload?.title,
    originalTitle: payload?.originalTitle || raw?.name,
    aliases: payload?.aliases,
    mediaGroup: payload?.mediaGroup || preview?.mediaGroup || 'game',
    mediaType: payload?.mediaType || preview?.mediaType || 'game',
    format: payload?.format || preview?.format || 'unknown',
    firstPublishedAt: payload?.firstPublishedAt || raw?.release_date?.date,
    externalIds: { ...(payload?.externalIds || {}), steamAppId: id },
    links: sourceLink('steam', id, row),
    note: candidateSources(row).map((item) => item?.note).filter(Boolean).join(' | '),
    signals: {
      bucket,
      yuriCandidateScore: payload?.yuriCandidateScore,
      relationSourceKinds: list(row?.relation?.sourceKinds),
    },
    blockers,
    warnings,
    row,
    snapshot,
  })
}

function normalizeRow(source, row, snapshot) {
  if (source === 'bangumi') return normalizeBangumi(row, snapshot)
  if (source === 'yurizukan') return normalizeYurizukan(row, snapshot)
  if (source === 'vndb') return normalizeVndb(row, snapshot)
  if (source === 'steam') return normalizeSteam(row, snapshot)
  throw new Error(`Unsupported source: ${source}`)
}

function candidateFingerprint(candidate) {
  const date = val(candidate.firstPublishedAt)
  return [normalizeIdentityText(candidate.title), candidate.mediaGroup, candidate.mediaType, date].join('|')
}

function annotateCrossSourceCandidates(candidates) {
  const groups = new Map()
  for (const candidate of candidates) {
    const key = candidateFingerprint(candidate)
    if (!normalizeIdentityText(candidate.title)) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(candidate)
  }
  for (const rows of groups.values()) {
    const sources = new Set(rows.map((row) => row.source))
    if (rows.length < 2 || sources.size < 2) continue
    const ids = rows.map((row) => row.discoveryId)
    for (const row of rows) {
      row.relatedDiscoveryIds = ids.filter((id) => id !== row.discoveryId)
      row.discoveryWarnings = [...new Set([...row.discoveryWarnings, 'cross_source_title_type_date_candidate'])]
    }
  }
}

function runPlanner({ candidatesFile, worksFile, outDir }) {
  const result = spawnSync(process.execPath, [
    path.resolve('scripts/radar/prepare-discovered-work-candidates-v01.mjs'),
    '--candidates', candidatesFile,
    '--works', worksFile,
    '--out-dir', outDir,
  ], { stdio: 'inherit', shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Discovered-work planner failed with exit code ${result.status}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write || args.patch || args.fetch) {
    throw new Error('Controlled source discovery is snapshot preparation only. It cannot fetch, apply, create, update, or publish Works.')
  }
  const worksFile = val(args.works)
  if (!worksFile || !fs.existsSync(worksFile)) throw new Error('--works must point to an existing local Works/AI input JSONL snapshot')
  const requestedSources = SOURCE_KEYS.filter((source) => val(args[source]))
  if (!requestedSources.length) throw new Error('Provide at least one source snapshot: --bangumi, --yurizukan, --vndb, or --steam')

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomUUID().slice(0, 8)}`
  const runDir = val(args['out-dir']) || path.join(DEFAULT_ROOT, runId)
  assertUnderDataLocal(runDir)
  if (fs.existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`)
  fs.mkdirSync(runDir, { recursive: true })

  const inputManifest = []
  const candidates = []
  for (const source of requestedSources) {
    const files = collectInputFiles(val(args[source]))
    if (!files.length) throw new Error(`No JSON/JSONL source snapshots found for ${source}: ${args[source]}`)
    for (const file of files) {
      const stat = fs.statSync(file)
      const sha256 = sha256File(file)
      const rows = readSnapshotRows(file)
      inputManifest.push({ source, path: file, sha256, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), rows: rows.length })
      rows.forEach((row, index) => candidates.push(normalizeRow(source, row, {
        path: file,
        sha256,
        modifiedAt: stat.mtime.toISOString(),
        rowNumber: index + 1,
      })))
    }
  }

  const seenDiscoveryIds = new Map()
  for (const candidate of candidates) {
    const previous = seenDiscoveryIds.get(candidate.discoveryId)
    if (previous) {
      candidate.discoveryBlockers = [...new Set([...candidate.discoveryBlockers, 'duplicate_discovery_id_in_snapshot'])]
      previous.discoveryBlockers = [...new Set([...previous.discoveryBlockers, 'duplicate_discovery_id_in_snapshot'])]
    } else seenDiscoveryIds.set(candidate.discoveryId, candidate)
  }
  annotateCrossSourceCandidates(candidates)

  const normalizedFile = path.join(runDir, 'normalized', 'controlled-source-candidates-v01.jsonl')
  const blockedFile = path.join(runDir, 'normalized', 'controlled-source-candidates-v01-blocked.jsonl')
  const reviewFile = path.join(runDir, 'normalized', 'controlled-source-candidates-v01-review.jsonl')
  writeJsonl(normalizedFile, candidates)
  writeJsonl(blockedFile, candidates.filter((row) => row.discoveryBlockers.length))
  writeJsonl(reviewFile, candidates.filter((row) => !row.discoveryBlockers.length && row.discoveryWarnings.length))

  const plannerDir = path.join(runDir, 'candidate-plan')
  runPlanner({ candidatesFile: normalizedFile, worksFile, outDir: plannerDir })

  const summary = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    runDir,
    worksSnapshot: {
      path: worksFile,
      sha256: sha256File(worksFile),
    },
    sourcePolicies: SOURCE_POLICY,
    sourceInputs: inputManifest,
    counts: {
      normalized: candidates.length,
      blockedBeforeDedupe: candidates.filter((row) => row.discoveryBlockers.length).length,
      warningReview: candidates.filter((row) => !row.discoveryBlockers.length && row.discoveryWarnings.length).length,
      bySource: Object.fromEntries(SOURCE_KEYS.map((source) => [source, candidates.filter((row) => row.source === source).length])),
    },
    outputs: {
      normalizedFile,
      normalizedSha256: sha256File(normalizedFile),
      blockedFile,
      reviewFile,
      plannerDir,
      plannerSummary: path.join(plannerDir, 'discovered-work-candidate-plan-v01-summary.json'),
    },
    safety: {
      externalFetch: false,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      createsWorks: false,
      updatesWorks: false,
      publishesWorks: false,
      mutatesHumanAssessment: false,
      mutatesRadarAssessment: false,
      sourceSnapshotHashesRequired: true,
      failOnFirstError: true,
    },
    nextStep: 'Review source blockers/warnings and the candidate plan. A later checkpoint-gated editor apply workflow may create temporary drafts or update source metadata; this command cannot do so.',
  }
  writeJson(path.join(runDir, 'summary.json'), summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
