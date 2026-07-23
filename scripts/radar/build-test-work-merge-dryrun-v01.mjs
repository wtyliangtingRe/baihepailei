#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = { decision: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[index + 1]
    const value = !next || next.startsWith('--') ? true : next
    if (value !== true) index += 1
    if (key === 'decision') args.decision.push(value)
    else args[key] = value
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
  writeText(file, rows.map((row) => JSON.stringify(row)).join('\n'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function verifyManifest(directory) {
  const manifest = readJson(path.join(directory, 'manifest.json'))
  for (const entry of manifest) {
    const file = path.join(directory, entry.file)
    const stat = fs.statSync(file)
    if (stat.size !== Number(entry.bytes)) throw new Error(`Manifest byte mismatch: ${entry.file}`)
    if (sha256File(file) !== text(entry.sha256).toLowerCase()) {
      throw new Error(`Manifest SHA-256 mismatch: ${entry.file}`)
    }
  }
  return manifest
}

function parseDecisions(values) {
  const decisions = []
  for (const value of values) {
    const match = text(value).match(/^(\d+):(\d+)$/u)
    if (!match) throw new Error(`Invalid decision, expected mergeOut:canonical: ${value}`)
    const mergeOutWorkId = Number(match[1])
    const canonicalWorkId = Number(match[2])
    if (mergeOutWorkId === canonicalWorkId) throw new Error(`Self merge decision: ${value}`)
    decisions.push({ mergeOutWorkId, canonicalWorkId })
  }
  return decisions
}

function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]))
}

function semanticChildSignature(entry) {
  const row = { ...(entry.row || {}) }
  const ignored = new Set([
    'id', '_order', 'order', 'created_at', 'updated_at', 'createdAt', 'updatedAt',
    entry.columnName, '_parent_id', 'parent_id', 'work_id', 'works_id', 'linked_work_id',
  ])
  for (const key of ignored) delete row[key]
  return JSON.stringify(stableObject(row))
}

function rowParentId(entry) {
  return Number(entry?.row?.[entry.columnName])
}

function sqlIdList(values) {
  return [...values].sort((a, b) => a - b).join(', ')
}

