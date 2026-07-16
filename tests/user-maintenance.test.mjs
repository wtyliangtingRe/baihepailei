import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const script = fs.readFileSync(new URL('../scripts/users/prune-users-except-email.mjs', import.meta.url), 'utf8')

test('user cleanup is dry-run by default and requires an exact keep identity', () => {
  assert.match(script, /Required: --keep-email/u)
  assert.match(script, /const apply = Boolean\(args\.apply\)/u)
  assert.match(script, /DELETE-USERS-EXCEPT-KEEP-EMAIL/u)
  assert.match(script, /keep_user_is_not_owner/u)
  assert.match(script, /loginEmail !== keepEmail/u)
  assert.match(script, /verifyMaintenanceIdentity/u)
  assert.match(script, /Authorization: `Bearer \$\{token\}`/u)
  assert.match(script, /DisableAutologin: 'true'/u)
  assert.match(script, /Authenticated account has role/u)
})

test('user cleanup handles dependent community rows before deleting accounts', () => {
  assert.match(script, /deleteUserListIDs/u)
  assert.match(script, /deleteCommentIDs/u)
  assert.match(script, /deleteSubmittedFeedbackIDs/u)
  assert.match(script, /clearReviewerFeedbackIDs/u)
  assert.match(script, /clearReviewedWorkIDs/u)
  assert.match(script, /directPostgresqlWrite: false/u)
})
