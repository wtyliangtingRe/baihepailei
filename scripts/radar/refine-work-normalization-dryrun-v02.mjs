#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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

function text(value) {
  return String(value ?? '').trim()
}

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function readJsonl(file) {
  return readText(file)
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSONL at ${file}:${index + 1}: ${error.message}`)
      }
    })
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function writeJsonl(file, rows) {
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  fs.writeFileSync(file, body ? `${body}\n` : '', 'utf8')
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory) {
  const manifest = readJson(path.join(directory, 'manifest.json'))
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    const stat = fs.statSync(file)
    if (stat.size !== Number(entry.bytes)) {
      throw new Error(`Manifest byte mismatch: ${entry.file}`)
    }
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) {
      throw new Error(`Manifest SHA-256 mismatch: ${entry.file}`)
    }
  }
  return manifest
}

function countBy(rows, key) {
  const counts = {}
  for (const row of rows) {
    const value = text(row[key]) || '<empty>'
    counts[value] = (counts[value] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))
}

function isNonPublic(row) {
  return text(row?.provenance?.catalogStatus) === 'archived'
    || text(row?.provenance?.payloadStatus) === 'draft'
}

function refineRankPlan(row) {
  const refined = structuredClone(row)
  refined.identityGateRequired = false
  refined.canonicalIdentityStatus = 'not_applicable'

  if (isNonPublic(refined)) {
    const privateGrade = text(refined?.provenance?.privateAI?.grade)
    if (text(refined.preservationClass) === 'canonical_human') {
      refined.preservationClass = 'archived_nonpublic_canonical_human'
    } else if (privateGrade) {
      refined.preservationClass = 'archived_nonpublic_private_ai'
    } else {
      refined.preservationClass = 'archived_nonpublic_legacy_rank'
    }
    refined.effectiveGradeWithoutPublicAI = 'unknown'
    refined.candidatePublicAIGrade = null
    refined.requiresPublicationReview = false
    refined.automaticPublicationEligible = false
    refined.canonicalIdentityStatus = 'blocked_nonpublic'
    refined.reason = 'Draft or archived Works are preserved for audit but excluded from the public AI review queue.'
    return refined
  }

  if (refined.requiresPublicationReview) {
    refined.identityGateRequired = true
    refined.canonicalIdentityStatus = 'unresolved'
    refined.automaticPublicationEligible = false
    refined.reason = `${text(refined.reason)} Canonical Work identity must be resolved before publication review.`.trim()
  }

  return refined
}

function normalizeTitle(value) {
  return text(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s_]+/gu, '')
}

function asciiTitleTokens(value) {
  return new Set(
    text(value)
      .normalize('NFKC')
      .toLowerCase()
      .match(/[a-z0-9]{6,}/gu) || [],
  )
}

function detectIdentityAlerts(humanPlans, rankPlans) {
  const byID = new Map()
  for (const row of [...humanPlans, ...rankPlans]) {
    const id = Number(row.id)
    if (!Number.isInteger(id)) continue
    if (!byID.has(id)) {
      byID.set(id, {
        id,
        title: row.title,
        slug: row.slug,
        sources: [],
      })
    }
    const entry = byID.get(id)
    entry.sources.push(row.action ? 'human-plan' : 'rank-plan')
  }

  const rows = [...byID.values()]
  const alertMap = new Map()

  function addAlert(kind, key, members, confidence, reason) {
    const ids = [...new Set(members.map((row) => row.id))].sort((a, b) => a - b)
    if (ids.length < 2) return
    const mapKey = ids.join(':')
    const existing = alertMap.get(mapKey)
    const signal = { kind, key, confidence, reason }
    if (existing) {
      existing.signals.push(signal)
      return
    }
    alertMap.set(mapKey, {
      alertId: `identity:${ids.join(':')}`,
      workIds: ids,
      members: ids.map((id) => byID.get(id)),
      canonicalWorkId: null,
      decision: 'manual_canonical_identity_required',
      blocksHumanWrite: true,
      blocksPublicAIReview: true,
      signals: [signal],
    })
  }

  const exactTitleGroups = new Map()
  for (const row of rows) {
    const key = normalizeTitle(row.title)
    if (!key) continue
    if (!exactTitleGroups.has(key)) exactTitleGroups.set(key, [])
    exactTitleGroups.get(key).push(row)
  }
  for (const [key, members] of exactTitleGroups) {
    addAlert(
      'exact_normalized_title',
      key,
      members,
      'high',
      'The same normalized title appears on multiple Work IDs.',
    )
  }

  const tokenGroups = new Map()
  for (const row of rows) {
    for (const token of asciiTitleTokens(row.title)) {
      if (!tokenGroups.has(token)) tokenGroups.set(token, [])
      tokenGroups.get(token).push(row)
    }
  }
  for (const [token, members] of tokenGroups) {
    addAlert(
      'shared_distinctive_ascii_title_token',
      token,
      members,
      'review',
      'A distinctive title token appears on multiple Work IDs, including translated titles.',
    )
  }

  return [...alertMap.values()].sort((a, b) => a.workIds[0] - b.workIds[0])
}

function addIdentityBlocks(humanPlans, rankPlans, alerts) {
  const blocked = new Set(alerts.flatMap((alert) => alert.workIds))
  const refinedHuman = humanPlans.map((row) => ({
    ...row,
    canonicalIdentityGateRequired: Boolean(row.automaticWriteEligible),
    canonicalIdentityStatus: row.automaticWriteEligible
      ? (blocked.has(Number(row.id)) ? 'duplicate_alert' : 'unresolved')
      : 'not_applicable',
    automaticWriteEligible: false,
    previousAutomaticWriteEligibility: Boolean(row.automaticWriteEligible),
  }))
  const refinedRank = rankPlans.map((row) => ({
    ...row,
    canonicalIdentityStatus: row.identityGateRequired
      ? (blocked.has(Number(row.id)) ? 'duplicate_alert' : 'unresolved')
      : row.canonicalIdentityStatus,
  }))
  return { refinedHuman, refinedRank }
}

function fixTimestampComparisons(sql) {
  return sql
    .replace(
      'w.human_assessment_assessed_at::text IS NOT DISTINCT FROM p.expected_canonical_assessed_at',
      'w.human_assessment_assessed_at IS NOT DISTINCT FROM p.expected_canonical_assessed_at::timestamptz',
    )
    .replace(
      'w.human_reviewed_at::text IS NOT DISTINCT FROM p.expected_legacy_reviewed_at',
      'w.human_reviewed_at IS NOT DISTINCT FROM p.expected_legacy_reviewed_at::timestamptz',
    )
}

function assertReadOnlySql(sql, name) {
  if (/\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE|CREATE\s+TABLE)\b/iu.test(sql)) {
    throw new Error(`${name} contains a write or DDL keyword.`)
  }
  if (!/BEGIN TRANSACTION READ ONLY;/u.test(sql) || !/ROLLBACK;/u.test(sql)) {
    throw new Error(`${name} is missing the read-only transaction envelope.`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputDir = path.resolve(text(args['dryrun-dir']))
  if (!text(args['dryrun-dir'])) throw new Error('Required: --dryrun-dir <v01 dry-run directory>')
  const outputDir = path.resolve(
    text(args['output-dir'])
      || path.join('exports', `work-normalization-dryrun-v02-${new Date().toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}`),
  )
  fs.mkdirSync(outputDir, { recursive: true })

  verifyManifest(inputDir)
  const sourceSummary = readJson(path.join(inputDir, 'normalization-summary.json'))
  if (sourceSummary?.safety?.databaseWrite !== false
    || sourceSummary?.safety?.executableUpdateSqlGenerated !== false) {
    throw new Error('Input dry-run does not prove read-only safety.')
  }

  const humanPlans = readJsonl(path.join(inputDir, 'human-normalization-plan.jsonl'))
  const rankPlansV01 = readJsonl(path.join(inputDir, 'rank-preservation-plan.jsonl'))
  const schemaPlan = readJson(path.join(inputDir, 'schema-retirement-plan.json'))
  const rankPlansInitial = rankPlansV01.map(refineRankPlan)
  const identityAlerts = detectIdentityAlerts(humanPlans, rankPlansInitial)
  const { refinedHuman, refinedRank } = addIdentityBlocks(humanPlans, rankPlansInitial, identityAlerts)

  const publicAI = refinedRank.filter((row) => row.requiresPublicationReview && !isNonPublic(row))
  const nonPublic = refinedRank.filter(isNonPublic)
  const humanIdentityGate = refinedHuman.filter((row) => row.canonicalIdentityGateRequired)

  const correctedSql = fixTimestampComparisons(
    readText(path.join(inputDir, 'phase1-human-normalization-dryrun.sql')),
  )
  const schemaSql = readText(path.join(inputDir, 'schema-retirement-dryrun.sql'))
  assertReadOnlySql(correctedSql, 'phase1-human-normalization-dryrun-v02.sql')
  assertReadOnlySql(schemaSql, 'schema-retirement-dryrun-v02.sql')

  const summary = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceDirectory: inputDir,
    sourceSummarySha256: sha256File(path.join(inputDir, 'normalization-summary.json')),
    humanPlanRows: refinedHuman.length,
    humanIdentityGateRows: humanIdentityGate.length,
    rankPlanRows: refinedRank.length,
    publicAIReviewCandidateRows: publicAI.length,
    nonPublicPreservedRows: nonPublic.length,
    identityAlertGroups: identityAlerts.length,
    rankPreservationClasses: countBy(refinedRank, 'preservationClass'),
    semanticCorrections: {
      nonPublicPrecedence: true,
      canonicalIdentityGate: true,
      typedTimestampComparison: true,
      executableUpdateSqlGenerated: false,
    },
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableUpdateSqlGenerated: false,
    },
  }

  writeJsonl(path.join(outputDir, 'human-normalization-plan-v02.jsonl'), refinedHuman)
  writeJsonl(path.join(outputDir, 'rank-preservation-plan-v02.jsonl'), refinedRank)
  writeJsonl(path.join(outputDir, 'public-ai-review-candidates-v02.jsonl'), publicAI)
  writeJsonl(path.join(outputDir, 'nonpublic-assessment-preservation.jsonl'), nonPublic)
  writeJsonl(path.join(outputDir, 'canonical-identity-review-alerts.jsonl'), identityAlerts)
  writeJson(path.join(outputDir, 'schema-retirement-plan.json'), schemaPlan)
  writeText(path.join(outputDir, 'phase1-human-normalization-dryrun-v02.sql'), correctedSql)
  writeText(path.join(outputDir, 'schema-retirement-dryrun-v02.sql'), schemaSql)
  writeJson(path.join(outputDir, 'normalization-summary-v02.json'), summary)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Work normalization dry-run semantic refinement complete')
  console.log(`OutputDirectory: ${outputDir}`)
  console.log(`PublicAIReviewCandidateRows: ${publicAI.length}`)
  console.log(`NonPublicPreservedRows: ${nonPublic.length}`)
  console.log(`HumanIdentityGateRows: ${humanIdentityGate.length}`)
  console.log(`IdentityAlertGroups: ${identityAlerts.length}`)
  console.log('')
  console.log('DatabaseWrite: False')
  console.log('PayloadWrite: False')
  console.log('MigrationGeneration: False')
  console.log('SchemaPush: False')
  console.log('ExecutableUpdateSqlGenerated: False')
}

main()
