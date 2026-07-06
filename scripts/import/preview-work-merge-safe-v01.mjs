#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_SAFE_GROUPS = 'data_local/staging/work-merge/work-merge-plan-v02-safe.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const VERSION = 'work-merge-safe-preview-v0.1'

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

function compactDoc(doc) {
  return {
    id: val(doc?.id),
    title: val(doc?.title),
    slug: val(doc?.slug),
    siteId: val(doc?.siteId),
    source: val(doc?.source || 'unknown'),
    rank: val(doc?.rank),
    mediaGroup: val(doc?.mediaGroup),
    mediaType: val(doc?.mediaType),
    status: val(doc?.status),
    reviewStatus: val(doc?.reviewStatus),
    evidenceStrength: val(doc?.evidenceStrength),
    titles: Array.isArray(doc?.titles) ? doc.titles.map(val).filter(Boolean) : [],
    externalIds: Array.isArray(doc?.externalIds) ? doc.externalIds.map(val).filter(Boolean) : [],
  }
}

function sourceKey(item) {
  return [val(item?.source), val(item?.externalId), val(item?.url)].join('|')
}

function compactCandidateSources(values) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const source = val(item?.source)
    const label = val(item?.label)
    const externalId = val(item?.externalId)
    const url = val(item?.url)
    const note = val(item?.note)
    const key = sourceKey({ source, externalId, url })
    if ((!source && !label && !externalId && !url) || seen.has(key)) continue
    seen.add(key)
    out.push({ source, label, externalId, url, note })
  }
  return out
}

function compactSourceLinks(values) {
  const seen = new Set()
  const out = []
  for (const item of values || []) {
    const label = val(item?.label)
    const url = val(item?.url).replace(/\/$/u, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ label, url })
  }
  return out
}

function previewGroup(group) {
  const master = group.master || group.keeper || {}
  const supplements = group.supplements || group.mergeFrom || []
  const mergedPreview = group.mergedPreview || group.mergePatchPreview || {}
  const candidateSources = compactCandidateSources(mergedPreview.candidateSources || [])
  const sourceLinks = compactSourceLinks(mergedPreview.sourceLinks || [])
  const externalIds = mergedPreview.externalIds || {}
  const titles = Array.isArray(mergedPreview.titles) ? mergedPreview.titles.map(val).filter(Boolean) : []

  const warnings = []
  if (group.bucket !== 'safe') warnings.push('not_safe_bucket')
  if (supplements.length !== 1) warnings.push('not_one_to_one')
  if (!candidateSources.length) warnings.push('missing_candidate_sources')
  if (!sourceLinks.length) warnings.push('missing_source_links')
  if (!Object.keys(externalIds).length) warnings.push('missing_external_ids')

  return {
    mergeGroupId: val(group.mergeGroupId || group.groupId),
    reviewBucket: val(group.bucket || 'safe'),
    confidence: val(group.confidence),
    groupSize: Number(group.groupSize || 1 + supplements.length),
    warnings,
    reasons: Array.isArray(group.reasons) ? group.reasons : [],
    master: compactDoc(master),
    supplements: supplements.map(compactDoc),
    preservedDataPreview: {
      titles,
      candidateSources,
      sourceLinks,
      externalIds,
    },
    intendedPolicy: {
      keepMasterRecord: true,
      supplementLowerPrioritySources: true,
      preserveSourceLinks: true,
      preserveExternalIds: true,
      preserveTitles: true,
      requiresHumanReviewBeforeAnyWrite: true,
    },
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
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

function markdown(summary, samples) {
  return [
    '# Safe Work Merge Preview v0.1',
    '',
    'Read-only preview for v02 safe same-work groups. This report does not change Payload or PostgreSQL data.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- parseFailures: ${summary.parseFailures}`,
    `- previewGroups: ${summary.previewGroups}`,
    `- warningGroups: ${summary.warningGroups}`,
    '',
    '## Safety',
    '',
    '- Read local v02 safe group report only.',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '',
    '## Warnings',
    '',
    '| Warning | Count |',
    '|---|---:|',
    ...Object.entries(summary.byWarning).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Master source',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.byMasterSource).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Supplement source',
    '',
    '| Source | Count |',
    '|---|---:|',
    ...Object.entries(summary.bySupplementSource).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Samples',
    '',
    '```json',
    JSON.stringify(samples, null, 2),
    '```',
    '',
  ].join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const groupsPath = String(args.groups || DEFAULT_SAFE_GROUPS)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  if (!fs.existsSync(groupsPath)) throw new Error(`safe groups file not found: ${groupsPath}`)

  const input = await readJsonl(groupsPath)
  const previews = input.rows.map(previewGroup)
  const warnings = previews.flatMap((item) => item.warnings || [])
  const warningGroups = previews.filter((item) => item.warnings?.length).length
  const supplementSources = previews.flatMap((item) => item.supplements.map((doc) => doc.source))

  const outputs = {
    previews: path.join(outDir, 'work-merge-safe-preview-v01.groups.jsonl'),
    json: path.join(outDir, 'work-merge-safe-preview-v01.json'),
    summary: path.join(outDir, 'work-merge-safe-preview-v01-summary.json'),
    md: path.join(outDir, 'work-merge-safe-preview-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0,
    groupsFile: groupsPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    previewGroups: previews.length,
    warningGroups,
    byWarning: countBy(warnings, (value) => value),
    byMasterSource: countBy(previews, (item) => item.master.source),
    bySupplementSource: countBy(supplementSources, (value) => value),
    outputs,
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
    },
  }

  const samples = previews.slice(0, 30)
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.previews, previews.map((item) => JSON.stringify(item)).join('\n') + (previews.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
