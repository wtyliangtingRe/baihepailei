#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const rawArgs = process.argv.slice(2)
const publishedOnly = rawArgs.includes('--published-only')
const args = rawArgs.filter((arg) => arg !== '--published-only')
if (!publishedOnly && !args.includes('--include-drafts')) args.push('--include-drafts')

function argValue(name, fallback) {
  const index = args.indexOf(name)
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) return fallback
  return args[index + 1]
}

const outputFile = path.resolve(argValue('--out', 'public/search-index.json'))
const previous = fs.existsSync(outputFile) ? fs.readFileSync(outputFile) : null

function run(commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Export step failed: node ${commandArgs.join(' ')}`)
}

try {
  console.log(`[export] Search index mode: ${publishedOnly ? 'published-only' : 'drafts-and-published'}; visibility profile defaults to full`)
  run(['scripts/export/build-lite-search-index.mjs', ...args])
  run(['scripts/export/enrich-public-radar-conclusions.mjs', '--file', outputFile, ...args])
  run(['scripts/export/compact-public-index.mjs', '--file', outputFile, ...args])
} catch (error) {
  if (previous) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    fs.writeFileSync(outputFile, previous)
    console.error(`[export] Restored previous index after failure: ${outputFile}`)
  } else if (fs.existsSync(outputFile)) fs.rmSync(outputFile, { force: true })
  console.error(error)
  process.exit(1)
}
