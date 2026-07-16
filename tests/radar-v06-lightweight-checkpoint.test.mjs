#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const dbOnly = fs.readFileSync(
  'scripts/backup/create-database-only-checkpoint.ps1',
  'utf8',
)
const apply = fs.readFileSync(
  'scripts/radar/lib/payload-apply-v01.mjs',
  'utf8',
)
const orchestrator = fs.readFileSync(
  'scripts/radar/run-ai-radar-v06-remaining-batches-v01.mjs',
  'utf8',
)
const migration = fs.readFileSync(
  'scripts/radar/migrate-ai-radar-v06-orchestrator-state-v02.mjs',
  'utf8',
)

test('database-only checkpoint avoids workspace duplication', () => {
  assert.match(dbOnly, /checkpointProfile = "database_only"/u)
  assert.match(dbOnly, /includesWorkspace = \$false/u)
  assert.match(dbOnly, /includesGitBundle = \$false/u)
  assert.doesNotMatch(dbOnly, /robocopy/iu)
  assert.doesNotMatch(dbOnly, /create-local-checkpoint/iu)
})

test('checkpoint validator explicitly supports database-only profile', () => {
  assert.match(
    apply,
    /checkpointProfile === 'database_only'/u,
  )
  assert.match(
    apply,
    /checkpoint_database_only_workspace_flag_invalid/u,
  )
  assert.match(
    apply,
    /checkpoint_database_only_git_bundle_flag_invalid/u,
  )
})

test('remaining-batch orchestrator uses lightweight checkpoint', () => {
  assert.match(
    orchestrator,
    /ai-radar-v06-remaining-batches-orchestrator-v0\.2/u,
  )
  assert.match(
    orchestrator,
    /create-database-only-checkpoint\.ps1/u,
  )
  assert.match(
    orchestrator,
    /New checkpoint is not database-only/u,
  )
  assert.doesNotMatch(
    orchestrator,
    /'scripts\/backup\/create-database-checkpoint\.ps1'/u,
  )
})

test('state migration is narrow and preserves completed progress', () => {
  assert.match(migration, /EXPECTED_LAST_COMPLETED = 16/u)
  assert.match(migration, /RADAR-ASSESS-0017/u)
  assert.match(migration, /before-lightweight-v02/u)
  assert.match(migration, /delete state\.batches\['RADAR-ASSESS-0017'\]/u)
})
