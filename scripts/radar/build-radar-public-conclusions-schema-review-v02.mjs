#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(root, 'build-radar-public-conclusions-schema-review-v01.mjs')
if (!fs.existsSync(source)) throw new Error(`Missing v01 builder: ${source}`)

let content = fs.readFileSync(source, 'utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')

function replaceExact(needle, replacement, expected = 1) {
  const count = content.split(needle).length - 1
  if (count !== expected) throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${needle}`)
  content = content.split(needle).join(replacement)
}

replaceExact(
  `      productionDatabaseConnect: false,\n      productionDatabaseWrite: false,`,
  `      productionDatabaseConnect: true,\n      productionDatabaseReadOnly: true,\n      productionDatabaseWrite: false,`,
)
replaceExact(
  `  console.log('ProductionDatabaseConnect: False')\n  console.log('ProductionDatabaseWrite: False')`,
  `  console.log('ProductionDatabaseConnect: True (migration:create read-only introspection)')\n  console.log('ProductionDatabaseWrite: False')`,
)

const temporary = path.join(root, `.build-radar-public-conclusions-schema-review-v02-${crypto.randomUUID()}.mjs`)
fs.writeFileSync(temporary, content, 'utf8')
try {
  const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Patched schema review builder syntax check failed.')
  const result = spawnSync(process.execPath, [temporary, ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.status !== 0) process.exitCode = result.status || 1
} finally {
  fs.rmSync(temporary, { force: true })
}
