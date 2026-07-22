#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const sourceFile = path.join(scriptDir, 'run-ai-radar-full-coverage-publication-v01.mjs')

function replaceExactly(source, needle, replacement, label) {
  const occurrences = source.split(needle).length - 1
  if (occurrences !== 1) {
    throw new Error(`${label} replacement count was ${occurrences}, expected 1`)
  }
  return source.replace(needle, replacement)
}

function replaceRegexExactly(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))]
  if (matches.length !== 1) {
    throw new Error(`${label} replacement count was ${matches.length}, expected 1`)
  }
  return source.replace(pattern, replacement)
}

export function buildDirectOverwriteSource(source) {
  let patched = source

  patched = replaceExactly(
    patched,
    "const VERSION = 'ai-radar-full-coverage-publication-v0.1'",
    "const VERSION = 'ai-radar-full-coverage-direct-overwrite-v0.2'",
    'version',
  )
  patched = replaceExactly(
    patched,
    "const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/full-coverage-publication-v01'",
    "const DEFAULT_OUT_ROOT = 'data_local/staging/ai-radar/full-coverage-direct-overwrite-v02'",
    'out root',
  )

  patched = replaceExactly(
    patched,
    `  const sameUnrelated = Boolean(patch && published && latestDraft && equal(unrelatedPublishedState(published, patch), unrelatedPublishedState(latestDraft, patch)))
  let strategy = 'blocked'
  if (!blockers.length && alreadyPublished) strategy = 'already_published'
  else if (!blockers.length && sameUnrelated) strategy = 'direct_field_publish'
  else if (!blockers.length) strategy = 'version_roundtrip'`,
    `  let strategy = 'blocked'
  if (!blockers.length && alreadyPublished) strategy = 'already_published'
  else if (!blockers.length) strategy = 'direct_field_publish_latest_ai_overwrite'
  if (!blockers.length && !alreadyPublished) warnings.push('latest_ai_overwrites_older_draft_ai')`,
    'plan strategy',
  )

  patched = replaceRegexExactly(
    patched,
    /async function executeDirect\(\{ baseUrl, token, row, publishedBefore \}\) \{[\s\S]*?\n\}/u,
    `async function executeDirect({ baseUrl, token, row, publishedBefore }) {
  const humanBefore = sha256(selectedHumanState(publishedBefore))
  const unrelatedBefore = sha256(unrelatedPublishedState(publishedBefore, row.patch))
  let writes = 0
  try {
    await publishPatch(baseUrl, token, row.targetId, row.patch)
    writes = 1
    const publishedAfter = await readWork(baseUrl, token, row.targetId)
    const blockers = []
    if (!patchMatches(publishedAfter, row.patch)) blockers.push('direct_patch_not_present')
    if (sha256(selectedHumanState(publishedAfter)) !== humanBefore) blockers.push('direct_human_state_changed')
    if (sha256(unrelatedPublishedState(publishedAfter, row.patch)) !== unrelatedBefore) blockers.push('direct_unrelated_state_changed')
    if (blockers.length) throw new Error(blockers.join(', '))
    return { writes, strategy: 'direct_field_publish_latest_ai_overwrite' }
  } catch (error) {
    const wrapped = new Error(\`Direct AI overwrite failed after \${writes} Work write request(s): \${error?.message || error}\`)
    wrapped.writeRequests = writes
    throw wrapped
  }
}`,
    'direct executor',
  )

  patched = replaceRegexExactly(
    patched,
    /async function executeRoundtrip\(\{ baseUrl, token, row, publishedBefore, draftBefore \}\) \{[\s\S]*?\n\}\nfunction collectionsCounter/u,
    'function collectionsCounter',
    'roundtrip executor removal',
  )

  patched = replaceExactly(
    patched,
    `        const safeDirect = equal(unrelatedPublishedState(publishedBefore, row.patch), unrelatedPublishedState(draftBefore, row.patch))
        event.workPublication = safeDirect ? await executeDirect({ baseUrl, token, row, publishedBefore }) : await executeRoundtrip({ baseUrl, token, row, publishedBefore, draftBefore })`,
    `        event.workPublication = await executeDirect({ baseUrl, token, row, publishedBefore })`,
    'execution dispatch',
  )

  patched = replaceExactly(
    patched,
    `      event.status = 'execution_failed'; event.error = error?.stack || String(error); event.writeRequestsBeforeFailure = Number(error?.writeRequests || 0); appendJsonl(ledgerFile, event); counters.increment('execution_failed'); if (event.writeRequestsBeforeFailure > 0) throw error`,
    `      event.status = 'execution_failed'; event.error = error?.stack || String(error); event.writeRequestsBeforeFailure = Number(error?.writeRequests || 0); appendJsonl(ledgerFile, event); counters.increment('execution_failed'); throw error`,
    'stop on first execution failure',
  )

  patched = replaceExactly(
    patched,
    'versionRoundtripUsedWhenDraftUnrelatedFieldsDiffer: true',
    'versionRoundtripUsedWhenDraftUnrelatedFieldsDiffer: false, latestAiOverwritesOlderDraftAi: true',
    'final safety summary',
  )

  const forbidden = [
    'executeRoundtrip(',
    'await restoreVersion(',
    "strategy = 'version_roundtrip'",
    'safeDirect ?',
  ]
  for (const token of forbidden) {
    if (patched.includes(token)) {
      throw new Error(`Direct overwrite source still contains forbidden token: ${token}`)
    }
  }
  if (!patched.includes("strategy: 'direct_field_publish_latest_ai_overwrite'")) {
    throw new Error('Direct overwrite source is missing the direct strategy marker')
  }
  if (!patched.includes("warnings.push('latest_ai_overwrites_older_draft_ai')")) {
    throw new Error('Direct overwrite source is missing the overwrite warning marker')
  }

  return patched
}

export function runDirectOverwrite(args = process.argv.slice(2)) {
  const source = fs.readFileSync(sourceFile, 'utf8')
  const patched = buildDirectOverwriteSource(source)
  const tempFile = path.join(scriptDir, `.run-ai-radar-full-coverage-direct-overwrite-${process.pid}-${Date.now()}.mjs`)
  fs.writeFileSync(tempFile, patched, 'utf8')
  try {
    const result = spawnSync(process.execPath, [tempFile, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Direct overwrite runner exited with code ${result.status}`)
    }
  } finally {
    if (fs.existsSync(tempFile)) fs.rmSync(tempFile, { force: true })
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    runDirectOverwrite()
  } catch (error) {
    console.error(error?.stack || error)
    process.exitCode = 1
  }
}
