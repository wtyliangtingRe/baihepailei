#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const forwarded = process.argv.slice(2)
const args = [...forwarded]

if (!args.includes('--profile')) args.push('--profile', 'full')
if (!args.includes('--media-mode')) args.push('--media-mode', 'enhanced')
if (!args.includes('--published-only') && !args.includes('--include-drafts')) args.push('--include-drafts')

function run(script) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Full public index step failed: ${script}`)
}

console.log('[export] Building the complete, enhanced public edition')
run('scripts/export/build-and-enrich-lite-search-index.mjs')
run('scripts/export/build-and-enrich-lite-detail-index.mjs')
run('scripts/export/enrich-public-work-status.mjs')
console.log('[export] Complete public search and detail indexes are ready')
