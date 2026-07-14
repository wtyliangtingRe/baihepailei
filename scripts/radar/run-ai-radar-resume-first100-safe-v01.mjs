#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const OUTPUT_ROOT = 'data_local/staging/ai-radar/payload-apply-resume-runs-v01'
const RESUME_SCRIPT = 'scripts/radar/resume-ai-radar-first100-v01.mjs'

fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
const result = spawnSync(process.execPath, [path.resolve(RESUME_SCRIPT), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  shell: false,
})
if (result.error) throw result.error
process.exitCode = Number.isInteger(result.status) ? result.status : 1
