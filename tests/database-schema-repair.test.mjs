import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync('scripts/db/normalize-legacy-work-version-status.ps1', 'utf8')

test('legacy work version repair is dry-run by default and confirmation-gated', () => {
  assert.match(source, /NORMALIZE-LEGACY-WORK-VERSION-STATUS/u)
  assert.match(source, /if \(-not \$Apply\)/u)
  assert.match(source, /UPDATE "_works_v"/u)
  assert.match(source, /WHERE version_status = 'archived'/u)
  assert.match(source, /SET version_status = 'draft'/u)
  assert.match(source, /checkpointRequiredBeforeApply = \$true/u)
})
