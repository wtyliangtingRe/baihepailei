#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const v01 = path.join(root, 'build-radar-public-conclusions-lab-sql-v01.mjs')
if (!fs.existsSync(v01)) throw new Error(`Missing v01 builder: ${v01}`)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const outDir = path.resolve(String(args['out-dir'] || ''))
if (!String(args['out-dir'] || '').trim()) throw new Error('Required: --out-dir')

const result = spawnSync(process.execPath, [v01, ...process.argv.slice(2)], {
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'pipe'],
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.status !== 0) process.exit(result.status || 1)

const applyPath = path.join(outDir, 'radar-public-lab-apply.sql.lab-only')
const summaryPath = path.join(outDir, 'radar-public-lab-plan-summary.json')
if (!fs.existsSync(applyPath) || !fs.existsSync(summaryPath)) {
  throw new Error('v01 builder did not produce the required lab files.')
}

let apply = fs.readFileSync(applyPath, 'utf8')
const incorrect = 'SELECT count(*) INTO mismatch_count FROM ('
const corrected = 'SELECT q.mismatch_count INTO mismatch_count FROM ('
const count = apply.split(incorrect).length - 1
if (count !== 1) throw new Error(`Expected one main mismatch assignment, received ${count}.`)
apply = apply.replace(incorrect, corrected)
if (!apply.includes('SELECT count(*)\nFROM input i')) {
  throw new Error('Main mismatch subquery no longer has a named aggregate result.')
}
if (!apply.includes('SELECT q.mismatch_count INTO mismatch_count FROM (')) {
  throw new Error('Main mismatch assignment correction was not written.')
}
fs.writeFileSync(applyPath, apply, 'utf8')

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8').replace(/^\uFEFF/u, ''))
summary.schemaVersion = 2
summary.builderVersion = 'radar-public-conclusions-lab-sql-v0.2'
summary.mainFieldMismatchCheckCorrected = true
summary.runtimeSourcePatching = false
summary.generatedSqlNormalization = true
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

console.log('Radar public conclusions lab SQL v02 validated')
console.log('MainFieldMismatchCheckCorrected: True')
