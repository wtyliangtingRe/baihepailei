import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const source = fs.readFileSync(
  new URL('../scripts/radar/audit-unified-rating-incremental-rehearsal-evidence-9988-v01.ps1', import.meta.url),
  'utf8',
)

test('evidence audit is offline and read-only', () => {
  assert.doesNotMatch(source, /Invoke-WebRequest|Invoke-RestMethod|\bfetch\s*\(/)
  assert.doesNotMatch(source, /\bdocker\b|\bpsql\b|\bpg_dump\b|\bpg_restore\b/)
  assert.doesNotMatch(source, /method\s*=\s*['"](?:POST|PATCH|PUT|DELETE)/i)
  assert.doesNotMatch(source, /Remove-Item[^\n]*(?:\.dump|FreshBackup)/i)
  assert.match(source, /productionAuthorization = \$false/)
  assert.match(source, /sourceDatabaseWrite = \$false/)
})

test('audit checks closed-world archive integrity and secret exclusion', () => {
  assert.match(source, /manifest 闭世界文件集合不匹配/)
  assert.match(source, /SHA256SUMS 闭世界文件集合不匹配/)
  assert.match(source, /ZIP 文件名重复/)
  assert.match(source, /ZIP 包含符号链接/)
  assert.match(source, /嵌套归档或数据库备份/)
  assert.match(source, /PRIVATE KEY/)
  assert.match(source, /postgres\(\?:ql\)\?/)
  assert.match(source, /credentialsIncluded = \$false/)
  assert.match(source, /databaseBackupIncluded = \$false/)
})

test('audit binds exact rehearsal identities and create-only result', () => {
  assert.match(source, /c8790df95d1235d8d1aacabfb7c119fec9e1c642/)
  assert.match(source, /RADAR-UNIFIED-RATING-INCREMENTAL-RELEASE-9988-0001/)
  assert.match(source, /radar_incremental_rehearsal/)
  assert.match(source, /ExpectedLedgerRows = 19976/)
  assert.match(source, /ExpectedRecordCreates = 9988/)
  assert.match(source, /ExpectedRatingCreates = 9988/)
  assert.match(source, /Apply receipt 未绑定临时数据库/)
  assert.match(source, /Apply importer 未进入受控写模式/)
  assert.match(source, /Acceptance 生产边界不正确/)
  assert.match(source, /Temporary post count delta 不匹配/)
  assert.match(source, /Protected fingerprints/)
})

test('audit verifies ledger, plans and HTTP request surface', () => {
  assert.match(source, /temporary-apply-import\\create-ledger\.jsonl/)
  assert.match(source, /Record\/Rating ledger identity 不一致/)
  assert.match(source, /Pre-plan \/ ledger identity 不一致/)
  assert.match(source, /Post-plan \/ ledger identity 不一致/)
  assert.match(source, /PATCH\/PUT\/DELETE/)
  assert.match(source, /Apply HTTP Record POST 数量不匹配/)
  assert.match(source, /Apply HTTP Rating POST 数量不匹配/)
  assert.match(source, /accept_independent_incremental_rehearsal_evidence_9988_v01/)
})
