#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

import { run } from './run-unified-release-lab-import-lib-0575-v01.mjs'

export {
  assertIsolatedLabUrl,
  assertPlanForMode,
  run,
} from './run-unified-release-lab-import-lib-0575-v01.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((receipt) => {
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  }).catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
