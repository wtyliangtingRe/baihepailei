#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rawArgs = process.argv.slice(2)
const skipEvidence = rawArgs.includes('--skip-evidence')
const args = rawArgs.filter((arg) => arg !== '--skip-evidence')

function argValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ''
}

function replaceArgValue(argv, name, value) {
  const copy = [...argv]
  const index = copy.indexOf(name)
  if (index >= 0) copy[index + 1] = value
  else copy.push(name, value)
  return copy
}

function fixtureWithoutEvidence(filePath) {
  const source = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'))
  source.evidence = []
  const tempFile = path.join(os.tmpdir(), `demo-fixture-no-evidence-${Date.now()}.json`)
  fs.writeFileSync(tempFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8')
  return tempFile
}

const fixtureFile = argValue('--file')
const effectiveArgs = skipEvidence && fixtureFile ? replaceArgValue(args, '--file', fixtureWithoutEvidence(fixtureFile)) : args

if (skipEvidence) {
  console.log('Demo import: skipping evidence items for this run.')
}

const result = spawnSync(process.execPath, ['scripts/import/demo-fixtures.mjs', ...effectiveArgs], {
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

const urlArgIndex = args.indexOf('--url')
const baseUrl = (urlArgIndex >= 0 ? args[urlArgIndex + 1] : 'http://localhost:3000').replace(/\/$/, '')

if (fixtureFile.includes('demo-linked-content.json')) {
  console.log('\nLinked demo pages to inspect after export:')
  console.log(`${baseUrl}/works/demo-linked-work-cross-project`)
  console.log(`${baseUrl}/creators/demo-linked-creator-a`)
  console.log(`${baseUrl}/organizations/demo-linked-org-platform`)
  if (!skipEvidence) console.log(`${baseUrl}/evidence/demo-linked-evidence-cross`)
}
