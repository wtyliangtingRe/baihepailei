#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_GROUPS = 'data_local/staging/work-merge/work-merge-plan-v01.groups.jsonl'
const FALLBACK_GROUPS = 'data_local/staging/import/work-merge-plan-v01.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const VERSION = 'work-merge-plan-refine-v0.2'

function val(value) {
  return String(value ?? '').trim()
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

async function readJsonl(file) {
  const rows = []
  let read = 0
  let failed = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const body = line.trim()
    if (!body) continue
    read += 1
    try {
      rows.push(JSON.parse(body))
    } catch {
      failed += 1
    }
  }

  return { rows, read, failed }
}

function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3000\s]+/gu, '')
    .replace(/[『』「」《》〈〉【】\[\]()（）{}｛｝]/gu, '')
    .replace(/[!！?？:：;；,，.。・･·'’`｀"“”~〜～_＿\-ー—–]+/gu, '')
}

function punctuationProfile(value) {
  const text = val(value).normalize('NFKC')
  return {
    bang: (text.match(/[!！]/gu) || []).length,
    question: (text.match(/[?？]/gu) || []).length,
    colon: (text.match(/[:：]/gu) || []).length,
    seasonWords: (text.match(/\b(season|part|cour|chapter|episode|ova|ona|movie|the movie|2nd|3rd|4th|ii|iii|iv|v)\b/giu) || []).length,
    digits: (text.match(/\d+/gu) || []).join(','),
    roman: (text.match(/\b[ivx]{2,}\b/giu) || []).join(',').toLowerCase(),
    repeatedPunctuationTail: /[!！?？]{2,}$/u.test(text),
  }
}

function titlesOfDoc(doc) {
  const values = [
    doc.title,
    doc.originalTitle,
    ...(Array.isArray(doc.titles) ? doc.titles : []),
    ...(Array.isArray(doc.displayTitles) ? doc.displayTitles : []),
  ]
  return [...new Set(values.map(val).filter(Boolean))]
}

function allDocs(group) {
  const master = group.master || group.keeper || null
  const supplements = group.supplements || group.mergeFrom || []
  return [master, ...supplements].filter(Boolean)
}

function masterDoc(group) {
  return group.master || group.keeper || null
}

function supplementsOf(group) {
  return group.supplements || group.mergeFrom || []
}

function sourceOf(doc) {
  return val(doc?.source || doc?.chosenBaseSource || 'unknown').toLowerCase() || 'unknown'
}

function sourceCounts(group) {
  if (group.sourceCounts && typeof group.sourceCounts === 'object') return group.sourceCounts
  const out = {}
  for (const doc of allDocs(group)) {
    const source = sourceOf(doc)
    out[source] = (out[source] || 0) + 1
  }
  return out
}

function countValues(values) {
  const out = {}
  for (const value of values) {
    const key = val(value) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return out
}

function mediaTypes(group) {
  if (group.mediaTypes && typeof group.mediaTypes === 'object') return group.mediaTypes
  return countValues(allDocs(group).map((doc) => doc.mediaType || 'unknown'))
}

function mediaGroups(group) {
  if (group.mediaGroups && typeof group.mediaGroups === 'object') return group.mediaGroups
  return countValues(allDocs(group).map((doc) => doc.mediaGroup || 'unknown'))
}

function externalIdsOfDoc(doc) {
  if (!doc?.externalIds || typeof doc.externalIds !== 'object') return []
  const out = []
  for (const [field, value] of Object.entries(doc.externalIds)) {
    if (!value) continue
    if (typeof value === 'object' && value.conflict && Array.isArray(value.values)) {
      for (const nested of value.values) out.push(`${field}:${nested}`)
    } else {
      out.push(`${field}:${value}`)
    }
  }
  return out
}

function hasExternalIdConflict(group) {
  const mergedExternalIds = group.mergedPreview?.externalIds || group.mergePatchPreview?.externalIdsToPreserve || {}
  if (Array.isArray(mergedExternalIds)) return false
  return Object.values(mergedExternalIds).some((value) => value && typeof value === 'object' && value.conflict)
}

function uniqueSources(group) {
  return Object.keys(sourceCounts(group)).filter(Boolean)
}

function hasRepeatedSource(group) {
  return Object.values(sourceCounts(group)).some((count) => Number(count) > 1)
}

function hasMediaMismatch(group) {
  return Object.keys(mediaTypes(group)).length > 1 || Object.keys(mediaGroups(group)).length > 1
}

function hasOneToOneCrossSource(group) {
  const docs = allDocs(group)
  return docs.length === 2 && uniqueSources(group).length === 2 && !hasRepeatedSource(group)
}

function isTitleOnly(group) {
  const confidence = val(group.confidence).toLowerCase()
  if (confidence === 'title-review' || confidence === 'low' || confidence === 'medium') return true
  const reasons = Array.isArray(group.reasons) ? group.reasons : []
  return reasons.includes('shared_normalized_title') && !reasons.includes('shared_external_id_or_url')
}

function hasStrongEvidence(group) {
  const confidence = val(group.confidence).toLowerCase()
  if (confidence === 'strong' || confidence === 'high') return true
  const reasons = Array.isArray(group.reasons) ? group.reasons : []
  return reasons.includes('shared_external_id_or_url')
}

function possibleSeasonOrSeriesSplit(group) {
  const docs = allDocs(group)
  const titleLists = docs.map(titlesOfDoc)
  const primaryTitles = titleLists.map((titles) => titles[0] || '')
  const normalized = primaryTitles.map(normalizeTitle).filter(Boolean)
  const uniqueNormalized = [...new Set(normalized)]

  if (uniqueNormalized.length > 1) {
    const profiles = primaryTitles.map(punctuationProfile)
    const digitSet = new Set(profiles.map((profile) => profile.digits).filter(Boolean))
    const romanSet = new Set(profiles.map((profile) => profile.roman).filter(Boolean))
    if (digitSet.size > 1 || romanSet.size > 1) return true
    if (profiles.some((profile) => profile.seasonWords > 0)) return true
    return false
  }

  if (primaryTitles.length <= 1) return false
  const profiles = primaryTitles.map(punctuationProfile)
  const bangCounts = new Set(profiles.map((profile) => profile.bang))
  const questionCounts = new Set(profiles.map((profile) => profile.question))
  const tailVaries = new Set(profiles.map((profile) => String(profile.repeatedPunctuationTail)))

  if (bangCounts.size > 1 || questionCounts.size > 1 || tailVaries.size > 1) return true
  if (profiles.some((profile) => profile.seasonWords > 0)) return true
  return false
}

function shortDoc(doc) {
  return {
    id: val(doc?.id),
    title: val(doc?.title),
    slug: val(doc?.slug),
    siteId: val(doc?.siteId),
    source: sourceOf(doc),
    rank: val(doc?.rank),
    mediaGroup: val(doc?.mediaGroup),
    mediaType: val(doc?.mediaType),
    status: val(doc?.status),
    reviewStatus: val(doc?.reviewStatus),
    evidenceStrength: val(doc?.evidenceStrength),
    titles: titlesOfDoc(doc).slice(0, 20),
    externalIds: externalIdsOfDoc(doc).slice(0, 20),
  }
}

function classifyGroup(group) {
  const docs = allDocs(group)
  const reasons = []
  const blockers = []
  const warnings = []

  if (docs.length < 2) blockers.push('group_too_small')
  if (docs.length > 8) warnings.push('large_group')
  if (hasMediaMismatch(group)) blockers.push('media_mismatch')
  if (hasRepeatedSource(group)) warnings.push('repeated_source_in_group')
  if (hasExternalIdConflict(group)) blockers.push('external_id_conflict')
  if (possibleSeasonOrSeriesSplit(group)) warnings.push('possible_season_or_series_split')
  if (isTitleOnly(group)) warnings.push('title_only_match')
  if (!hasStrongEvidence(group)) warnings.push('no_strong_external_evidence')

  if (hasStrongEvidence(group)) reasons.push('strong_external_or_cross_source_evidence')
  if (hasOneToOneCrossSource(group)) reasons.push('one_to_one_cross_source')

  let bucket = 'review'
  if (blockers.length) bucket = 'blocked'
  else if (
    hasStrongEvidence(group) &&
    hasOneToOneCrossSource(group) &&
    !hasRepeatedSource(group) &&
    !possibleSeasonOrSeriesSplit(group) &&
    !isTitleOnly(group)
  ) bucket = 'safe'
  else bucket = 'review'

  return {
    mergeGroupId: val(group.mergeGroupId || group.groupId),
    bucket,
    confidence: val(group.confidence),
    groupSize: Number(group.groupSize || docs.length),
    reasons,
    blockers,
    warnings,
    sourceCounts: sourceCounts(group),
    mediaTypes: mediaTypes(group),
    mediaGroups: mediaGroups(group),
    master: shortDoc(masterDoc(group)),
    supplements: supplementsOf(group).map(shortDoc),
    mergedPreview: group.mergedPreview || group.mergePatchPreview || null,
    originalNeedsManualReview: Boolean(group.needsManualReview),
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      mergeApplied: false,
      applyAllowed: false,
    },
  }
}

function countBy(rows, getKey) {
  const out = {}
  for (const row of rows) {
    const key = val(typeof getKey === 'function' ? getKey(row) : row[getKey]) || 'missing'
    out[key] = (out[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function mdTable(title, rows, keyLabel = 'Key') {
  return [
    `## ${title}`,
    '',
    `| ${keyLabel} | Count |`,
    '|---|---:|',
    ...Object.entries(rows || {}).map(([key, count]) => `| ${key} | ${count} |`),
    '',
  ]
}

function markdown(summary, samples) {
  return [
    '# Work Merge Plan Refinement v0.2',
    '',
    'Read-only refinement for same-work merge candidates. It classifies v01 groups into safe, review, and blocked buckets. No merge is performed.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- parseFailures: ${summary.parseFailures}`,
    `- safeGroups: ${summary.safeGroups}`,
    `- reviewGroups: ${summary.reviewGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Safety',
    '',
    '- Read local v01 report only.',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No merge performed.',
    '',
    ...mdTable('Buckets', summary.byBucket, 'Bucket'),
    ...mdTable('Warnings', summary.byWarning, 'Warning'),
    ...mdTable('Blockers', summary.byBlocker, 'Blocker'),
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

function resolveGroupsPath(args) {
  if (args.groups) return String(args.groups)
  if (fs.existsSync(DEFAULT_GROUPS)) return DEFAULT_GROUPS
  if (fs.existsSync(FALLBACK_GROUPS)) return FALLBACK_GROUPS
  return DEFAULT_GROUPS
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const groupsPath = resolveGroupsPath(args)
  const outDir = String(args['out-dir'] || path.dirname(groupsPath) || DEFAULT_OUT_DIR)
  if (!fs.existsSync(groupsPath)) throw new Error(`v01 groups file not found: ${groupsPath}`)

  const input = await readJsonl(groupsPath)
  const classified = input.rows.map(classifyGroup)
  const safe = classified.filter((group) => group.bucket === 'safe')
  const review = classified.filter((group) => group.bucket === 'review')
  const blocked = classified.filter((group) => group.bucket === 'blocked')

  const outputs = {
    safe: path.join(outDir, 'work-merge-plan-v02-safe.groups.jsonl'),
    review: path.join(outDir, 'work-merge-plan-v02-review.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-plan-v02-blocked.groups.jsonl'),
    json: path.join(outDir, 'work-merge-plan-v02.json'),
    summary: path.join(outDir, 'work-merge-plan-v02-summary.json'),
    md: path.join(outDir, 'work-merge-plan-v02.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0,
    groupsFile: groupsPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    safeGroups: safe.length,
    reviewGroups: review.length,
    blockedGroups: blocked.length,
    byBucket: countBy(classified, 'bucket'),
    byWarning: countBy(classified.flatMap((group) => group.warnings), (value) => value),
    byBlocker: countBy(classified.flatMap((group) => group.blockers), (value) => value),
    outputs,
    safety: {
      readOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      mergeApplied: false,
      applyAllowed: false,
    },
  }

  const samples = {
    safe: safe.slice(0, 20),
    review: review.slice(0, 20),
    blocked: blocked.slice(0, 20),
  }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.safe, safe.map((group) => JSON.stringify(group)).join('\n') + (safe.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.review, review.map((group) => JSON.stringify(group)).join('\n') + (review.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((group) => JSON.stringify(group)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