function commentSql(lines) {
  return lines.map((line) => line ? `-- ${line}` : '--').join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!text(args['identity-audit-dir'])) throw new Error('Required: --identity-audit-dir <directory>')
  if (!text(args['output-dir'])) throw new Error('Required: --output-dir <directory>')
  if (args['discard-test-assessments'] !== true) {
    throw new Error('Required explicit flag: --discard-test-assessments')
  }

  const inputDir = path.resolve(args['identity-audit-dir'])
  const outputDir = path.resolve(args['output-dir'])
  fs.mkdirSync(outputDir, { recursive: true })

  verifyManifest(inputDir)
  const validation = readJson(path.join(inputDir, 'validation.json'))
  if (validation.jsonValidated !== true
    || validation.sourceDryRunManifestValidated !== true
    || validation.databaseWrite !== false) {
    throw new Error('Identity audit does not prove validated read-only evidence.')
  }

  const comparison = readJson(path.join(inputDir, 'identity-comparison.json'))
  if (comparison?.safety?.canonicalDecisionApplied !== false
    || comparison?.safety?.mergePerformed !== false) {
    throw new Error('Identity audit already claims a decision or merge.')
  }

  const workRows = readJsonl(path.join(inputDir, 'work-rows.jsonl'))
  const relatedRows = readJsonl(path.join(inputDir, 'related-rows.jsonl'))
  const versionRows = readJsonl(path.join(inputDir, 'version-related-rows.jsonl'))
  const worksById = new Map(workRows.map((row) => [Number(row.id), row]))
  const decisions = parseDecisions(args.decision)

  if (decisions.length !== comparison.groups.length) {
    throw new Error(`Every identity group needs one decision: ${decisions.length} / ${comparison.groups.length}`)
  }

  const decisionByGroup = new Map()
  for (const decision of decisions) {
    const group = comparison.groups.find((candidate) => {
      const ids = new Set(candidate.workIds.map(Number))
      return ids.has(decision.mergeOutWorkId) && ids.has(decision.canonicalWorkId)
    })
    if (!group) throw new Error(`Decision does not match an identity group: ${JSON.stringify(decision)}`)
    if (decisionByGroup.has(group.alertId)) throw new Error(`Duplicate decision for ${group.alertId}`)
    decisionByGroup.set(group.alertId, decision)
  }

  const externalIdFields = [
    'external_ids_bangumi_subject_id',
    'external_ids_anilist_media_id',
    'external_ids_vndb_id',
    'external_ids_wikidata_qid',
    'external_ids_mal_id',
    'external_ids_official_url',
  ]
  const factualChildTables = new Set([
    'works_aliases',
    'works_candidate_sources',
    'works_creator_credits',
    'works_localized_titles',
    'works_organizations',
    'works_rels',
    'works_source_links',
  ])
  const discardedAssessmentTables = new Set([
    'works_human_assessment_source_links',
    'works_radar_assessment_contradictions',
    'works_radar_assessment_matched_rules',
    'works_review_reasons',
  ])

  const mergeDecisions = []
  const fieldPlan = []
  const relationPlan = []
  const assessmentCleanup = []
  const feedbackCleanup = []
  const versionPreservation = []

  for (const group of comparison.groups) {
    const decision = decisionByGroup.get(group.alertId)
    if (!decision) throw new Error(`Missing decision for ${group.alertId}`)
    const canonical = worksById.get(decision.canonicalWorkId)
    const mergeOut = worksById.get(decision.mergeOutWorkId)
    if (!canonical || !mergeOut) throw new Error(`Missing Work rows for ${group.alertId}`)

    const canonicalRelated = relatedRows.filter((entry) => rowParentId(entry) === decision.canonicalWorkId)
    const mergeOutRelated = relatedRows.filter((entry) => rowParentId(entry) === decision.mergeOutWorkId)
    const canonicalSignaturesByTable = new Map()
    for (const entry of canonicalRelated) {
      if (!factualChildTables.has(entry.tableName)) continue
      if (!canonicalSignaturesByTable.has(entry.tableName)) canonicalSignaturesByTable.set(entry.tableName, new Set())
      canonicalSignaturesByTable.get(entry.tableName).add(semanticChildSignature(entry))
    }

    const externalIdCopies = []
    for (const field of externalIdFields) {
      const sourceValue = mergeOut[field]
      const targetValue = canonical[field]
      if (!blank(sourceValue) && blank(targetValue)) {
        externalIdCopies.push({ field, from: sourceValue, to: sourceValue })
        fieldPlan.push({
          alertId: group.alertId,
          workId: decision.canonicalWorkId,
          field,
          action: 'copy_missing_factual_value_from_merge_out',
          before: targetValue ?? null,
          after: sourceValue,
          sourceWorkId: decision.mergeOutWorkId,
          executable: false,
        })
      } else if (!blank(sourceValue) && !blank(targetValue) && String(sourceValue) !== String(targetValue)) {
        fieldPlan.push({
          alertId: group.alertId,
          workId: decision.canonicalWorkId,
          field,
          action: 'preserve_canonical_and_record_external_id_conflict',
          before: targetValue,
          after: targetValue,
          mergeOutValue: sourceValue,
          executable: false,
        })
      }
    }

    fieldPlan.push(
      {
        alertId: group.alertId,
        workId: decision.canonicalWorkId,
        field: 'catalog_status / visibility / payload status',
        action: 'keep_canonical_public_identity',
        before: {
          catalogStatus: canonical.catalog_status,
          isLiteVisible: canonical.is_lite_visible,
          isFullVisible: canonical.is_full_visible,
          payloadStatus: canonical._status,
        },
        after: {
          catalogStatus: 'active',
          isLiteVisible: true,
          isFullVisible: true,
          payloadStatus: canonical._status,
        },
        executable: false,
      },
      {
        alertId: group.alertId,
        workId: decision.mergeOutWorkId,
        field: 'catalog_status / visibility / payload status',
        action: 'soft_archive_merge_out_without_deleting_or_rewriting_versions',
        before: {
          catalogStatus: mergeOut.catalog_status,
          isLiteVisible: mergeOut.is_lite_visible,
          isFullVisible: mergeOut.is_full_visible,
          payloadStatus: mergeOut._status,
        },
        after: {
          catalogStatus: 'archived',
          isLiteVisible: false,
          isFullVisible: false,
          payloadStatus: mergeOut._status,
        },
        executable: false,
      },
    )

    const assessmentTargets = [decision.canonicalWorkId, decision.mergeOutWorkId]
    for (const workId of assessmentTargets) {
      const row = worksById.get(workId)
      const reset = {}
      for (const key of Object.keys(row)) {
        if (key.startsWith('human_assessment_')
          || key.startsWith('human_review_')
          || key.startsWith('radar_assessment_')) {
          reset[key] = null
        }
      }
      reset.human_assessment_status = 'pending'
      reset.review_status = 'pending'
      reset.rank = 'unknown'
      reset.rating_notice = 'insufficient_information'
      reset.evidence_strength = 'unassessed'
      assessmentCleanup.push({
        alertId: group.alertId,
        workId,
        action: 'discard_confirmed_test_human_and_ai_assessment_state',
        userAuthorization: 'current identity group explicitly confirmed as inaccurate temporary review test data',
        before: Object.fromEntries(Object.keys(reset).map((key) => [key, row[key] ?? null])),
        after: reset,
        publicAIConclusionToCreate: false,
        executable: false,
      })
    }

    for (const entry of mergeOutRelated) {
      const base = {
        alertId: group.alertId,
        tableSchema: entry.tableSchema,
        tableName: entry.tableName,
        columnName: entry.columnName,
        sourceWorkId: decision.mergeOutWorkId,
        targetWorkId: decision.canonicalWorkId,
        rowId: entry.row?.id ?? null,
        executable: false,
      }
      if (entry.tableName === '_works_v') {
        relationPlan.push({ ...base, action: 'preserve_version_parent_in_place' })
      } else if (entry.tableName === 'feedback_submissions') {
        feedbackCleanup.push({
          ...base,
          action: 'archive_confirmed_test_feedback_without_treating_it_as_evidence',
          targetWorkflowStatus: 'archived',
          relinkToCanonical: false,
        })
      } else if (discardedAssessmentTables.has(entry.tableName)) {
        relationPlan.push({ ...base, action: 'discard_test_assessment_child_row' })
      } else if (factualChildTables.has(entry.tableName)) {
        const signature = semanticChildSignature(entry)
        const duplicate = canonicalSignaturesByTable.get(entry.tableName)?.has(signature) || false
        relationPlan.push({
          ...base,
          action: duplicate
            ? 'skip_semantic_duplicate_already_on_canonical'
            : 'copy_factual_child_to_canonical_if_exact_before_still_matches',
          semanticDuplicate: duplicate,
          semanticSignatureSha256: crypto.createHash('sha256').update(signature).digest('hex'),
        })
      } else {
        relationPlan.push({
          ...base,
          action: 'manual_reference_rewrite_review_required',
          relationKind: entry.relationKind,
        })
      }
    }

    for (const entry of canonicalRelated) {
      if (entry.tableName === 'feedback_submissions') {
        feedbackCleanup.push({
          alertId: group.alertId,
          tableSchema: entry.tableSchema,
          tableName: entry.tableName,
          columnName: entry.columnName,
          sourceWorkId: decision.canonicalWorkId,
          targetWorkId: decision.canonicalWorkId,
          rowId: entry.row?.id ?? null,
          action: 'archive_confirmed_test_feedback_without_treating_it_as_evidence',
          targetWorkflowStatus: 'archived',
          relinkToCanonical: false,
          executable: false,
        })
      }
      if (discardedAssessmentTables.has(entry.tableName)) {
        relationPlan.push({
          alertId: group.alertId,
          tableSchema: entry.tableSchema,
          tableName: entry.tableName,
          columnName: entry.columnName,
          sourceWorkId: decision.canonicalWorkId,
          targetWorkId: decision.canonicalWorkId,
          rowId: entry.row?.id ?? null,
          action: 'discard_test_assessment_child_row',
          executable: false,
        })
      }
    }

    const groupVersionRows = versionRows.filter((entry) => {
      const json = JSON.stringify(entry)
      return json.includes(`"parent_id":${decision.canonicalWorkId}`)
        || json.includes(`"parent_id":${decision.mergeOutWorkId}`)
        || json.includes(`"_parent_id":${decision.canonicalWorkId}`)
        || json.includes(`"_parent_id":${decision.mergeOutWorkId}`)
    })
    versionPreservation.push({
      alertId: group.alertId,
      canonicalWorkId: decision.canonicalWorkId,
      mergeOutWorkId: decision.mergeOutWorkId,
      action: 'preserve_all_existing_payload_versions_and_version_children_in_place',
      observedVersionEvidenceRows: groupVersionRows.length,
      reparentVersions: false,
      deleteVersions: false,
      executable: false,
    })

    mergeDecisions.push({
      alertId: group.alertId,
      canonicalWorkId: decision.canonicalWorkId,
      mergeOutWorkId: decision.mergeOutWorkId,
      canonicalTitle: canonical.title,
      mergeOutTitle: mergeOut.title,
      decisionBasis: {
        canonicalNonEmptyPhysicalFields: group.members.find((row) => Number(row.id) === decision.canonicalWorkId)?.nonEmptyPhysicalFields,
        mergeOutNonEmptyPhysicalFields: group.members.find((row) => Number(row.id) === decision.mergeOutWorkId)?.nonEmptyPhysicalFields,
        canonicalOwnedChildRows: group.members.find((row) => Number(row.id) === decision.canonicalWorkId)?.ownedChildRows,
        mergeOutOwnedChildRows: group.members.find((row) => Number(row.id) === decision.mergeOutWorkId)?.ownedChildRows,
        canonicalInboundReferences: group.members.find((row) => Number(row.id) === decision.canonicalWorkId)?.externalInboundReferenceRows,
        mergeOutInboundReferences: group.members.find((row) => Number(row.id) === decision.mergeOutWorkId)?.externalInboundReferenceRows,
      },
      externalIdCopies,
      assessmentPolicy: 'discard_all_current_human_and_ai_test_assessments; reset to pending/unknown; create no public AI conclusion',
      mergeOutPolicy: 'soft archive and hide; preserve row, slug, siteId and Payload versions for traceability',
      canonicalDecisionApplied: false,
      mergePerformed: false,
    })
  }

  const allIds = new Set(mergeDecisions.flatMap((row) => [row.canonicalWorkId, row.mergeOutWorkId]))
  const exactBeforeSql = `BEGIN TRANSACTION READ ONLY;\n\nSELECT row_to_json(w)\nFROM public.works w\nWHERE w.id IN (${sqlIdList(allIds)})\nORDER BY w.id;\n\nSELECT table_name, column_name, data_type, udt_name\nFROM information_schema.columns\nWHERE table_schema = 'public'\n  AND table_name IN ('works', 'feedback_submissions', 'works_aliases', 'works_candidate_sources', 'works_source_links')\nORDER BY table_name, ordinal_position;\n\nSELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition\nFROM pg_constraint\nWHERE conrelid IN (\n  'public.works'::regclass,\n  'public.feedback_submissions'::regclass,\n  'public.works_aliases'::regclass,\n  'public.works_candidate_sources'::regclass,\n  'public.works_source_links'::regclass\n)\nORDER BY conrelid::regclass::text, conname;\n\nROLLBACK;`
  writeText(path.join(outputDir, 'exact-before-readonly.sql'), exactBeforeSql)

  const previewLines = [
    'NON-EXECUTABLE MERGE PREVIEW. Every line is a SQL comment.',
    'A fresh restorable backup, exact-before match and explicit execution approval are still required.',
    '',
  ]
  for (const decision of mergeDecisions) {
    previewLines.push(
      `GROUP ${decision.alertId}`,
      `CANONICAL WORK ${decision.canonicalWorkId}; MERGE-OUT WORK ${decision.mergeOutWorkId}`,
      `PLAN: copy missing factual external IDs and non-duplicate factual child rows to ${decision.canonicalWorkId}.`,
      `PLAN: clear human/AI assessment state on both Works; rank=unknown; rating_notice=insufficient_information.`,
      `PLAN: archive feedback rows identified as temporary tests.`,
      `PLAN: soft archive ${decision.mergeOutWorkId}; keep its slug/siteId/versions for traceability.`,
      `PLAN: keep ${decision.canonicalWorkId} active and visible.`,
      '',
    )
  }
  writeText(path.join(outputDir, 'merge-preview-commented.sql'), commentSql(previewLines))

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceDirectory: inputDir,
    sourceIdentityComparisonSha256: sha256File(path.join(inputDir, 'identity-comparison.json')),
    identityGroups: mergeDecisions.length,
    canonicalDecisions: mergeDecisions.length,
    fieldPlanRows: fieldPlan.length,
    relationPlanRows: relationPlan.length,
    assessmentCleanupRows: assessmentCleanup.length,
    feedbackCleanupRows: feedbackCleanup.length,
    versionPreservationRows: versionPreservation.length,
    userAuthorizedTestAssessmentDiscard: true,
    safety: {
      databaseWrite: false,
      payloadWrite: false,
      migrationGeneration: false,
      schemaPush: false,
      executableUpdateSqlGenerated: false,
      canonicalDecisionApplied: false,
      mergePerformed: false,
      hardDeletePlanned: false,
      versionRewritePlanned: false,
    },
  }

  writeJson(path.join(outputDir, 'canonical-merge-decisions.json'), mergeDecisions)
  writeJsonl(path.join(outputDir, 'field-merge-plan.jsonl'), fieldPlan)
  writeJsonl(path.join(outputDir, 'relation-merge-plan.jsonl'), relationPlan)
  writeJsonl(path.join(outputDir, 'test-assessment-cleanup-plan.jsonl'), assessmentCleanup)
  writeJsonl(path.join(outputDir, 'feedback-test-cleanup-plan.jsonl'), feedbackCleanup)
  writeJsonl(path.join(outputDir, 'version-preservation-plan.jsonl'), versionPreservation)
  writeJson(path.join(outputDir, 'merge-dryrun-summary.json'), summary)

  const md = [
    '# Test Work merge dry-run',
    '',
    'Status: reviewed identity decisions only. No database write, Payload write, merge, hard delete, migration, or version rewrite was performed.',
    '',
    ...mergeDecisions.flatMap((row) => [
      `## ${row.canonicalTitle}`,
      '',
      `- canonical Work: ${row.canonicalWorkId}`,
      `- merge-out Work: ${row.mergeOutWorkId}`,
      `- external ID copies: ${row.externalIdCopies.length}`,
      '- existing human and AI assessment state: discard as confirmed temporary test data',
      '- final assessment baseline: human pending, effective grade unknown, no public AI conclusion',
      '- merge-out handling: soft archive and hide; preserve row and versions',
      '',
    ]),
    '## Safety',
    '',
    '- Database write: false',
    '- Payload write: false',
    '- Executable UPDATE SQL: false',
    '- Canonical decision applied: false',
    '- Merge performed: false',
    '- Hard delete planned: false',
    '- Version rewrite planned: false',
  ].join('\n')
  writeText(path.join(outputDir, 'merge-dryrun-summary.md'), md)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Test Work merge dry-run complete')
  console.log(`OutputDirectory: ${outputDir}`)
  console.log(`IdentityGroups: ${summary.identityGroups}`)
  console.log(`CanonicalDecisions: ${summary.canonicalDecisions}`)
  console.log(`AssessmentCleanupRows: ${summary.assessmentCleanupRows}`)
  console.log(`FeedbackCleanupRows: ${summary.feedbackCleanupRows}`)
  console.log('')
  console.log('DatabaseWrite: False')
  console.log('PayloadWrite: False')
  console.log('ExecutableUpdateSqlGenerated: False')
  console.log('CanonicalDecisionApplied: False')
  console.log('MergePerformed: False')
}

main()
