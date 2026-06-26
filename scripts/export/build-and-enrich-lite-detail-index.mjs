#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

function run(commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

run(['scripts/export/build-lite-detail-index.mjs', ...args])
run(['scripts/export/enrich-lite-detail-index.mjs', ...args])
