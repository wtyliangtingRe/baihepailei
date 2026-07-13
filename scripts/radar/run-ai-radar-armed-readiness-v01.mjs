#!/usr/bin/env node
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const APPLY_SCRIPT = 'scripts/radar/apply-ai-radar-payload-patches-v01.mjs'
const FIXED_OUT_DIR = 'data_local/staging/ai-radar/payload-apply-armed-readiness-v01'

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

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.confirm || args['execute-confirmation']) {
    throw new Error('Armed readiness is read-only. Execute/apply/confirmation flags are rejected.')
  }
  if (args['out-dir']) {
    throw new Error(`Armed readiness output is fixed to ${FIXED_OUT_DIR} so the candidate-bound readiness cannot be overwritten.`)
  }

  const checkpoint = required(args, 'checkpoint')
  const gate = required(args, 'gate')
  const candidateManifest = required(args, 'candidate-manifest')
  const approvalToken = required(args, 'approval-token')
  const url = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000')

  const childArgs = [
    path.resolve(APPLY_SCRIPT),
    '--url', url,
    '--checkpoint', checkpoint,
    '--gate', gate,
    '--candidate-manifest', candidateManifest,
    '--approval-token', approvalToken,
    '--require-execution-ready',
    '--out-dir', FIXED_OUT_DIR,
  ]

  const result = spawnSync(process.execPath, childArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (result.error) throw result.error
  process.exitCode = Number.isInteger(result.status) ? result.status : 1
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
