import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  sha256File,
  val,
} from './assessment-handoff-v01.mjs'

export const AI_QA_PACKAGE_VERSION = 'ai-radar-ai-qa-package-v0.1'
export const AI_QA_DECISION_VERSION = 'ai-radar-ai-qa-decision-v0.1'
export const AI_QA_CORRECTION_VERSION = 'ai-radar-ai-qa-correction-v0.1'
export const AI_QA_FINAL_VERSION = 'ai-radar-ai-qa-final-v0.1'
export const CALIBRATED_HANDOFF_VERSION = 'ai-radar-calibrated-assessment-handoff-v0.1'
export const ALLOWED_DECISIONS = new Set(['ai_qa_passed', 'ai_qa_revise', 'ai_qa_deferred'])

export function list(value) {
  return Array.isArray(value) ? value : []
}

export function unique(values) {
  return [...new Set(list(values).map(val).filter(Boolean))]
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, jsonlText(rows), 'utf8')
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  )
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

export function stableRowSha256(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function assertRelativePackageFile(packageRoot, relativeFile) {
  const rel = val(relativeFile).replace(/\\/gu, '/')
  if (!rel || path.isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error(`Unsafe AI QA package file path: ${relativeFile}`)
  }
  const resolvedRoot = path.resolve(packageRoot)
  const resolved = path.resolve(packageRoot, rel)
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`AI QA package file escaped package root: ${relativeFile}`)
  }
  return resolved
}

