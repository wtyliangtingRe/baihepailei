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

function readText(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
}

function readJson(file) {
  return JSON.parse(readText(file))
}

function readJsonl(file) {
  return readText(file).split(/\r?\n/u).filter((line) => line.trim()).map(JSON.parse)
}

function writeText(file, value) {
  fs.writeFileSync(file, `${String(value).replace(/\s+$/u, '')}\n`, 'utf8')
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function writeJsonl(file, rows) {
  writeText(file, rows.map((row) => JSON.stringify(row)).join('\n'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function rowParentId(entry) {
  return Number(entry?.row?.[entry.columnName])
}

function assessmentField(key) {
  return key.startsWith('human_assessment_')
    || key.startsWith('human_review_')
    || key.startsWith('human_reviewed_')
    || key.startsWith('radar_assessment_')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const identityDir = path.resolve(String(args['identity-audit-dir'] || ''))
  const outputDir = path.resolve(String(args['output-dir'] || ''))
  if (!args['identity-audit-dir'] || !args['output-dir']) {
    throw new Error('Required: --identity-audit-dir and --output-dir')
  }

  const workRows = readJsonl(path.join(identityDir, 'work-rows.jsonl'))
  const relatedRows = readJsonl(path.join(identityDir, 'related-rows.jsonl'))
  const versionRelatedRows = readJsonl(path.join(identityDir, 'version-related-rows.jsonl'))
  const worksById = new Map(workRows.map((row) => [Number(row.id), row]))

  const cleanupPath = path.join(outputDir, 'test-assessment-cleanup-plan.jsonl')
  const cleanup = readJsonl(cleanupPath).map((plan) => {
    const source = worksById.get(Number(plan.workId))
    if (!source) throw new Error(`Missing Work for cleanup refinement: ${plan.workId}`)
    const after = { ...plan.after }
    for (const key of Object.keys(source)) {
      if (assessmentField(key)) after[key] = null
    }
    after.human_assessment_status = 'pending'
    after.review_status = 'pending'
    after.rank = 'unknown'
    after.rating_notice = 'insufficient_information'
    after.evidence_strength = 'unassessed'
    return {
      ...plan,
      before: Object.fromEntries(Object.keys(after).map((key) => [key, source[key] ?? null])),
      after,
      completeLegacyHumanReset: true,
    }
  })
  writeJsonl(cleanupPath, cleanup)

  const versionIdsByWork = new Map()
  for (const entry of relatedRows) {
    if (entry.tableName !== '_works_v') continue
    const workId = rowParentId(entry)
    const versionId = Number(entry?.row?.id)
    if (!Number.isInteger(workId) || !Number.isInteger(versionId)) continue
    if (!versionIdsByWork.has(workId)) versionIdsByWork.set(workId, new Set())
    versionIdsByWork.get(workId).add(versionId)
  }

  const versionPlanPath = path.join(outputDir, 'version-preservation-plan.jsonl')
  const versionPlans = readJsonl(versionPlanPath).map((plan) => {
    const canonicalVersionIds = versionIdsByWork.get(Number(plan.canonicalWorkId)) || new Set()
    const mergeOutVersionIds = versionIdsByWork.get(Number(plan.mergeOutWorkId)) || new Set()
    let canonicalChildren = 0
    let mergeOutChildren = 0
    for (const entry of versionRelatedRows) {
      const versionId = rowParentId(entry)
      if (canonicalVersionIds.has(versionId)) canonicalChildren += 1
      if (mergeOutVersionIds.has(versionId)) mergeOutChildren += 1
    }
    return {
      ...plan,
      observedCanonicalVersionRows: canonicalVersionIds.size,
      observedMergeOutVersionRows: mergeOutVersionIds.size,
      observedCanonicalVersionChildRows: canonicalChildren,
      observedMergeOutVersionChildRows: mergeOutChildren,
      observedVersionEvidenceRows: canonicalChildren + mergeOutChildren,
      versionOwnershipMappedThroughWorksV: true,
    }
  })
  writeJsonl(versionPlanPath, versionPlans)

  const summaryPath = path.join(outputDir, 'merge-dryrun-summary.json')
  const summary = readJson(summaryPath)
  summary.schemaVersion = 2
  summary.semanticRefinementVersion = 2
  summary.completeLegacyHumanReset = true
  summary.versionOwnershipMappedThroughWorksV = true
  summary.safety = {
    ...summary.safety,
    databaseWrite: false,
    payloadWrite: false,
    executableUpdateSqlGenerated: false,
    canonicalDecisionApplied: false,
    mergePerformed: false,
    hardDeletePlanned: false,
    versionRewritePlanned: false,
  }
  writeJson(summaryPath, summary)

  const markdownPath = path.join(outputDir, 'merge-dryrun-summary.md')
  const markdown = `${readText(markdownPath).trim()}\n\n## v02 semantic refinement\n\n- Complete legacy human reset: true\n- Version ownership mapped through _works_v: true\n- Version rows reparented: false\n- Version rows deleted: false\n`
  writeText(markdownPath, markdown)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work merge dry-run v02 refinement complete')
  console.log(`AssessmentCleanupRows: ${cleanup.length}`)
  console.log(`VersionPreservationRows: ${versionPlans.length}`)
  console.log('CompleteLegacyHumanReset: True')
  console.log('VersionOwnershipMappedThroughWorksV: True')
  console.log('DatabaseWrite: False')
  console.log('MergePerformed: False')
}

main()
