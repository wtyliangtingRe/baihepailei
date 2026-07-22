#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

import {
  CALIBRATED_HANDOFF_VERSION,
  loadAndValidateAiQaPackage,
  readJson,
  stableRowSha256,
  writeJson,
  writeJsonl,
} from './lib/ai-qa-package-v01.mjs'
import {
  assertUnderDataLocal,
  readJsonl,
  sha256File,
  val,
} from './lib/assessment-handoff-v01.mjs'

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

function safeSlug(value) {
  const slug = val(value).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  if (!slug) throw new Error('Value could not be converted to a safe slug')
  return slug
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.publish || args.patch || args.gate || args['approval-token']) {
    throw new Error('AI QA package apply is local-only. Publish/patch/gate flags are rejected.')
  }
  const packageDir = val(args['package-dir'])
  const handoffDir = val(args['handoff-dir'])
  if (!packageDir) throw new Error('--package-dir is required')
  if (!handoffDir) throw new Error('--handoff-dir is required')

  const loaded = loadAndValidateAiQaPackage(packageDir)
  const resolvedHandoffDir = assertUnderDataLocal(handoffDir)
  const handoffManifestFile = assertUnderDataLocal(path.join(resolvedHandoffDir, 'handoff-manifest.json'))
  if (!fs.existsSync(handoffManifestFile)) throw new Error(`Calibrated handoff manifest not found: ${handoffManifestFile}`)
  const handoff = readJson(handoffManifestFile)
  if (val(handoff?.version) !== CALIBRATED_HANDOFF_VERSION) throw new Error('Calibrated handoff version mismatch')
  if (val(handoff?.batchId) !== val(loaded.manifest?.batchId)) throw new Error('AI QA package batch does not match calibrated handoff')

  const responseByName = new Map()
  for (const chunk of Array.isArray(handoff?.chunks) ? handoff.chunks : []) {
    const responseFile = assertUnderDataLocal(val(chunk?.responseFile))
    if (!responseFile.startsWith(`${resolvedHandoffDir}${path.sep}`)) {
      throw new Error(`Calibrated response path escaped handoff directory: ${responseFile}`)
    }
    responseByName.set(path.basename(responseFile), responseFile)
  }

  const workingRoot = assertUnderDataLocal(
    val(args['working-dir']) || path.join('data_local', 'working', 'ai-radar', 'prebatch2', safeSlug(loaded.manifest.packageId)),
  )
  const backupRoot = assertUnderDataLocal(path.join(workingRoot, 'backup', 'responses'))
  fs.mkdirSync(backupRoot, { recursive: true })

  const grouped = new Map()
  for (const correction of loaded.corrections) {
    const responseFileName = path.basename(val(correction?.responseFileName))
    const responseFile = responseByName.get(responseFileName)
    if (!responseFile) throw new Error(`Correction targets an unknown response file: ${responseFileName}`)
    if (!grouped.has(responseFile)) grouped.set(responseFile, [])
    grouped.get(responseFile).push(correction)
  }

  const applied = []
  const alreadyApplied = []
  const backups = []
  for (const [responseFile, corrections] of grouped) {
    if (!fs.existsSync(responseFile)) throw new Error(`Response file not found: ${responseFile}`)
    const backupFile = assertUnderDataLocal(path.join(backupRoot, path.basename(responseFile)))
    if (!fs.existsSync(backupFile)) fs.copyFileSync(responseFile, backupFile)
    backups.push({ responseFile, backupFile, sha256: sha256File(backupFile) })

    const rows = readJsonl(responseFile)
    const indexByWorkId = new Map(rows.map((row, index) => [val(row?.workId), index]))
    for (const correction of corrections) {
      const workId = val(correction?.workId)
      const index = indexByWorkId.get(workId)
      if (index == null) throw new Error(`Correction work not found in response file: ${workId}`)
      const current = rows[index]
      if (val(current?.siteId) !== val(correction?.siteId)) throw new Error(`Correction siteId mismatch for ${workId}`)
      const currentSha = stableRowSha256(current)
      const originalSha = val(correction?.expectedOriginalResponseRowSha256)
      const correctedSha = val(correction?.correctedResponseRowSha256)
      if (currentSha === correctedSha) {
        alreadyApplied.push(workId)
        continue
      }
      if (currentSha !== originalSha) throw new Error(`Correction original row SHA-256 mismatch for ${workId}`)
      rows[index] = correction.correctedResponse
      if (stableRowSha256(rows[index]) !== correctedSha) throw new Error(`Correction output SHA-256 mismatch for ${workId}`)
      applied.push(workId)
    }
    writeJsonl(responseFile, rows)
  }

  const summaryFile = assertUnderDataLocal(path.join(workingRoot, 'apply-summary.json'))
  const summary = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-ai-qa-package-apply-v0.1',
    packageId: val(loaded.manifest?.packageId),
    batchId: val(loaded.manifest?.batchId),
    packageDirectory: loaded.packageRoot,
    handoffDirectory: resolvedHandoffDir,
    correctionsExpected: loaded.corrections.length,
    correctionsApplied: applied.length,
    correctionsAlreadyApplied: alreadyApplied.length,
    appliedWorkIds: applied,
    alreadyAppliedWorkIds: alreadyApplied,
    backups,
    outputs: { summary: summaryFile },
    trackIsolation: {
      aiTrackRows: Number(loaded.manifest.expectedRows),
      humanTrackMutations: 0,
      humanTrackAction: 'none_separate_track',
    },
    safety: {
      payloadRead: false,
      payloadWrite: false,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      publishesRatings: false,
      onlyWritesUnderDataLocal: true,
    },
  }
  writeJson(summaryFile, summary)
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

try { main() } catch (error) { console.error(error?.stack || error); process.exitCode = 1 }
