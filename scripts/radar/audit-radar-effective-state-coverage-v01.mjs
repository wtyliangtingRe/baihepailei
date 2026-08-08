#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  auditEffectiveStateCoverage,
  stableStringify,
} from '../../src/lib/radar/effectiveStateCoverageLedger.mjs'

function clean(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readSnapshot(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Snapshot must be one JSON object with collection arrays.')
  }
  return parsed
}

function stablePretty(value) {
  return `${JSON.stringify(JSON.parse(stableStringify(value)), null, 2)}\n`
}

function violationRows(audit) {
  const rows = []
  for (const item of audit.globalViolations) rows.push({ scope: 'global', ...item })
  for (const row of audit.ledger) {
    for (const item of row.violations) {
      rows.push({
        scope: 'work',
        canonicalWorkId: row.canonicalWorkId,
        canonicalSiteId: row.canonicalSiteId,
        effectiveBucket: row.effectiveBucket,
        ...item,
      })
    }
  }
  return rows.sort((a, b) =>
    clean(a.canonicalWorkId).localeCompare(clean(b.canonicalWorkId))
      || clean(a.layer).localeCompare(clean(b.layer))
      || clean(a.code).localeCompare(clean(b.code))
      || clean(a.detail).localeCompare(clean(b.detail)),
  )
}

function summaryMarkdown(audit) {
  const bucketLines = audit.authorityOrder.map((bucket) => `- ${bucket}: ${audit.bucketCounts[bucket] ?? 0}`)
  return [
    '# Radar Effective-State Coverage Ledger v01',
    '',
    `- decision: **${audit.decision}**`,
    `- input digest SHA-256: \`${audit.inputDigestSha256}\``,
    `- canonical Works universe: ${audit.conservation.canonicalWorksUniverse}`,
    `- ledger rows / bucket total: ${audit.conservation.ledgerRows} / ${audit.conservation.bucketTotal}`,
    `- unique canonical Work ids: ${audit.conservation.uniqueCanonicalWorkIds}`,
    `- strict conservation: **${audit.conservation.strictSatisfied ? 'PASS' : 'FAIL'}**`,
    `- invalid effective states: ${audit.invalidEffectiveCount}`,
    `- errors / warnings: ${audit.violationCounts.errors} / ${audit.violationCounts.warnings}`,
    '',
    '## Effective buckets',
    '',
    ...bucketLines,
    '',
    'Authority is presence-first and validation-second. A malformed higher-authority current state keeps its bucket and sets `effectiveValid=false`; lower Research/Legacy data is never used to repair it.',
    '',
    'Research history is preserved as multiple observations. The ledger reports `historicalObservationCount` plus one deterministic `effectiveResearchObservation`; historical rows are not deduplicated away.',
    '',
    'Conclusion semantics are delegated to `src/lib/radar/conclusionNormalizer.mjs`. The ledger only adds persistence/integrity invariants such as ghost grades, exact identity bindings, pair cardinality, and policy-version diagnostics.',
    '',
    '## Safety',
    '',
    '- database migration authorized: **false**',
    '- Payload write authorized: **false**',
    '- PostgreSQL write authorized: **false**',
    '- production authorization: **false**',
    '- historical release rewrite authorized: **false**',
    '- existing Public Ratings rerate authorized: **false**',
    '',
  ].join('\n')
}

export function writeAuditOutputs(audit, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true })
  const auditForFile = { ...audit }
  delete auditForFile.ledger

  const files = new Map()
  files.set('audit.json', stablePretty(auditForFile))
  files.set('ledger.jsonl', audit.ledger.map((row) => `${stableStringify(row)}\n`).join(''))
  files.set('violations.jsonl', violationRows(audit).map((row) => `${stableStringify(row)}\n`).join(''))
  files.set('SUMMARY.md', summaryMarkdown(audit))

  for (const [name, content] of files) {
    fs.writeFileSync(path.join(outputDir, name), content, 'utf8')
  }
  const sums = [...files]
    .map(([name, content]) => `${sha256Buffer(Buffer.from(content))}  ${name}\n`)
    .join('')
  fs.writeFileSync(path.join(outputDir, 'SHA256SUMS'), sums, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const snapshotFile = clean(args.snapshot)
  const outputDir = clean(args['output-dir'])
  if (!snapshotFile) throw new Error('Use --snapshot <read-only-export.json>')
  if (!outputDir) throw new Error('Use --output-dir <directory>')
  if (!fs.existsSync(snapshotFile)) throw new Error(`Snapshot not found: ${snapshotFile}`)

  const snapshot = readSnapshot(snapshotFile)
  const audit = auditEffectiveStateCoverage(snapshot, {
    expectedPolicyVersion: clean(args['expected-policy-version']) || 'radar-rating-policy-v0.5',
  })
  writeAuditOutputs(audit, outputDir)
  console.log(JSON.stringify({
    decision: audit.decision,
    canonicalWorks: audit.conservation.canonicalWorksUniverse,
    bucketCounts: audit.bucketCounts,
    invalidEffectiveCount: audit.invalidEffectiveCount,
    errors: audit.violationCounts.errors,
    warnings: audit.violationCounts.warnings,
    inputDigestSha256: audit.inputDigestSha256,
  }, null, 2))

  if (args.strict && audit.decision !== 'PASS') process.exitCode = 2
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
