#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertReportPath,
  parseArgs,
  rejectWriteFlags,
  validatePublicReleaseDirectory,
  val,
} from './lib/public-release-v01.mjs'

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  const input = val(args.input)
  if (!input) throw new Error('--input is required')
  const reportPath = assertReportPath(
    val(args.report) || 'data_local/outputs/radar-public-release-v01/dry-run-report.json',
  )
  const report = validatePublicReleaseDirectory(path.resolve(input))
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { ...report, reportPath }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  try {
    console.log(JSON.stringify(run(), null, 2))
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }
}