export function loadAndValidateAiQaPackage(packageDir) {
  const packageRoot = assertUnderDataLocal(packageDir)
  const manifestFile = assertRelativePackageFile(packageRoot, 'package-manifest.json')
  if (!fs.existsSync(manifestFile)) throw new Error(`AI QA package manifest not found: ${manifestFile}`)
  const manifest = readJson(manifestFile)
  const blockers = []

  if (val(manifest?.version) !== AI_QA_PACKAGE_VERSION) blockers.push('ai_qa_package_version_mismatch')
  if (!val(manifest?.packageId)) blockers.push('ai_qa_package_id_missing')
  if (!val(manifest?.batchId)) blockers.push('ai_qa_package_batch_id_missing')
  if (!Number.isInteger(Number(manifest?.expectedRows)) || Number(manifest.expectedRows) < 1) blockers.push('ai_qa_package_expected_rows_invalid')
  if (Number(manifest?.safety?.humanTrackMutations) !== 0) blockers.push('ai_qa_package_human_track_mutation_nonzero')
  if (manifest?.safety?.payloadWrite !== false) blockers.push('ai_qa_package_payload_write_not_false')
  if (manifest?.safety?.directPostgresqlWrite !== false) blockers.push('ai_qa_package_postgresql_write_not_false')
  if (manifest?.safety?.publishesRatings !== false) blockers.push('ai_qa_package_publish_not_false')

  const files = list(manifest?.files)
  if (!files.length) blockers.push('ai_qa_package_files_missing')
  const checkedFiles = []
  for (const item of files) {
    let file
    try {
      file = assertRelativePackageFile(packageRoot, item?.file)
    } catch {
      blockers.push(`ai_qa_package_file_path_invalid:${val(item?.file) || 'missing'}`)
      continue
    }
    if (!fs.existsSync(file)) blockers.push(`ai_qa_package_file_missing:${val(item?.file)}`)
    else {
      const actualSha256 = sha256File(file)
      if (actualSha256 !== val(item?.sha256)) blockers.push(`ai_qa_package_file_sha256_mismatch:${val(item?.file)}`)
      const actualBytes = fs.statSync(file).size
      if (Number.isFinite(Number(item?.bytes)) && actualBytes !== Number(item.bytes)) blockers.push(`ai_qa_package_file_bytes_mismatch:${val(item?.file)}`)
      checkedFiles.push({ relativeFile: val(item?.file), file, actualSha256, actualBytes })
    }
  }

  const decisionsFile = assertRelativePackageFile(packageRoot, 'decisions/ai-radar-ai-qa-decisions-v0.1.jsonl')
  const correctionsFile = assertRelativePackageFile(packageRoot, 'corrections/ai-radar-ai-qa-corrections-v0.1.jsonl')
  const targetedResearchFile = assertRelativePackageFile(packageRoot, 'research/ai-radar-ai-qa-targeted-research-v0.1.jsonl')
  if (!fs.existsSync(decisionsFile)) blockers.push('ai_qa_decisions_file_missing')
  if (!fs.existsSync(correctionsFile)) blockers.push('ai_qa_corrections_file_missing')
  if (!fs.existsSync(targetedResearchFile)) blockers.push('ai_qa_targeted_research_file_missing')

  const decisions = fs.existsSync(decisionsFile) ? readJsonl(decisionsFile) : []
  const corrections = fs.existsSync(correctionsFile) ? readJsonl(correctionsFile) : []
  const targetedResearch = fs.existsSync(targetedResearchFile) ? readJsonl(targetedResearchFile) : []
  const seen = new Set()
  const counts = { ai_qa_passed: 0, ai_qa_revise: 0, ai_qa_deferred: 0 }
  for (const decision of decisions) {
    const workId = val(decision?.workId)
    if (val(decision?.version) !== AI_QA_DECISION_VERSION) blockers.push(`ai_qa_decision_version_mismatch:${workId || 'missing'}`)
    if (val(decision?.batchId) !== val(manifest?.batchId)) blockers.push(`ai_qa_decision_batch_mismatch:${workId || 'missing'}`)
    if (!workId) blockers.push('ai_qa_decision_work_id_missing')
    if (seen.has(workId)) blockers.push(`ai_qa_decision_duplicate_work_id:${workId}`)
    seen.add(workId)
    const action = val(decision?.decision)
    if (!ALLOWED_DECISIONS.has(action)) blockers.push(`ai_qa_decision_invalid:${workId}:${action || 'missing'}`)
    else counts[action] += 1
    if (val(decision?.humanTrackAction) !== 'none_separate_track' || decision?.humanTrackMutation !== false) {
      blockers.push(`ai_qa_decision_human_track_mutation:${workId || 'missing'}`)
    }
  }
  if (decisions.length !== Number(manifest?.expectedRows)) blockers.push('ai_qa_decision_row_count_mismatch')
  for (const [decision, count] of Object.entries(counts)) {
    if (Number(manifest?.decisionCounts?.[decision]) !== count) blockers.push(`ai_qa_decision_count_mismatch:${decision}`)
  }
  if (corrections.length !== Number(manifest?.correctionsIncluded)) blockers.push('ai_qa_correction_count_mismatch')
  if (targetedResearch.length !== Number(manifest?.targetedResearchRows)) blockers.push('ai_qa_targeted_research_count_mismatch')

  const decisionByWorkId = new Map(decisions.map((item) => [val(item?.workId), item]))
  for (const correction of corrections) {
    const workId = val(correction?.workId)
    if (val(correction?.version) !== AI_QA_CORRECTION_VERSION) blockers.push(`ai_qa_correction_version_mismatch:${workId || 'missing'}`)
    if (val(correction?.batchId) !== val(manifest?.batchId)) blockers.push(`ai_qa_correction_batch_mismatch:${workId || 'missing'}`)
    if (val(correction?.humanTrackAction) !== 'none_separate_track') blockers.push(`ai_qa_correction_human_track_mutation:${workId || 'missing'}`)
    if (val(decisionByWorkId.get(workId)?.decision) !== 'ai_qa_revise') blockers.push(`ai_qa_correction_without_revise_decision:${workId || 'missing'}`)
    if (!val(correction?.expectedOriginalResponseRowSha256)) blockers.push(`ai_qa_correction_original_sha_missing:${workId || 'missing'}`)
    if (!val(correction?.correctedResponseRowSha256)) blockers.push(`ai_qa_correction_corrected_sha_missing:${workId || 'missing'}`)
    if (stableRowSha256(correction?.correctedResponse) !== val(correction?.correctedResponseRowSha256)) blockers.push(`ai_qa_correction_corrected_sha_mismatch:${workId || 'missing'}`)
    if (val(correction?.correctedResponse?.workId) !== workId) blockers.push(`ai_qa_correction_work_id_mismatch:${workId || 'missing'}`)
    if (val(correction?.correctedResponse?.siteId) !== val(correction?.siteId)) blockers.push(`ai_qa_correction_site_id_mismatch:${workId || 'missing'}`)
  }

  if (blockers.length) throw new Error(`AI QA package validation failed: ${[...new Set(blockers)].join(', ')}`)

  return {
    packageRoot,
    manifestFile,
    manifest,
    checkedFiles,
    decisionsFile,
    correctionsFile,
    targetedResearchFile,
    decisions,
    corrections,
    targetedResearch,
    decisionByWorkId,
    counts,
  }
}
