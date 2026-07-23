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

function normalized(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

function parentId(entry) {
  return entry?.row?.[entry.columnName]
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args['identity-audit-dir'] || !args['output-dir']) {
    throw new Error('Required: --identity-audit-dir and --output-dir')
  }

  const identityDir = path.resolve(String(args['identity-audit-dir']))
  const outputDir = path.resolve(String(args['output-dir']))
  const decisions = readJson(path.join(outputDir, 'canonical-merge-decisions.json'))
  const workRows = readJsonl(path.join(identityDir, 'work-rows.jsonl'))
  const relatedRows = readJsonl(path.join(identityDir, 'related-rows.jsonl'))
  const planPath = path.join(outputDir, 'work-standardization-plan.jsonl')
  const plan = readJsonl(planPath)
  const worksById = new Map(workRows.map((row) => [Number(row.id), row]))

  const evidence = []
  for (const decision of decisions) {
    const canonical = worksById.get(Number(decision.canonicalWorkId))
    const mergeOut = worksById.get(Number(decision.mergeOutWorkId))
    if (!canonical || !mergeOut) throw new Error(`Missing Work row for ${decision.alertId}`)

    const mergeOutTitle = String(mergeOut.title || '').trim()
    if (!mergeOutTitle || normalized(mergeOutTitle) === normalized(canonical.title)) continue

    const plannedAdd = plan.some((row) =>
      row.alertId === decision.alertId
      && row.action === 'add_merge_out_title_as_canonical_alias'
      && normalized(row.value) === normalized(mergeOutTitle))

    const canonicalNameRows = relatedRows.filter((entry) =>
      Number(parentId(entry)) === Number(decision.canonicalWorkId)
      && (entry.tableName === 'works_aliases' || entry.tableName === 'works_localized_titles'))
    const canonicalNames = [
      { source: 'works.title', value: canonical.title },
      { source: 'works.original_title', value: canonical.original_title },
      ...canonicalNameRows.flatMap((entry) => [
        { source: `${entry.tableName}.value`, value: entry.row?.value, rowId: entry.row?.id ?? null },
        { source: `${entry.tableName}.title`, value: entry.row?.title, rowId: entry.row?.id ?? null },
      ]),
    ].filter((entry) => entry.value)

    const existing = canonicalNames.find((entry) => normalized(entry.value) === normalized(mergeOutTitle))
    if (!plannedAdd && !existing) {
      throw new Error(`Merge-out title is neither present nor planned as alias: ${decision.alertId} / ${mergeOutTitle}`)
    }

    const row = {
      alertId: decision.alertId,
      workId: decision.canonicalWorkId,
      mergeOutWorkId: decision.mergeOutWorkId,
      value: mergeOutTitle,
      protected: true,
      protectionMode: plannedAdd ? 'planned_add' : 'already_present',
      action: plannedAdd
        ? 'merge_out_title_alias_addition_already_planned'
        : 'merge_out_title_already_present_on_canonical',
      evidenceSource: plannedAdd ? 'work-standardization-plan' : existing.source,
      evidenceRowId: existing?.rowId ?? null,
      executable: false,
    }
    evidence.push(row)

    if (!plannedAdd && !plan.some((candidate) =>
      candidate.alertId === decision.alertId
      && candidate.action === 'merge_out_title_already_present_on_canonical'
      && normalized(candidate.value) === normalized(mergeOutTitle))) {
      plan.push(row)
    }
  }

  writeJsonl(planPath, plan)
  writeJsonl(path.join(outputDir, 'alias-protection-evidence.jsonl'), evidence)

  const summaryPath = path.join(outputDir, 'merge-dryrun-summary.json')
  const summary = readJson(summaryPath)
  summary.standardizationPlanRows = plan.length
  summary.mergeOutTitleAliasProtected = evidence.every((row) => row.protected === true)
  summary.mergeOutTitleAliasProtectionEvidence = true
  summary.mergeOutTitleAliasProtectionRows = evidence.length
  summary.mergeOutTitleAliasAlreadyPresentRows = evidence.filter((row) => row.protectionMode === 'already_present').length
  summary.mergeOutTitleAliasPlannedAddRows = evidence.filter((row) => row.protectionMode === 'planned_add').length
  writeJson(summaryPath, summary)

  const markdownPath = path.join(outputDir, 'merge-dryrun-summary.md')
  const markdown = readText(markdownPath).trimEnd()
  writeText(markdownPath, `${markdown}\n\n## Alias protection evidence\n\n- Distinct merge-out titles protected: ${evidence.length}\n- Already present on canonical: ${summary.mergeOutTitleAliasAlreadyPresentRows}\n- Planned alias additions: ${summary.mergeOutTitleAliasPlannedAddRows}\n`)

  const files = fs.readdirSync(outputDir).filter((name) => name !== 'manifest.json').sort()
  writeJson(path.join(outputDir, 'manifest.json'), files.map((name) => {
    const file = path.join(outputDir, name)
    return { file: name, bytes: fs.statSync(file).size, sha256: sha256File(file) }
  }))

  console.log('Merge-out title alias protection evidence complete')
  console.log(`AliasProtectionRows: ${evidence.length}`)
  console.log(`AliasAlreadyPresentRows: ${summary.mergeOutTitleAliasAlreadyPresentRows}`)
  console.log(`AliasPlannedAddRows: ${summary.mergeOutTitleAliasPlannedAddRows}`)
  console.log('DatabaseWrite: False')
  console.log('MergePerformed: False')
}

main()
