#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_ROOT = 'data_local/staging/ai-radar/catalog-v01'

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

function val(value) {
  return String(value ?? '').trim()
}

function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Full catalog outputs must remain under ignored data_local.')
  }
}

function run(script, args) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.execute || args.apply || args.confirm || args.write || args.patch) {
    throw new Error('Full catalog preparation is read-only. Execute/apply/write flags are rejected.')
  }

  const root = val(args['out-dir']) || DEFAULT_ROOT
  assertUnderDataLocal(root)
  const rawDir = path.join(root, 'raw')
  const auditDir = path.join(root, 'audit')
  const queueDir = path.join(root, 'queue')
  const rawInput = path.join(rawDir, 'ai-radar-input-v01.jsonl')
  const rawSummary = path.join(rawDir, 'ai-radar-input-v01-summary.json')
  const cleanInput = path.join(auditDir, 'ai-radar-clean-input-v01.jsonl')
  const queueSummary = path.join(queueDir, 'catalog-queue-summary-v01.json')
  fs.mkdirSync(root, { recursive: true })

  const buildArgs = [
    '--out-dir', rawDir,
    '--output', rawInput,
    '--summary', rawSummary,
  ]
  if (args.file) buildArgs.push('--file', String(args.file))
  else buildArgs.push('--url', String(args.url || process.env.PAYLOAD_URL || 'http://localhost:3000'))
  if (Number(args.limit) > 0) buildArgs.push('--limit', String(Number(args.limit)))

  run('scripts/radar/build-ai-radar-input-v01.mjs', buildArgs)
  run('scripts/radar/audit-ai-radar-input-v01.mjs', [
    '--input', rawInput,
    '--out-dir', auditDir,
  ])
  run('scripts/radar/guard-ai-radar-exact-summary-duplicates-v01.mjs', [
    '--input', cleanInput,
    '--out-dir', auditDir,
  ])

  const queueArgs = [
    '--input', cleanInput,
    '--out-dir', queueDir,
  ]
  if (args['batch-size']) queueArgs.push('--batch-size', String(args['batch-size']))
  if (args['research-batch-size']) queueArgs.push('--research-batch-size', String(args['research-batch-size']))
  if (args['identity-batch-size']) queueArgs.push('--identity-batch-size', String(args['identity-batch-size']))
  run('scripts/radar/prepare-ai-radar-catalog-batches-v01.mjs', queueArgs)

  const result = {
    generatedAt: new Date().toISOString(),
    version: 'ai-radar-full-catalog-preparation-v0.1',
    mode: args.file ? 'local_file' : 'payload_read_only',
    root,
    limit: Number(args.limit) > 0 ? Number(args.limit) : null,
    raw: readJson(rawSummary),
    audit: readJson(path.join(auditDir, 'ai-radar-input-audit-v01-summary.json')),
    duplicateGuard: readJson(path.join(auditDir, 'ai-radar-exact-summary-duplicate-guard-v01-summary.json')),
    queue: readJson(queueSummary),
    safety: {
      payloadRead: !args.file,
      payloadWrite: false,
      payloadPatchRequests: 0,
      directPostgresqlWrite: false,
      modifiesWorks: false,
      credentialsWrittenToOutput: false,
    },
  }
  const summaryFile = path.join(root, 'full-catalog-preparation-summary-v01.json')
  fs.writeFileSync(summaryFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: result.queue.allRowsAccountedFor, summaryFile, queue: result.queue }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
}
