#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(root, 'build-all-remaining-radar-global-audit-v01.mjs')
if (!fs.existsSync(source)) throw new Error(`Missing v01 source: ${source}`)

let content = fs.readFileSync(source, 'utf8')
  .replace(/^\uFEFF/u, '')
  .replace(/\r\n?/gu, '\n')

function replaceExact(needle, replacement, expected = 1) {
  const count = content.split(needle).length - 1
  if (count !== expected) throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${needle.slice(0, 120)}`)
  content = content.split(needle).join(replacement)
}

replaceExact(
  `  const indexes = buildWorkIndexes(works)\n  const sourcePackageSha256 = val(sourceSummary.packageManifestSha256) || sha256File(sourceFile)`,
  `  const indexes = buildWorkIndexes(works)\n  const workById = new Map(works.map((work) => [val(work.id), work]))\n  const sourcePackageSha256 = val(sourceSummary.packageManifestSha256) || sha256File(sourceFile)`,
)

replaceExact(
  `    const targetWork = privatePlan?.target?.id\n      ? works.find((work) => val(work.id) === val(privatePlan.target.id))\n      : null`,
  `    const targetWork = privatePlan?.target?.id\n      ? workById.get(val(privatePlan.target.id)) || null\n      : null`,
)

const temporary = path.join(os.tmpdir(), `build-all-remaining-radar-global-audit-v02-${crypto.randomUUID()}.mjs`)
fs.writeFileSync(temporary, content, 'utf8')
try {
  const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' })
  if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Patched global audit syntax check failed.')
  const result = spawnSync(process.execPath, [temporary, ...process.argv.slice(2)], { stdio: 'inherit' })
  if (result.status !== 0) process.exitCode = result.status || 1
} finally {
  fs.rmSync(temporary, { force: true })
}
