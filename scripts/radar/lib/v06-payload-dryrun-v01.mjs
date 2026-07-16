import fs from 'node:fs'
import path from 'node:path'

import {
  buildWorkIndexes,
  dryRunPlanRow,
  val,
} from './payload-plan-v01.mjs'
import {
  assertUnderDataLocal,
  jsonlText,
  readJsonl,
  sha256File,
} from './v06-package-import-v01.mjs'

export const V06_DRYRUN_VERSION = 'ai-radar-v06-payload-batch-dryrun-v0.1'
export const V06_PLAN_VERSION = 'ai-radar-v06-payload-batch-plan-v0.1'

export function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(val).filter(Boolean))]
}

export function countBy(values, getter = (value) => value) {
  const counts = {}
  for (const value of Array.isArray(values) ? values : []) {
    const key = val(getter(value)) || 'missing'
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  )
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

export function validateBatchManifest(manifest, {
  expectedBatches = 44,
  expectedRows = 10805,
  selectedBatchId = '',
} = {}) {
  const blockers = []
  if (val(manifest?.version) !== V06_PLAN_VERSION) blockers.push('unexpected_batch_manifest_version')
  if (!Array.isArray(manifest?.batches)) blockers.push('batch_manifest_batches_missing')

  const batches = Array.isArray(manifest?.batches) ? manifest.batches : []
  const selected = val(selectedBatchId)
    ? batches.filter((batch) => val(batch?.batchId) === val(selectedBatchId))
    : batches

  if (selectedBatchId && selected.length !== 1) blockers.push('selected_batch_not_found_or_ambiguous')
  if (!selectedBatchId && expectedBatches > 0 && batches.length !== expectedBatches) {
    blockers.push(`batch_count_expected_${expectedBatches}_received_${batches.length}`)
  }

  const seen = new Set()
  let rows = 0
  for (const batch of selected) {
    const batchId = val(batch?.batchId)
    if (!batchId) blockers.push('batch_id_missing')
    if (seen.has(batchId)) blockers.push(`duplicate_batch_id:${batchId}`)
    seen.add(batchId)

    const planFile = val(batch?.planFile)
    const expectedPlanSha = val(batch?.planSha256)
    const expectedBatchRows = Number(batch?.rows)
    if (!planFile) blockers.push(`plan_file_missing:${batchId}`)
    else {
      try { assertUnderDataLocal(planFile) } catch { blockers.push(`plan_file_outside_data_local:${batchId}`) }
      if (!fs.existsSync(planFile)) blockers.push(`plan_file_not_found:${batchId}`)
      else {
        if (expectedPlanSha && sha256File(planFile) !== expectedPlanSha) blockers.push(`plan_sha256_mismatch:${batchId}`)
        const planRows = readJsonl(planFile)
        if (!Number.isInteger(expectedBatchRows) || expectedBatchRows < 1) blockers.push(`batch_row_count_invalid:${batchId}`)
        else if (planRows.length !== expectedBatchRows) blockers.push(`batch_row_count_mismatch:${batchId}`)
      }
    }
    if (!expectedPlanSha) blockers.push(`plan_sha256_missing:${batchId}`)
    if (Number.isInteger(expectedBatchRows) && expectedBatchRows > 0) rows += expectedBatchRows
  }

  if (!selectedBatchId && expectedRows > 0 && rows !== expectedRows) {
    blockers.push(`manifest_rows_expected_${expectedRows}_received_${rows}`)
  }

  return {
    blockers: unique(blockers),
    batches: selected,
    rows,
  }
}

export function dryRunBatchPlans(plans, indexes) {
  return plans.map((plan) => {
    if (val(plan?.planStatus) !== 'ready_for_payload_dry_run') {
      return {
        workId: val(plan?.workId),
        siteId: val(plan?.siteId),
        title: val(plan?.title),
        assessmentBatch: val(plan?.assessmentBatch),
        target: plan?.target,
        status: val(plan?.planStatus) === 'already_current' ? 'already_current' : 'blocked',
        remainingChangedFields: [],
        blockers: val(plan?.planStatus) === 'blocked'
          ? unique(plan?.blockers)
          : [`plan_status:${val(plan?.planStatus) || 'missing'}`],
        warnings: unique(plan?.warnings),
        safety: {
          payloadRead: true,
          payloadWrite: false,
          payloadPatchRequests: 0,
          directPostgresqlWrite: false,
        },
      }
    }
    return {
      assessmentBatch: val(plan?.assessmentBatch),
      ...dryRunPlanRow(plan, indexes),
    }
  })
}

export function summarizeDryRunResults(results) {
  const wouldUpdate = results.filter((row) => row.status === 'would_update')
  const blocked = results.filter((row) => row.status === 'blocked')
  const alreadyCurrent = results.filter((row) => row.status === 'already_current')
  return {
    rows: results.length,
    wouldUpdate: wouldUpdate.length,
    blocked: blocked.length,
    alreadyCurrent: alreadyCurrent.length,
    byStatus: countBy(results, (row) => row.status),
    byBlocker: countBy(blocked.flatMap((row) => row.blockers || [])),
    byRemainingChangedField: countBy(wouldUpdate.flatMap((row) => row.remainingChangedFields || [])),
    wouldUpdateRows: wouldUpdate,
    blockedRows: blocked,
    alreadyCurrentRows: alreadyCurrent,
  }
}

export function buildIndexes(works) {
  return buildWorkIndexes(works)
}
