#!/usr/bin/env node
import { run } from './run-unified-release-lab-import-lib-0575-v01.mjs'

run().then((receipt) => {
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
}).catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
