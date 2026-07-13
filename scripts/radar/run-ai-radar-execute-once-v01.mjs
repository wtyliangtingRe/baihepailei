#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const APPLY_SCRIPT = 'scripts/radar/apply-ai-radar-payload-patches-v01.mjs'
const EXECUTE_ROOT = 'data_local/staging/ai-radar/payload-apply-execute-runs-v01'

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

function runId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/gu, '')
  return `${stamp}-${randomUUID().slice(0, 8)}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args['out-dir']) throw new Error('Execute output is automatically isolated per run; --out-dir is rejected.')
  if (args.apply || args.confirm || args.limit) throw new Error('Legacy apply/confirm and --limit are rejected.')

  const checkpoint = required(args, 'checkpoint')
  const gate = required(args, 'gate')
  const candidateManifest = required(args, 'candidate-manifest')
  const approvalToken = required(args, 'approval-token')
  const executeConfirmation = required(args, 'execute-confirmation')
  const url = String(args.url || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000')
  const outDir = path.join(EXECUTE_ROOT, runId())

  if (fs.existsSync(outDir)) throw new Error(`Unexpected existing execute directory: ${outDir}`)
  fs.mkdirSync(outDir, { recursive: false })
  console.log(`Execute evidence directory: ${outDir}`)

  const childArgs = [
    path.resolve(APPLY_SCRIPT),
    '--url', url,
    '--checkpoint', checkpoint,
    '--gate', gate,
    '--candidate-manifest', candidateManifest,
    '--approval-token', approvalToken,
    '--execute-confirmation', executeConfirmation,
    '--execute',
    '--out-dir', outDir,
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
