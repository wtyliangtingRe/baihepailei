#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, readJsonl, rejectWriteFlags, val } from './lib/research-assessment-handoff-v02.mjs'
import { assertImportOutputPath, writeWebsiteRepresentationPlan } from './lib/research-assessment-import-v02.mjs'

export function runPlan(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  const dataLocalRoot = path.resolve('data_local')
  const outputRoot = assertImportOutputPath(path.resolve(val(args['out-dir']) || 'data_local/outputs/ai-radar/research-assessment-import-v02'), dataLocalRoot)
  const rowsFile = assertImportOutputPath(path.resolve(val(args.rows) || path.join(outputRoot, 'rows/all-imported-review-v02.jsonl')), dataLocalRoot)
  if (!fs.existsSync(rowsFile)) throw new Error(`Imported review rows not found: ${rowsFile}`)
  const rows = readJsonl(rowsFile)
  const plan = writeWebsiteRepresentationPlan(rows, outputRoot, dataLocalRoot)
  return { outputRoot, ...plan.summary }
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
