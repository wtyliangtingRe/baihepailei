#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeJsonFile } from '../lib/jsonl.mjs'

const VALID_ORGANIZATION_TYPES = new Set([
  'publisher',
  'production_company',
  'animation_studio',
  'game_company',
  'distributor',
  'circle',
  'brand',
  'platform',
  'committee',
  'other',
])
const RELATIONSHIP_FIELDS = ['works', 'work', 'creatorCredits', 'workOrganizations', 'relationships', 'creators']

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : 'true'
    args.set(key, value)
    if (value !== 'true') index += 1
  }
  return args
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function rows(seed, collection) {
  return Array.isArray(seed?.[collection]) ? seed[collection] : []
}

function duplicateValues(items, getValue) {
  const seen = new Set()
  const dupes = new Set()
  for (const item of items) {
    const value = cleanText(getValue(item)).toLowerCase()
    if (!value) continue
    if (seen.has(value)) dupes.add(value)
    seen.add(value)
  }
  return [...dupes].sort((a, b) => a.localeCompare(b))
}

function richTextText(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richTextText).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    return Object.values(value).map(richTextText).filter(Boolean).join('\n')
  }
  return ''
}

function hasRichTextRoot(value) {
  return Boolean(value?.root && Array.isArray(value.root.children))
}

function makeCheck(name, pass, actual, expected, details = []) {
  return { name, pass: Boolean(pass), actual, expected, details }
}

export function auditBangumiPayloadEntitySeed(seed) {
  const creators = rows(seed, 'creators')
  const organizations = rows(seed, 'organizations')
  const allRows = [...creators, ...organizations]
  const meta = seed?.meta || {}
  const duplicateSlugs = duplicateValues(allRows, (row) => row.slug)
  const duplicateSiteIds = duplicateValues(allRows, (row) => row.siteId)
  const duplicateCreatorNames = duplicateValues(creators, (row) => row.name)
  const duplicateOrganizationNames = duplicateValues(organizations, (row) => row.name)
  const invalidOrganizationTypes = organizations.filter((row) => !VALID_ORGANIZATION_TYPES.has(row.type)).map((row) => `${row.name}:${row.type}`)
  const nonDraftRows = allRows.filter((row) => row.status !== 'draft').map((row) => row.name || row.slug)
  const visibleRows = allRows.filter((row) => row.isLiteVisible !== false || row.isFullVisible !== false).map((row) => row.name || row.slug)
  const missingRequired = allRows.filter((row) => !cleanText(row.name) || !cleanText(row.slug) || !cleanText(row.siteId)).map((row) => row.name || row.slug || '(missing)')
  const missingSearchText = allRows.filter((row) => !cleanText(row.searchText)).map((row) => row.name || row.slug)
  const invalidNotes = allRows.filter((row) => !hasRichTextRoot(row.notes) || !richTextText(row.notes).includes('Bangumi selected entity preview')).map((row) => row.name || row.slug)
  const invalidSourceLinks = organizations.filter((row) => Array.isArray(row.sourceLinks) && row.sourceLinks.some((link) => Object.keys(link).some((key) => !['label', 'url'].includes(key)))).map((row) => row.name || row.slug)
  const relationshipRows = allRows.filter((row) => RELATIONSHIP_FIELDS.some((field) => Object.hasOwn(row, field))).map((row) => row.name || row.slug)
  const reviewFlagRows = allRows.filter((row) => Array.isArray(row.reviewFlags) && row.reviewFlags.length > 0).map((row) => row.name || row.slug)

  const checks = [
    makeCheck('preview mode', meta.mode === 'payload-seed-preview-only', meta.mode || '', 'payload-seed-preview-only'),
    makeCheck('creators array exists', Array.isArray(seed?.creators), Array.isArray(seed?.creators), true),
    makeCheck('organizations array exists', Array.isArray(seed?.organizations), Array.isArray(seed?.organizations), true),
    makeCheck('creator count matches meta', creators.length === Number(meta.creatorsTotal || 0), creators.length, Number(meta.creatorsTotal || 0)),
    makeCheck('organization count matches meta', organizations.length === Number(meta.organizationsTotal || 0), organizations.length, Number(meta.organizationsTotal || 0)),
    makeCheck('source creator count matches output', creators.length === Number(meta.sourceCreatorsTotal || creators.length), creators.length, Number(meta.sourceCreatorsTotal || creators.length)),
    makeCheck('source organization count matches output', organizations.length === Number(meta.sourceOrganizationsTotal || organizations.length), organizations.length, Number(meta.sourceOrganizationsTotal || organizations.length)),
    makeCheck('slugs are unique', duplicateSlugs.length === 0, duplicateSlugs.length, 0, duplicateSlugs.slice(0, 20)),
    makeCheck('site IDs are unique', duplicateSiteIds.length === 0, duplicateSiteIds.length, 0, duplicateSiteIds.slice(0, 20)),
    makeCheck('creator names are unique', duplicateCreatorNames.length === 0, duplicateCreatorNames.length, 0, duplicateCreatorNames.slice(0, 20)),
    makeCheck('organization names are unique', duplicateOrganizationNames.length === 0, duplicateOrganizationNames.length, 0, duplicateOrganizationNames.slice(0, 20)),
    makeCheck('organization types are valid', invalidOrganizationTypes.length === 0, invalidOrganizationTypes.length, 0, invalidOrganizationTypes.slice(0, 20)),
    makeCheck('all rows are draft', nonDraftRows.length === 0, nonDraftRows.length, 0, nonDraftRows.slice(0, 20)),
    makeCheck('all rows are hidden', visibleRows.length === 0, visibleRows.length, 0, visibleRows.slice(0, 20)),
    makeCheck('required fields are present', missingRequired.length === 0, missingRequired.length, 0, missingRequired.slice(0, 20)),
    makeCheck('search text is present', missingSearchText.length === 0, missingSearchText.length, 0, missingSearchText.slice(0, 20)),
    makeCheck('notes use rich text root', invalidNotes.length === 0, invalidNotes.length, 0, invalidNotes.slice(0, 20)),
    makeCheck('source links match schema fields', invalidSourceLinks.length === 0, invalidSourceLinks.length, 0, invalidSourceLinks.slice(0, 20)),
    makeCheck('no relationship fields are present', relationshipRows.length === 0, relationshipRows.length, 0, relationshipRows.slice(0, 20)),
    makeCheck('no review flags are present', reviewFlagRows.length === 0, reviewFlagRows.length, 0, reviewFlagRows.slice(0, 20)),
  ]

  return {
    ok: checks.every((check) => check.pass),
    meta: {
      creatorsTotal: creators.length,
      organizationsTotal: organizations.length,
      rowsTotal: allRows.length,
      failedChecks: checks.filter((check) => !check.pass).length,
    },
    checks,
  }
}

