#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_INPUT = 'data_local/staging/work-merge/work-merge-strict-safe-verify-v01-verified.groups.jsonl'
const DEFAULT_OUT_DIR = 'data_local/staging/work-merge'
const VERSION = 'work-merge-field-plan-v0.1'

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
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
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

function normalizeText(value) {
  return val(value).normalize('NFKC').toLowerCase()
}

function normalizeUrl(value) {
  return val(value).replace(/\/$/u, '')
}

function uniqueBy(values, getKey) {
  const seen = new Set()
  const out = []
  for (const item of values) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function titleValues(group) {
  const preserved = group.preservedDataPreview || {}
  const values = [
    group.master?.title,
    ...(Array.isArray(group.master?.localizedTitles) ? group.master.localizedTitles : []),
    ...(Array.isArray(group.master?.aliases) ? group.master.aliases : []),
    ...((group.supplements || []).flatMap((item) => [
      item.title,
      ...(Array.isArray(item.localizedTitles) ? item.localizedTitles : []),
      ...(Array.isArray(item.aliases) ? item.aliases : []),
    ])),
    ...(Array.isArray(preserved.titles) ? preserved.titles : []),
  ]
  return uniqueBy(values.map(val).filter(Boolean), normalizeText)
}

function sourceLinks(group) {
  const preserved = group.preservedDataPreview || {}
  const values = [
    ...(Array.isArray(group.master?.sourceLinks) ? group.master.sourceLinks.map((url) => ({ label: 'Bangumi', url })) : []),
    ...((group.supplements || []).flatMap((item) => Array.isArray(item.sourceLinks) ? item.sourceLinks.map((url) => ({ label: 'AniList', url })) : [])),
    ...(Array.isArray(preserved.sourceLinks) ? preserved.sourceLinks : []),
  ]
  return uniqueBy(
    values
      .map((item) => ({ label: val(item.label), url: normalizeUrl(item.url) }))
      .filter((item) => item.url),
    (item) => item.url,
  )
}

function candidateSources(group) {
  const preserved = group.preservedDataPreview || {}
  const values = [
    ...(Array.isArray(group.master?.candidateSources) ? group.master.candidateSources : []),
    ...((group.supplements || []).flatMap((item) => Array.isArray(item.candidateSources) ? item.candidateSources : [])),
    ...(Array.isArray(preserved.candidateSources) ? preserved.candidateSources : []),
  ]
  return uniqueBy(
    values
      .map((item) => ({
        source: val(item.source),
        label: val(item.label),
        externalId: val(item.externalId),
        url: normalizeUrl(item.url),
        note: val(item.note),
      }))
      .filter((item) => item.source || item.externalId || item.url),
    (item) => [item.source, item.externalId, item.url].join('|'),
  )
}

function externalIdPlan(group) {
  const merged = { ...(group.master?.externalIds || {}) }
  const additions = {}
  const conflicts = []
  const preserved = group.preservedDataPreview?.externalIds || {}
  const incomingDocs = group.supplements || []
  const incomingIdObjects = [...incomingDocs.map((doc) => doc.externalIds || {}), preserved]

  for (const ids of incomingIdObjects) {
    for (const [field, rawValue] of Object.entries(ids)) {
      const value = val(rawValue)
      if (!value) continue
      const existing = val(merged[field])
      if (!existing) {
        merged[field] = value
        additions[field] = value
      } else if (existing !== value) {
        conflicts.push({ field, existing, incoming: value })
      }
    }
  }

  return { merged, additions, conflicts }
}

function differenceBy(before, after, getKey) {
  const beforeKeys = new Set(before.map(getKey).filter(Boolean))
  return after.filter((item) => !beforeKeys.has(getKey(item)))
}

function buildFieldPlan(group) {
  const master = group.master || {}
  const blockers = []
  const warnings = []
  if (group.verificationStatus !== 'verified') blockers.push('not_verified')
  if (!master.id) blockers.push('missing_master_id')
  if (!Array.isArray(group.supplements) || group.supplements.length !== 1) blockers.push('expected_one_supplement')

  const titles = titleValues(group)
  const links = sourceLinks(group)
  const sources = candidateSources(group)
  const ids = externalIdPlan(group)
  if (ids.conflicts.length) blockers.push('external_id_conflict')
  if (!ids.merged.bangumiSubjectId) warnings.push('missing_bangumi_id')
  if (!ids.merged.anilistMediaId) warnings.push('missing_anilist_id')

  const beforeTitles = [
    master.title,
    ...(Array.isArray(master.localizedTitles) ? master.localizedTitles : []),
    ...(Array.isArray(master.aliases) ? master.aliases : []),
  ].map(val).filter(Boolean)
  const beforeLinks = Array.isArray(master.sourceLinks) ? master.sourceLinks.map((url) => ({ label: '', url: normalizeUrl(url) })) : []
  const beforeSources = Array.isArray(master.candidateSources) ? master.candidateSources : []

  const newTitles = differenceBy(titles, beforeTitles, normalizeText)
  const newLinks = differenceBy(links, beforeLinks, (item) => normalizeUrl(item.url))
  const newSources = differenceBy(sources, beforeSources, (item) => [val(item.source), val(item.externalId), normalizeUrl(item.url)].join('|'))

  const fieldAdditions = {
    externalIds: ids.additions,
    titles: newTitles,
    sourceLinks: newLinks,
    candidateSources: newSources,
  }

  const changedFields = []
  if (Object.keys(fieldAdditions.externalIds).length) changedFields.push('externalIds')
  if (fieldAdditions.titles.length) changedFields.push('titles')
  if (fieldAdditions.sourceLinks.length) changedFields.push('sourceLinks')
  if (fieldAdditions.candidateSources.length) changedFields.push('candidateSources')
  if (!changedFields.length) warnings.push('no_new_master_fields')

  return {
    mergeGroupId: val(group.mergeGroupId || group.groupId),
    planStatus: blockers.length ? 'blocked' : 'ready_for_review',
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    changedFields,
    master: {
      id: val(master.id),
      title: val(master.title),
      slug: val(master.slug),
      siteId: val(master.siteId),
      source: val(master.source),
    },
    supplements: (group.supplements || []).map((item) => ({
      id: val(item.id),
      title: val(item.title),
      slug: val(item.slug),
      siteId: val(item.siteId),
      source: val(item.source),
    })),
    fieldAdditions,
    mergedFieldPreview: {
      externalIds: ids.merged,
      titles,
      sourceLinks: links,
      candidateSources: sources,
    },
    followUpPolicyPreview: {
      keepMasterAsCanonical: true,
      keepSupplementAsLowerPrioritySourceRecordUntilApplyReviewed: true,
      doNotDeleteAnyRecordInThisStep: true,
      requireSeparateApplyApproval: true,
    },
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
      executableOperation: false,
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
    '# Work Merge Field Plan v0.1',
    '',
    'Read-only field merge plan for verified strict safe same-work groups. This is a review report only and does not contain an executable Payload operation.',
    '',
    '## Summary',
    '',
    `- generatedAt: ${summary.generatedAt}`,
    `- ok: ${summary.ok}`,
    `- groupsRead: ${summary.groupsRead}`,
    `- groupsLoaded: ${summary.groupsLoaded}`,
    `- parseFailures: ${summary.parseFailures}`,
    `- readyGroups: ${summary.readyGroups}`,
    `- blockedGroups: ${summary.blockedGroups}`,
    '',
    '## Safety',
    '',
    '- Read local verified group report only.',
    '- No Payload read.',
    '- No Payload write.',
    '- No PostgreSQL write.',
    '- No data change.',
    '- No executable operation generated.',
    '',
    '## Plan status',
    '',
    '| Status | Count |',
    '|---|---:|',
    ...Object.entries(summary.byStatus).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Changed fields',
    '',
    '| Field | Count |',
    '|---|---:|',
    ...Object.entries(summary.byChangedField).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Warnings',
    '',
    '| Warning | Count |',
    '|---|---:|',
    ...Object.entries(summary.byWarning).map(([key, count]) => `| ${key} | ${count} |`),
    '',
    '## Blockers',
    '',
    '| Blocker | Count |',
    '|---|---:|',
    ...Object.entries(summary.byBlocker).map(([key, count]) => `| ${key} | ${count} |`),
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
  const inputPath = String(args.input || DEFAULT_INPUT)
  const outDir = String(args['out-dir'] || DEFAULT_OUT_DIR)
  if (!fs.existsSync(inputPath)) throw new Error(`verified groups file not found: ${inputPath}`)

  const input = await readJsonl(inputPath)
  const plans = input.rows.map(buildFieldPlan)
  const ready = plans.filter((item) => item.planStatus === 'ready_for_review')
  const blocked = plans.filter((item) => item.planStatus === 'blocked')
  const changedFields = plans.flatMap((item) => item.changedFields || [])
  const warnings = plans.flatMap((item) => item.warnings || [])
  const blockers = plans.flatMap((item) => item.blockers || [])

  const outputs = {
    plans: path.join(outDir, 'work-merge-field-plan-v01.plans.jsonl'),
    ready: path.join(outDir, 'work-merge-field-plan-v01-ready.groups.jsonl'),
    blocked: path.join(outDir, 'work-merge-field-plan-v01-blocked.groups.jsonl'),
    summary: path.join(outDir, 'work-merge-field-plan-v01-summary.json'),
    json: path.join(outDir, 'work-merge-field-plan-v01.json'),
    md: path.join(outDir, 'work-merge-field-plan-v01.md'),
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    ok: input.failed === 0 && blocked.length === 0,
    inputFile: inputPath,
    groupsRead: input.read,
    groupsLoaded: input.rows.length,
    parseFailures: input.failed,
    readyGroups: ready.length,
    blockedGroups: blocked.length,
    byStatus: countBy(plans, 'planStatus'),
    byChangedField: countBy(changedFields, (value) => value),
    byWarning: countBy(warnings, (value) => value),
    byBlocker: countBy(blockers, (value) => value),
    outputs,
    safety: {
      localReportReadOnly: true,
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      dataChanged: false,
      executableOperation: false,
    },
  }

  const samples = { ready: ready.slice(0, 20), blocked: blocked.slice(0, 20) }
  const report = { ok: summary.ok, summary, samples }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outputs.plans, plans.map((item) => JSON.stringify(item)).join('\n') + (plans.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.ready, ready.map((item) => JSON.stringify(item)).join('\n') + (ready.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.blocked, blocked.map((item) => JSON.stringify(item)).join('\n') + (blocked.length ? '\n' : ''), 'utf8')
  fs.writeFileSync(outputs.summary, JSON.stringify(summary, null, 2), 'utf8')
  fs.writeFileSync(outputs.json, JSON.stringify(report, null, 2), 'utf8')
  fs.writeFileSync(outputs.md, markdown(summary, samples), 'utf8')

  console.log(JSON.stringify({ ok: summary.ok, summary, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
