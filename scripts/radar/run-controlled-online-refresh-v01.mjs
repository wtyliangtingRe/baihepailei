#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { fetchControlledSourceSnapshots } from './fetch-controlled-source-snapshots-v01.mjs'

const VERSION = 'controlled-online-catalog-refresh-v0.1'
const DEFAULT_ROOT = 'data_local/staging/ai-radar/online-catalog-refresh-v01'
const SOURCE_KEYS = ['bangumi', 'yurizukan', 'vndb', 'steam']

function val(value) { return String(value ?? '').trim() }
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; i += 1 }
  }
  return args
}
function parseCsv(value, fallback = []) {
  if (!value) return fallback
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}
function parseNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.floor(number)))
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function sha256File(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function assertUnderDataLocal(target) {
  const root = path.resolve('data_local')
  const resolved = path.resolve(target)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Online catalog refresh artifacts must remain below ignored data_local/.')
}
function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [path.resolve(script), ...args], { stdio: 'inherit', env, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`)
}

export async function runControlledOnlineRefresh(options = {}) {
  const runId = options.runId || `${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomUUID().slice(0, 8)}`
  const runDir = options.outDir || path.join(DEFAULT_ROOT, runId)
  assertUnderDataLocal(runDir)
  if (fs.existsSync(runDir)) throw new Error(`Refusing to reuse existing online refresh directory: ${runDir}`)
  fs.mkdirSync(runDir, { recursive: true })

  const baseUrl = val(options.url || process.env.PAYLOAD_URL || process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000').replace(/\/+$/u, '')
  const sources = options.sources?.length ? options.sources : SOURCE_KEYS
  const profile = options.profile === 'full' ? 'full' : 'quick'
  const worksDir = path.join(runDir, 'works-snapshot')
  const rawWorks = path.join(worksDir, 'all-packets.jsonl')
  const rawWorksSummary = path.join(worksDir, 'all-packets-summary.json')
  const auditDir = path.join(worksDir, 'audit')
  const cleanWorks = path.join(auditDir, 'ai-radar-clean-input-v01.jsonl')

  run('scripts/radar/build-ai-radar-input-v01.mjs', ['--url', baseUrl, '--out-dir', worksDir, '--output', rawWorks, '--summary', rawWorksSummary])
  run('scripts/radar/audit-ai-radar-input-v01.mjs', ['--input', rawWorks, '--out-dir', auditDir])
  run('scripts/radar/guard-ai-radar-exact-summary-duplicates-v01.mjs', ['--input', cleanWorks, '--out-dir', auditDir])

  const sourceDir = path.join(runDir, 'source-fetch')
  const sourceSummary = await fetchControlledSourceSnapshots({
    outDir: sourceDir,
    profile,
    sources,
    delayMs: options.delayMs,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    timeoutMs: options.timeoutMs,
    userAgent: options.userAgent,
    bangumiPages: options.bangumiPages,
    vndbPages: options.vndbPages,
    yurizukanPages: options.yurizukanPages,
    yurizukanMaxArticles: options.yurizukanMaxArticles,
    steamPages: options.steamPages,
    steamMaxApps: options.steamMaxApps,
    steamTerms: options.steamTerms,
  })

  const discoveryDir = path.join(runDir, 'discovery-plan')
  const discoveryArgs = ['--works', cleanWorks, '--out-dir', discoveryDir]
  for (const source of sources) {
    const sourceFile = sourceSummary.outputs?.[source]
    if (!sourceFile) throw new Error(`Online source fetch did not produce ${source} output`)
    discoveryArgs.push(`--${source}`, sourceFile)
  }
  run('scripts/radar/prepare-controlled-source-discovery-v01.mjs', discoveryArgs)

  const discoverySummaryFile = path.join(discoveryDir, 'summary.json')
  const discoverySummary = JSON.parse(fs.readFileSync(discoverySummaryFile, 'utf8'))
  const candidatePlanSummaryFile = discoverySummary?.outputs?.plannerSummary || path.join(discoveryDir, 'candidate-plan', 'discovered-work-candidate-plan-v01-summary.json')
  const candidatePlanSummary = JSON.parse(fs.readFileSync(candidatePlanSummaryFile, 'utf8'))

  const summary = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    runDir,
    baseUrl,
    profile,
    sources,
    worksSnapshot: { raw: rawWorks, rawSha256: sha256File(rawWorks), clean: cleanWorks, cleanSha256: sha256File(cleanWorks), summary: rawWorksSummary },
    sourceFetch: { directory: sourceDir, summary: path.join(sourceDir, 'summary.json'), outputs: sourceSummary.outputs },
    discovery: { directory: discoveryDir, summary: discoverySummaryFile, candidatePlanSummary: candidatePlanSummaryFile, counts: candidatePlanSummary },
    safety: { externalFetch: true, payloadRead: true, payloadWrite: false, directPostgresqlWrite: false, createsWorks: false, updatesWorks: false, publishesWorks: false, mutatesHumanAssessment: false, mutatesRadarAssessment: false, applyAvailable: false, failOnFirstStageError: true },
    nextStep: 'Review the generated create/update/duplicate/blocked plan. A later checkpoint-gated release command will create eligible temporary Works, run AI assessment, dry-run, apply, read back, and rebuild indexes.',
  }
  writeJson(path.join(runDir, 'summary.json'), summary)
  return summary
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.apply || args.execute || args.confirm || args.write || args.patch || args.publish || args['auto-apply']) throw new Error('This online refresh command currently ends at a read-only create/update/duplicate/blocked plan. Apply will be added only through a separately checkpoint-gated release stage.')
  const summary = await runControlledOnlineRefresh({
    url: args.url,
    outDir: val(args['out-dir']) || undefined,
    profile: val(args.profile || 'quick'),
    sources: parseCsv(args.sources, SOURCE_KEYS),
    delayMs: args['delay-ms'], retries: args.retries, retryDelayMs: args['retry-delay-ms'], timeoutMs: args['timeout-ms'],
    userAgent: val(args['user-agent'] || process.env.BAIHEPAILEI_SOURCE_USER_AGENT),
    bangumiPages: parseNumber(args['bangumi-pages'], undefined, { min: 1, max: 500 }),
    vndbPages: parseNumber(args['vndb-pages'], undefined, { min: 1, max: 1000 }),
    yurizukanPages: parseNumber(args['yurizukan-pages'], undefined, { min: 1, max: 500 }),
    yurizukanMaxArticles: parseNumber(args['yurizukan-max-articles'], undefined, { min: 1, max: 100_000 }),
    steamPages: parseNumber(args['steam-pages'], undefined, { min: 1, max: 100 }),
    steamMaxApps: parseNumber(args['steam-max-apps'], undefined, { min: 1, max: 100_000 }),
    steamTerms: parseCsv(args['steam-terms'], ['yuri', 'girls love', 'lesbian', 'sapphic', '百合']),
  })
  console.log(JSON.stringify({ ok: true, summary }, null, 2))
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1 })
