import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, root), 'utf8')

const scriptPath =
  'scripts/radar/run-radar-public-metrics-source-schema-apply-once-v01.ps1'
const guidePath =
  'docs/guides/radar-public-metrics-source-schema-apply-once-v01.md'
const rollbackPath =
  'docs/guides/radar-public-metrics-source-schema-rollback-v01.md'
const workflowPath =
  '.github/workflows/validate-radar-public-metrics-source-schema-apply-once-v01.yml'

const script = read(scriptPath)
const guide = read(guidePath)
const rollback = read(rollbackPath)
const workflow = read(workflowPath)

test('executor binds merged main, historical candidate, Release and evidence', () => {
  for (const identity of [
    'b74ca37648688cb8f475acdbf304186ac36753ff',
    'b5ffbe006913218d32b96c131074b7740bf827a0',
    '978a893e6f72bea8bb292c5dff99dfefb957e22e',
    'c2fe7847ee8b60b439f8e92025437937ceff06d5',
    'RADAR-PUBLIC-METRICS-10563-0001',
    '20260803_102741_radar_public_metrics_v01',
    '825294f1a7562dfb2a94ca9d37f7efd79a9300d1af17ae6598db3f3ac02f7d13',
    '35d14fb183a0e8ae34525ad6234a3a0e03ba42f28e6091598eef1ddf369694d0',
    'd1721811438194b4783d0d05dbb9681d5ed8c2cc052145f09fb0747fcc4abe2f',
    '37207203L',
  ]) {
    assert.match(script, new RegExp(identity))
  }

  for (const criticalSha of [
    '15342a0bf050c3c2843c848d28096786e473aed17c01219dd901919cf6df5ec0',
    'ae017019de3b2b138aafe9b5d83a951773e167128d73f4da72722e9a31fa7f08',
    'ee0d9572cc35eaf10973df9e2c5114d84de775c34cd59318b996df2adfa42026',
    'baa0acb0019ce75a242727d4e2eddc20841d594a5846699a0a262c102daa0e31',
  ]) {
    assert.match(script, new RegExp(criticalSha))
  }
})

test('default mode is DryRun and Execute requires new exact authorization', () => {
  assert.match(
    script,
    /\[ValidateSet\('DryRun', 'Execute'\)\][\s\S]*?\$Mode = 'DryRun'/,
  )
  assert.match(script, /DryRun 不接受 AuthorizationPath/)
  assert.match(script, /Execute 必须提供新的 AuthorizationPath/)
  assert.match(
    script,
    /radar-public-metrics-source-schema-authorization-v01/,
  )
  assert.match(script, /productionAuthorization -ne \$true/)
  assert.match(script, /scope -ne 'source-schema-migration-only'/)
  assert.match(script, /metricImportAuthorized -ne \$false/)
  assert.match(script, /historicalApplyOnceRerun -ne \$false/)
  assert.match(
    script,
    /EXECUTE-ONCE-RADAR-PUBLIC-METRICS-SOURCE-SCHEMA-V01::/,
  )
  assert.match(
    script,
    /SOURCE-WRITES-PAUSED-FOR-RADAR-PUBLIC-METRICS-SCHEMA-V01/,
  )
  assert.match(script, /Execute 只允许在 main 上运行/)
  assert.match(script, /local main 与 origin\/main 完全一致/)
})

