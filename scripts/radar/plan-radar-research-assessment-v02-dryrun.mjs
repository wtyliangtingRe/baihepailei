#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, rejectWriteFlags, val } from './lib/research-assessment-handoff-v02.mjs'
import { assertImportOutputPath, loadValidatedPlannerInput, writeWebsiteRepresentationPlan } from './lib/research-assessment-import-v02.mjs'

export function runPlan(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  const dataLocalRoot = path.resolve('data_local')
  const outputRoot = assertImportOutputPath(path.resolve(val(args['out-dir']) || 'data_local/outputs/ai-radar/research-assessment-import-v02'), dataLocalRoot)
  const rowsFile = assertImportOutputPath(path.resolve(val(args.rows) || path.join(outputRoot, 'rows/all-imported-review-v02.jsonl')), dataLocalRoot)
  const validated = loadValidatedPlannerInput(outputRoot, rowsFile, dataLocalRoot)
  const plan = writeWebsiteRepresentationPlan(validated.rows, outputRoot, dataLocalRoot)
  return { outputRoot, importerIntegrity: validated.integrity, ...plan.summary }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  try {
    console.log(JSON.stringify(runPlan(), null, 2))
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}