function report(audit, inputPath = '') {
  return [
    '# Bangumi Payload entity seed audit',
    '',
    `Input: ${inputPath}`,
    `Result: ${audit.ok ? 'PASS' : 'FAIL'}`,
    `Creators: ${audit.meta.creatorsTotal}`,
    `Organizations: ${audit.meta.organizationsTotal}`,
    `Failed checks: ${audit.meta.failedChecks}`,
    '',
    '| Status | Check | Actual | Expected | Details |',
    '| --- | --- | --- | --- | --- |',
    ...audit.checks.map((check) => `| ${check.pass ? 'PASS' : 'FAIL'} | ${check.name} | ${check.actual} | ${check.expected} | ${(check.details || []).join('; ')} |`),
    '',
  ].join('\n')
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('in')
  const jsonOutput = args.get('json') || path.join('data_local', 'reports', 'bangumi-payload-entity-seed-audit.json')
  const reportOutput = args.get('report') || path.join('data_local', 'reports', 'bangumi-payload-entity-seed-audit.md')

  if (!input) {
    console.error('Usage: node tools/source_import/scripts/audit-bangumi-payload-entity-seed.mjs --in <payload-entity-seed.json> [--json <audit.json>] [--report <audit.md>]')
    process.exitCode = 1
    return
  }

  const resolvedInput = path.resolve(input)
  const audit = auditBangumiPayloadEntitySeed(await readJsonFile(resolvedInput))
  const resolvedJsonOutput = path.resolve(jsonOutput)
  const resolvedReportOutput = path.resolve(reportOutput)

  await mkdir(path.dirname(resolvedJsonOutput), { recursive: true })
  await writeJsonFile(resolvedJsonOutput, audit)
  console.log(`Wrote Bangumi Payload entity seed audit JSON -> ${resolvedJsonOutput}`)

  await mkdir(path.dirname(resolvedReportOutput), { recursive: true })
  await writeFile(resolvedReportOutput, `${report(audit, resolvedInput)}\n`, 'utf8')
  console.log(`Wrote Bangumi Payload entity seed audit report -> ${resolvedReportOutput}`)

  if (!audit.ok) {
    console.error('Bangumi Payload entity seed audit failed.')
    process.exitCode = 1
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  await main()
}
