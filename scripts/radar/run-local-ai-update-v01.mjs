#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const VERSION = 'local-ai-radar-update-v0.1'
const DEFAULT_ROOT = 'data_local/staging/ai-radar/local-update-v01'

function val(value) {
  return String(value ?? '').trim()
}

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

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${file}`)
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '').trim()
  return text ? text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)) : []
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
}

function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Local AI update artifacts must remain below ignored data_local/.')
  }
}

function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], {
    stdio: 'inherit',
    env,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`)
}

function runAssessor(command, env) {
  const child = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { stdio: 'inherit', env, shell: false })
    : spawnSync('/bin/sh', ['-lc', command], { stdio: 'inherit', env, shell: false })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Configured AI assessor failed with exit code ${child.status}`)
}

function normalizeTitle(value) {
  return val(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function scopeRows(rows, scope) {
  if (scope === 'all') return rows.filter((row) => !row?.writeProtection?.protected)
  if (scope === 'feedback-drafts') {
    return rows.filter((row) => !row?.writeProtection?.protected
      && !row?.existingState?.radarAssessment?.assessedAt
      && !row?.existingState?.radarAssessment?.suggestedGrade
      && String(row?.existingState?.importBatch || '').startsWith('feedback-intake:'))
  }
  if (scope !== 'unassessed') throw new Error('--scope must be unassessed, feedback-drafts, or all')
  return rows.filter((row) => !row?.writeProtection?.protected
    && !row?.existingState?.radarAssessment?.assessedAt
    && !row?.existingState?.radarAssessment?.suggestedGrade)
}

function rowKey(row) {
  const workId = val(row?.workId)
  const siteId = val(row?.siteId)
  if (!workId || !siteId) throw new Error('Every AI packet must contain workId and siteId.')
  return `${workId}\u0000${siteId}`
}

function modelFields(row, batchId) {
  return {
    evidenceCoverage: row?.evidenceCoverage,
    evidenceStatus: val(row?.evidenceStatus) || 'unknown',
    sourceSummary: val(row?.sourceSummary),
    sourceCount: Number.isFinite(Number(row?.sourceCount)) ? Number(row.sourceCount) : undefined,
    ruleAssessments: Array.isArray(row?.ruleAssessments) ? row.ruleAssessments : Array.isArray(row?.rules) ? row.rules : [],
    contradictions: Array.isArray(row?.contradictions) ? row.contradictions : [],
    assessmentNotes: Array.isArray(row?.assessmentNotes) ? row.assessmentNotes : [],
    assessmentBatch: val(row?.assessmentBatch) || batchId,
  }
}

function mergeScoredRows(inputRows, modelRows, batchId) {
  const modelByKey = new Map()
  const blockers = []
  for (const row of modelRows) {
    let key = ''
    try { key = rowKey(row) } catch (error) { blockers.push(error.message); continue }
    if (modelByKey.has(key)) blockers.push(`duplicate_model_result:${key.replace('\u0000', ':')}`)
    else modelByKey.set(key, row)
  }

  const merged = []
  for (const packet of inputRows) {
    const key = rowKey(packet)
    const model = modelByKey.get(key)
    if (!model) {
      blockers.push(`missing_model_result:${key.replace('\u0000', ':')}`)
      continue
    }
    merged.push({
      ...packet,
      ...modelFields(model, batchId),
      // Model-controlled fields are intentionally whitelisted above. Identity,
      // source packets, previous ratings and write protection remain local facts.
      title: packet.title,
      workId: packet.workId,
      siteId: packet.siteId,
      existingState: packet.existingState,
      writeProtection: packet.writeProtection,
    })
    modelByKey.delete(key)
  }
  for (const key of modelByKey.keys()) blockers.push(`unexpected_model_result:${key.replace('\u0000', ':')}`)
  if (blockers.length) throw new Error(`AI assessor output does not match its input exactly: ${blockers.slice(0, 20).join(', ')}${blockers.length > 20 ? ` (+${blockers.length - 20} more)` : ''}`)
  return merged
}

function scorerContract({ runDir, inputFile, modelOutputFile, scope, rows }) {
  return {
    version: VERSION,
    mode: 'scorer_contract',
    runDir,
    scope,
    inputFile,
    inputSha256: sha256File(inputFile),
    expectedRows: rows.map((row) => ({ workId: val(row.workId), siteId: val(row.siteId), title: val(row.title) })),
    outputFile: modelOutputFile,
    outputFormat: {
      requiredIdentity: ['workId', 'siteId'],
      acceptedFields: ['workId', 'siteId', 'evidenceCoverage', 'evidenceStatus', 'sourceSummary', 'sourceCount', 'ruleAssessments', 'contradictions', 'assessmentNotes', 'assessmentBatch'],
      prohibitedBehavior: [
        'Do not modify titles, existingState, writeProtection, source packet facts, humanAssessment or identifiers.',
        'Do not invent sources, plot details, endings or relationships.',
        'Return JSONL only: exactly one result for every input row.',
      ],
    },
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write || args.patch) {
    throw new Error('This local orchestration command is preparation and dry-run only. Apply requires the separately armed release workflow and a fresh checkpoint.')
  }

  const requestedRoot = val(args['out-dir'])
  const runId = `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomUUID().slice(0, 8)}`
  const runDir = requestedRoot || path.join(DEFAULT_ROOT, runId)
  assertUnderDataLocal(runDir)
  if (fs.existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`)
  fs.mkdirSync(runDir, { recursive: false })

  const baseUrl = val(args.url || process.env.PAYLOAD_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const scope = val(args.scope || 'unassessed')
  const inputDir = path.join(runDir, 'input')
  const auditDir = path.join(runDir, 'input-audit')
  const assessmentDir = path.join(runDir, 'assessment')
  const planDir = path.join(runDir, 'payload-plan')
  const dryRunDir = path.join(runDir, 'payload-dryrun')
  const rawInput = path.join(inputDir, 'all-packets.jsonl')
  const rawInputSummary = path.join(inputDir, 'all-packets-summary.json')
  const cleanInput = path.join(auditDir, 'ai-radar-clean-input-v01.jsonl')
  const scopedInput = path.join(inputDir, 'scoped-packets.jsonl')
  const modelOutput = path.join(assessmentDir, 'model-output.jsonl')
  const mergedOutput = path.join(assessmentDir, 'trusted-merged-model-output.jsonl')
  const contractFile = path.join(assessmentDir, 'assessor-contract.json')
  const manifestFile = path.join(runDir, 'run-manifest.json')

  const buildArgs = ['--out-dir', inputDir, '--output', rawInput, '--summary', rawInputSummary]
  if (args.file) buildArgs.push('--file', String(args.file))
  else buildArgs.push('--url', baseUrl)
  if (Number(args.limit) > 0) buildArgs.push('--limit', String(Number(args.limit)))
  run('scripts/radar/build-ai-radar-input-v01.mjs', buildArgs)
  run('scripts/radar/audit-ai-radar-input-v01.mjs', ['--input', rawInput, '--out-dir', auditDir])
  run('scripts/radar/guard-ai-radar-exact-summary-duplicates-v01.mjs', ['--input', cleanInput, '--out-dir', auditDir])

  const cleanRows = readJsonl(cleanInput)
  const selectedRows = scopeRows(cleanRows, scope)
  writeJsonl(scopedInput, selectedRows)

  const initialManifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    runDir,
    baseUrl: args.file ? null : baseUrl,
    scope,
    input: {
      allPackets: rawInput,
      allPacketsSha256: sha256File(rawInput),
      cleanPackets: cleanInput,
      cleanPacketsSha256: sha256File(cleanInput),
      selectedPackets: scopedInput,
      selectedPacketsSha256: sha256File(scopedInput),
      allRows: cleanRows.length,
      selectedRows: selectedRows.length,
    },
    outputs: { contractFile, modelOutput, mergedOutput, assessmentDir, planDir, dryRunDir },
    safety: {
      payloadRead: !args.file,
      payloadWrite: false,
      directPostgresqlWrite: false,
      humanTrackMutable: false,
      autoPublishes: false,
      requiresExactOneToOneModelOutput: true,
    },
  }
  writeJson(manifestFile, initialManifest)

  if (selectedRows.length === 0) {
    writeJson(path.join(runDir, 'summary.json'), {
      ...initialManifest,
      complete: true,
      status: 'nothing_to_assess',
      nextStep: 'No selected rows need an AI assessment for this scope.',
    })
    console.log(JSON.stringify({ ok: true, status: 'nothing_to_assess', runDir, selectedRows: 0 }, null, 2))
    return
  }

  const contract = scorerContract({ runDir, inputFile: scopedInput, modelOutputFile: modelOutput, scope, rows: selectedRows })
  writeJson(contractFile, contract)

  const suppliedOutput = val(args['model-output'])
  const assessorCommand = val(args['assessor-command'] || process.env.BAIHEPAILEI_AI_ASSESSOR_COMMAND)
  if (suppliedOutput) {
    if (!fs.existsSync(suppliedOutput)) throw new Error(`--model-output file not found: ${suppliedOutput}`)
    fs.copyFileSync(suppliedOutput, modelOutput)
  } else if (assessorCommand) {
    runAssessor(assessorCommand, {
      ...process.env,
      BAIHEPAILEI_AI_INPUT: path.resolve(scopedInput),
      BAIHEPAILEI_AI_OUTPUT: path.resolve(modelOutput),
      BAIHEPAILEI_AI_CONTRACT: path.resolve(contractFile),
      BAIHEPAILEI_AI_RUN_DIR: path.resolve(runDir),
    })
  } else {
    writeJson(path.join(runDir, 'summary.json'), {
      ...initialManifest,
      complete: false,
      status: 'awaiting_assessor',
      nextStep: 'Set BAIHEPAILEI_AI_ASSESSOR_COMMAND (or pass --assessor-command) so one local command can run your approved AI worker. The worker reads BAIHEPAILEI_AI_INPUT and writes BAIHEPAILEI_AI_OUTPUT.',
    })
    console.log(JSON.stringify({ ok: true, status: 'awaiting_assessor', runDir, contractFile, selectedRows: selectedRows.length }, null, 2))
    return
  }

  const mergedRows = mergeScoredRows(selectedRows, readJsonl(modelOutput), `local:${runId}`)
  writeJsonl(mergedOutput, mergedRows)
  run('scripts/radar/resolve-ai-radar-assessments-v01.mjs', ['--input', mergedOutput, '--out-dir', assessmentDir])
  const resolved = path.join(assessmentDir, 'ai-radar-resolved-v01.jsonl')
  const resolvedSummary = path.join(assessmentDir, 'ai-radar-resolve-v01-summary.json')
  run('scripts/radar/audit-ai-radar-source-provenance-v01.mjs', ['--input', resolved, '--out-dir', path.join(assessmentDir, 'source-provenance-audit')])
  run('scripts/radar/plan-ai-radar-payload-patches-v01.mjs', [
    '--input', resolved,
    '--metrics', resolvedSummary,
    '--out-dir', planDir,
    '--expected-rows', String(mergedRows.length),
    '--url', baseUrl,
  ])
  const planFile = path.join(planDir, 'ai-radar-payload-patch-plan-v01.jsonl')
  run('scripts/radar/dryrun-ai-radar-payload-patches-v01.mjs', [
    '--input', planFile,
    '--out-dir', dryRunDir,
    '--expected-rows', String(mergedRows.length),
    '--url', baseUrl,
  ])

  const summary = {
    ...initialManifest,
    completedAt: new Date().toISOString(),
    complete: true,
    status: 'dry_run_complete',
    assessment: {
      modelOutput,
      modelOutputSha256: sha256File(modelOutput),
      trustedMergedOutput: mergedOutput,
      trustedMergedOutputSha256: sha256File(mergedOutput),
      resolved,
      resolvedSummary,
    },
    payloadPlan: planFile,
    payloadDryRun: path.join(dryRunDir, 'ai-radar-payload-patch-dryrun-v01-summary.json'),
    nextStep: 'Review the generated dry-run and create a fresh checkpoint before the separately armed apply workflow. This command has made no Payload or database writes.',
  }
  writeJson(path.join(runDir, 'summary.json'), summary)
  console.log(JSON.stringify({ ok: true, status: summary.status, runDir, selectedRows: selectedRows.length, summary }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
