#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)

const result = spawnSync(process.execPath, ['scripts/import/demo-fixtures.mjs', ...args], {
  encoding: 'utf8',
})

const stdout = result.stdout || ''
const stderr = result.stderr || ''

if (stdout) process.stdout.write(stdout)
if (stderr) process.stderr.write(stderr)

const output = `${stdout}\n${stderr}`

if (result.status !== 0) {
  process.exit(result.status || 1)
}

if (/^\s*error:/im.test(output)) {
  console.error('Demo import reported item-level errors. Fix the errors above before exporting indexes.')
  process.exit(1)
}

const fileArgIndex = args.indexOf('--file')
const fixtureFile = fileArgIndex >= 0 ? args[fileArgIndex + 1] : ''
const urlArgIndex = args.indexOf('--url')
const baseUrl = (urlArgIndex >= 0 ? args[urlArgIndex + 1] : 'http://localhost:3000').replace(/\/$/, '')

if (fixtureFile.includes('demo-linked-content.json')) {
  console.log('\nLinked demo pages to inspect after export:')
  console.log(`${baseUrl}/works/demo-linked-work-cross-project`)
  console.log(`${baseUrl}/creators/demo-linked-creator-a`)
  console.log(`${baseUrl}/organizations/demo-linked-org-platform`)
  console.log(`${baseUrl}/evidence/demo-linked-evidence-cross`)
}
