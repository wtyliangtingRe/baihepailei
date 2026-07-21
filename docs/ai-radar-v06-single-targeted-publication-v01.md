# AI Radar v0.6 单条定向发布 v0.1

## 目的

历史 v0.6 结果中有 9,361 条只存在于 latest draft。批量发布前，必须先用一条真实 Work 验证：

1. `_status: "published"` 与显式 `draft=false` 能更新 published/main；
2. 只发送 Radar 白名单字段，不发布整份历史草稿；
3. `humanAssessment` 与人工兼容字段不会被意外改写；
4. 写后 published 和 latest draft 两个视图都能精确回读；
5. 全程最多只发出一个 PATCH。

## 三阶段门控

```text
prepare candidate（只读）
→ arm local gate（只写本地短时授权文件）
→ execute once（最多一个 PATCH）
```

禁止跳过 checkpoint、restore-list 验证、候选准备或本地授权门。

## 先运行代码检查

```powershell
node --check scripts/radar/prepare-ai-radar-v06-single-targeted-publication-v01.mjs
node --check scripts/radar/arm-ai-radar-v06-single-targeted-publication-v01.mjs
node --check scripts/radar/run-ai-radar-v06-single-targeted-publication-once-v01.mjs
node --test tests/ai-radar-v06-single-targeted-publication.test.mjs
```

这些检查不会读取或写入 Payload。

## 正式执行前：创建新数据库 checkpoint

必须在准备候选时所在的同一 Git 分支和提交上创建 checkpoint：

```powershell
pnpm backup:checkpoint:database
```

取得刚创建的目录：

```powershell
$Checkpoint = Get-ChildItem "D:\Baihepailei-backups" `
  -Directory `
  -Filter "Baihepailei-*" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

$Checkpoint
```

验证 dump 可被 `pg_restore --list` 读取：

```powershell
$RestoreVerificationDir = `
  "data_local\staging\ai-radar\v06-single-targeted-publication-checkpoint-v01"

pnpm backup:verify-database-checkpoint -- `
  -CheckpointPath "$Checkpoint" `
  -OutputDir "$RestoreVerificationDir"

$RestoreVerification = Join-Path `
  $RestoreVerificationDir `
  "database-restore-verification-v01.json"
```

这一步只验证归档列表，不执行恢复。

## 准备单条候选

默认从最新 `ready-for-targeted-publication.jsonl` 中按 Work ID 稳定选择第一条：

```powershell
node scripts/radar/prepare-ai-radar-v06-single-targeted-publication-v01.mjs `
  --checkpoint "$Checkpoint" `
  --restore-verification "$RestoreVerification"
```

也可以指定 Work ID、Payload ID 或 siteId：

```powershell
node scripts/radar/prepare-ai-radar-v06-single-targeted-publication-v01.mjs `
  --checkpoint "$Checkpoint" `
  --restore-verification "$RestoreVerification" `
  --work-id "<work-id>"
```

准备阶段：

- 不登录 Payload；
- 不发出 PATCH；
- 只在 `data_local` 写入候选、摘要和 disarmed gate；
- 输出候选标题、等级、变更字段与精确执行确认字符串。

找到最新候选：

```powershell
$CandidateManifest = Get-ChildItem `
  "data_local\staging\ai-radar\v06-single-targeted-publication-v01\*\candidate-manifest.json" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName

$Candidate = Get-Content $CandidateManifest -Raw | ConvertFrom-Json
$Candidate.target
$Candidate.expected.patch
$Candidate.expected.changedFields
```

## 派生一次性审批 Token

Token 不写入仓库，也不由脚本打印。它根据候选绑定的 dry-run SHA-256 和目标 ID 派生：

```powershell
$DryRunHash = ([string]$Candidate.files.dryRun.sha256).ToUpperInvariant()
$ApprovalToken = `
  "APPLY-RADAR-V06-SINGLE-$($Candidate.target.id)-$($DryRunHash.Substring(0, 16))"
```

不要把 `$ApprovalToken`、管理员密码或 `.env` 内容发到聊天中。

## Arm 本地短时门

```powershell
node scripts/radar/arm-ai-radar-v06-single-targeted-publication-v01.mjs `
  --candidate-manifest "$CandidateManifest" `
  --checkpoint "$Checkpoint" `
  --approval-token "$ApprovalToken" `
  --confirmation "ARM-AI-RADAR-V06-SINGLE-TARGETED-PUBLICATION" `
  --ttl-minutes 30
```

Arm 阶段仍不会读取或写入 Payload。授权文件只保存 Token 指纹，默认 30 分钟后失效。

```powershell
$Gate = Join-Path `
  (Split-Path $CandidateManifest -Parent) `
  "local-gate-armed.json"
```

## Execute once

执行前再次查看目标和精确确认：

```powershell
$Candidate.target
$Candidate.executeConfirmationRequired
```

执行命令：

```powershell
node --env-file=.env `
  scripts/radar/run-ai-radar-v06-single-targeted-publication-once-v01.mjs `
  --candidate-manifest "$CandidateManifest" `
  --checkpoint "$Checkpoint" `
  --gate "$Gate" `
  --approval-token "$ApprovalToken" `
  --execute-confirmation "$($Candidate.executeConfirmationRequired)" `
  --execute `
  --url "http://127.0.0.1:3000"
```

执行器会在写入前重新检查：

- Git 分支和提交；
- checkpoint 完整性、年龄与 restore-list 验证；
- 候选、dry-run、补丁和授权门哈希；
- published 主记录状态；
- latest draft Radar；
- 人工轨道状态；
- changedFields；
- PATCH 白名单；
- 授权门有效期和精确确认字符串。

只有全部通过才会发送：

```text
PATCH /api/works/<id>?draft=false&depth=0
```

请求体只包含候选中的白名单部分补丁，并明确包含 `_status: "published"`。

## 写后验证

执行后必须同时满足：

- published/main 中所有补丁字段精确一致；
- published 状态哈希等于 dry-run 的模拟结果；
- latest draft Radar 等于目标 Radar；
- 人工轨道哈希保持不变；
- Payload PATCH 请求数恰好为 1。

成功状态：

```text
applied_and_verified
```

若 PATCH 返回但验证失败：

```text
patch_returned_but_verification_failed
```

脚本会立即停止，生成 `rollback-plan.json`，但不会自动回滚，也绝不继续处理第二条。

## 安全边界

- 不发布整份历史草稿；
- 不修改标题、简介、来源、别名或其他草稿内容；
- 不允许 `humanAssessment` 出现在 PATCH 中；
- 有人工轨道时禁止发布兼容等级字段；
- 不能通过 `--limit` 扩大执行数量；
- 单次最多一个 PATCH；
- 不直接写 PostgreSQL；
- 不自动回滚；
- 单条验证成功前不得建立批量发布执行器。
