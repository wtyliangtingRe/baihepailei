#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, rejectWriteFlags, val } from './lib/research-assessment-handoff-v02.mjs'
import { loadAssessmentImportPackage, writeImportReviewOutputs } from './lib/research-assessment-import-v02.mjs'

export function runImport(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  const dataLocalRoot = path.resolve('data_local')
  const input = path.resolve(val(args.input))
  const expectedSha256 = val(args['expected-sha256'])
  const acceptanceFile = path.resolve(val(args.acceptance) || 'scripts/radar/fixtures/radar-research-assessment-import-accepted-0001-v02.json')
  const stagingRoot = path.resolve(val(args['staging-dir']) || 'data_local/staging/ai-radar/research-assessment-import-v02/package')
  const outputRoot = path.resolve(val(args['out-dir']) || 'data_local/outputs/ai-radar/research-assessment-import-v02')
  if (!val(args.input)) throw new Error('--input is required')
  if (!expectedSha256) throw new Error('--expected-sha256 is required')
  const acceptance = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8'))
  const validated = loadAssessmentImportPackage({ input, expectedSha256, stagingRoot, acceptance, dataLocalRoot })
  const written = writeImportReviewOutputs(validated, outputRoot, dataLocalRoot)
  return { ...written.summary, outputRoot: written.root }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  try {
    console.log(JSON.stringify(runImport(), null, 2))
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}