test('repository delta is limited to the five reviewed package files', () => {
  for (const file of [
    '.github/workflows/validate-radar-public-metrics-source-schema-apply-once-v01.yml',
    'docs/guides/radar-public-metrics-source-schema-apply-once-v01.md',
    'docs/guides/radar-public-metrics-source-schema-rollback-v01.md',
    'scripts/radar/run-radar-public-metrics-source-schema-apply-once-v01.ps1',
    'tests/radar-public-metrics-source-schema-apply-once.test.mjs',
  ]) {
    assert.match(
      script,
      new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
  }

  assert.match(script, /基线之后出现未授权文件变化/)
  assert.match(script, /关键代码 SHA-256 漂移/)
})

test('source PostgreSQL accepts only one unique IPv4-reachable host port', () => {
  assert.match(
    script,
    /\$Bindings\.Count -lt 1 -or \$Bindings\.Count -gt 2/,
  )
  assert.match(script, /\$HostPorts\.Count -ne 1/)
  assert.match(script, /同一个唯一主机端口/)
  assert.match(script, /\$IPv4Bindings\.Count -lt 1/)
  assert.match(script, /127\.0\.0\.1 访问的 IPv4 主机绑定/)
  assert.doesNotMatch(script, /\$Bindings\.Count -ne 1/)
})
test('PostgreSQL advisory lock is held by a dedicated live session', () => {
  assert.match(script, /pg_try_advisory_lock/)
  assert.match(script, /RADAR_SOURCE_SCHEMA_LOCK_ACQUIRED/)
  assert.match(script, /pg_sleep\(7200\)/)
  assert.match(script, /pg_locks AS l/)
  assert.match(script, /pg_stat_activity AS a/)
  assert.match(script, /pg_terminate_backend/)
  assert.match(script, /PostgreSQL advisory lock: acquired/)
})

test('advisory lock identity is length-bounded and PID-bound', () => {
  assert.match(script, /radar-metrics-schema-lock-\$RunId/)
  assert.match(
    script,
    /ASCII\.GetByteCount\(\$ApplicationName\)[\s\S]*\$ApplicationNameBytes -gt 63/,
  )
  assert.match(
    script,
    /RADAR_SOURCE_SCHEMA_LOCK_ACQUIRED\|:radar_lock_backend_pid\|:radar_lock_application_name/,
  )
  assert.match(script, /current_setting\('application_name'\)/)
  assert.match(script, /\$BackendPid = \[int\]/)
  assert.match(script, /l\.objsubid = 2/)
  assert.match(script, /l\.pid = \$BackendPid/)
  assert.match(script, /backendPid = \$BackendPid/)
  assert.match(script, /pid = \$\(\$Lock\.backendPid\)/)
  assert.match(script, /pid <> \$\(\$Lock\.backendPid\)/)
  assert.doesNotMatch(
    script,
    /radar-public-metrics-source-schema-apply-once-v01-\$RunId/,
  )
})
test('pre-state is exact and any prior application is a hard refusal', () => {
  assert.match(script, /\$ExpectedWorks = 35615/)
  assert.match(script, /\$ExpectedPublicRecords = 10563/)
  assert.match(script, /\$ExpectedPublicRatings = 10563/)
  assert.match(script, /\$ExpectedCurrentColumns = 36/)
  assert.match(script, /\$ExpectedMigratedColumns = 44/)
  assert.match(script, /\$ExpectedSourceMigrationCount = 9/)
  assert.match(script, /\$ExpectedMigratedMigrationCount = 10/)

  for (const column of [
    'confidence_percent',
    'evidence_coverage_percent',
    'metrics_policy_version',
    'source_metrics_policy_version',
    'relationship_evidence_state',
    'metrics_source_release_id',
    'metrics_calculation_basis_sha256',
    'requires_metric_review',
  ]) {
    assert.match(script, new RegExp(column))
  }

  assert.match(script, /已存在指标列，拒绝重复运行/)
  assert.match(script, /已存在指标 enum，拒绝重复运行/)
  assert.match(script, /已存在指标 index，拒绝重复运行/)
  assert.match(script, /已登记目标 migration，Never rerun/)
  assert.match(script, /检测到历史成功执行回执，Never rerun/)
})

test('the same migration command is shared by rehearsal and source execution', () => {
  assert.equal(
    (script.match(/pnpm exec payload migrate/g) || []).length,
    1,
  )
  assert.match(script, /Invoke-PayloadMigration[\s\S]*-Target temporary/)
  assert.match(script, /Invoke-PayloadMigration[\s\S]*-Target source/)
  assert.match(script, /PAYLOAD_DB_PUSH = 'false'/)
  assert.match(script, /RADAR_PUBLIC_RATINGS_SCHEMA_READY = 'true'/)
  assert.match(script, /DATABASE_URL 不是 loopback/)
})

test('a disposable loopback restore must pass before source execution', () => {
  assert.match(script, /POSTGRES_HOST_AUTH_METHOD=trust/)
  assert.match(script, /127\.0\.0\.1:\$\{TempPort\}:5432/)
  assert.match(script, /pg_restore/)
  assert.match(script, /temporary-before-migration/)
  assert.match(script, /temporary-after-migration/)
  assert.match(script, /docker rm -f -v \$TempContainer/)
  assert.match(script, /Temporary rehearsal: 36 -> 44 \/ 9 -> 10/)
})

test('existing data fingerprints and empty metric fields are postconditions', () => {
  for (const fingerprint of [
    'b607ac0e33d44ac384dc4a2cc97413ee',
    'ccd652d4790bbeb34279181cd62939be',
    '07632be7da96bb48129f207d3044c85e',
  ]) {
    assert.match(script, new RegExp(fingerprint))
  }

  assert.match(script, /radar_public_ratings_existing_fields/)
  assert.match(script, /nonEmptyMetricRows/)
  assert.match(script, /requiresMetricReviewTrue/)
  assert.match(script, /requiresMetricReviewNull/)
  assert.match(script, /指标字段不是全空\/默认 false/)
  assert.match(script, /Existing data\s+: UNCHANGED/)
  assert.match(script, /Metric content\s+: EMPTY/)
})

test('Execute creates a new immediate backup and emits an auditable receipt', () => {
  assert.match(script, /source-immediately-before-radar-public-metrics-schema/)
  assert.match(script, /pg_dump/)
  assert.match(script, /applyTimeBackup/)
  assert.match(script, /source-schema-execution-receipt\.json/)
  assert.match(script, /source-schema-failure\.json/)
  assert.match(script, /rollbackRequired = \$Executed/)
})

test('executor contains no metric import or content-write implementation', () => {
  assert.doesNotMatch(
    script,
    /payload\.(create|update|delete)/,
  )
  assert.doesNotMatch(
    script,
    /\b(INSERT\s+INTO|UPDATE\s+radar_public_ratings|DELETE\s+FROM\s+radar_public_ratings)\b/i,
  )
  assert.doesNotMatch(
    script,
    /run-unified-rating-incremental-production-apply-once|execute-radar-unified-release-production/,
  )
  assert.match(script, /metricImportExecuted = \$false/)
  assert.match(script, /payloadContentWrite = \$false/)
})

test('runbook does not expose Execute as an ordinary development command', () => {
  for (const phrase of [
    '36 -> 44',
    '9 -> 10',
    'Never rerun',
    'Source migration : false',
    'Metric import    : false',
    'productionAuthorization',
    'source-schema-migration-only',
    'The Execute command is deliberately omitted',
  ]) {
    assert.match(
      guide,
      new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
  }

  assert.match(guide, /Merging the PR still does not authorize execution/)
})

test('rollback requires the apply-time backup and rejects improvised down migration', () => {
  assert.match(rollback, /apply-time backup/i)
  assert.match(rollback, /Do not run the migration's `down\(\)` function/)
  assert.match(rollback, /side-by-side restore/i)
  assert.match(rollback, /forensic dump/i)
  assert.match(rollback, /Never overwrite or delete/)
  assert.match(rollback, /Do not rerun/)
})

test('CI parses PowerShell, runs dedicated tests, and enforces negative boundaries', () => {
  assert.match(workflow, /Parser\]::ParseFile/)
  assert.match(
    workflow,
    /node --test[\s\S]*radar-public-metrics-source-schema-apply-once\.test\.mjs/,
  )
  assert.match(workflow, /pnpm exec payload migrate/)
  assert.match(workflow, /pg_try_advisory_lock/)
  assert.match(
    workflow,
    /grep -q 'pg_terminate_backend' "\$script"\r?\n\s+grep -q 'ASCII\.GetByteCount\(\$ApplicationName\)' "\$script"/,
  )
  assert.doesNotMatch(
    workflow,
    /grep -q 'pg_terminate_backend' "\$script"[ \t]+grep -q/,
  )
  assert.match(
    guide,
    /any source migration;\r?\n- the lock session uses a server-safe/,
  )
  assert.doesNotMatch(
    guide,
    /any source migration;- the lock session/,
  )
  assert.match(workflow, /git diff --check/)
})
