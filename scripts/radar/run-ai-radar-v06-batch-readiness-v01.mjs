#!/usr/bin/env node
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ENGINE = 'scripts/radar/apply-ai-radar-v06-batch-v01.mjs'

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

function required(args, key) {
  const value = args[key]
  if (!value || value === true) throw new Error(`--${key} is required`)
  return String(value)
}

function add(args, output, key) {
  if (args[key] && args[key] !== true) output.push(`--${key}`, String(args[key]))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.write || args.patch || args.confirm || args['execute-confirmation']) {
    throw new Error('Readiness wrapper cannot execute writes. Execute/apply/write flags are rejected.')
  }
  const childArgs = [
    path.resolve(ENGINE),
    '--candidate-manifest', required(args, 'candidate-manifest'),
    '--checkpoint', required(args, 'checkpoint'),
  ]
  for (const key of ['url', 'gate', 'approval-token', 'out-dir', 'max-backup-age-hours']) add(args, childArgs, key)
  const result = spawnSync(process.execPath, childArgs, { stdio: 'inherit', env: process.env, shell: false })
  if (result.error) throw result.error
  process.exitCode = Number.isInteger(result.status) ? result.status : 1
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
