# AI Radar v0.6 历史写回对账 v0.1

## 目标

当前 Works 正式 `radarAssessment` 只有极少量固定等级，但本地 v0.6 记录显示 44 个批次曾对 9,364 条可写计划执行 PATCH。该现象不能靠重新评估解决，必须先回答：

1. 哪些 Work 曾有逐条 `applied_and_verified` 证据；
2. 哪些当前仍与当时计划一致；
3. 哪些当前 AI 轨道为空；
4. 哪些后来存在另一条正式 AI 结论；
5. 哪些执行记录、计划文件或 Works 身份已经缺失；
6. 是否有执行中断、计数不一致或本地证据损坏。

本工具只盘点，不恢复、不迁移、不重新运行 AI。

## 安全边界

`scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs`：

- 可以读取 Payload Works；
- 可以读取 `data_local` 下的 v0.6 execute、candidate、plan 和 applied 证据；
- 不能 PATCH Payload；
- 不能写 PostgreSQL；
- 不能执行恢复；
- 明确拒绝 `--execute`、`--apply`、`--write`、`--patch`、`--publish` 和 `--restore`。

`payloadPatchRequests` 只表示发出过请求，不能单独视为成功。正式对账必须同时找到逐条 `applied.jsonl`，并要求执行摘要中的 `appliedAndVerified` 与文件行数一致。

## 本地运行

保持本地 Payload 运行：

```powershell
pnpm dev
```

在另一个已经设置临时管理员密码的 PowerShell 中：

```powershell
node --env-file=.env scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs `
  --url "http://127.0.0.1:3000"
```

若密码变量已经消失：

```powershell
$env:RADAR_PAYLOAD_EMAIL = (
  Get-Content .env |
  Where-Object { $_ -match '^\s*SITE_OWNER_EMAIL=' } |
  Select-Object -First 1
).Split('=', 2)[1].Trim().Trim('"').Trim("'")

$SecurePassword = Read-Host "请输入 Payload 管理员密码" -AsSecureString
$env:RADAR_PAYLOAD_PASSWORD = ConvertFrom-SecureString $SecurePassword -AsPlainText
Remove-Variable SecurePassword
```

也可使用离线 Works JSON/JSONL：

```powershell
node scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs `
  --works-file "data_local\path\works.jsonl"
```

## 输出

每次运行创建新目录：

```text
data_local/staging/ai-radar/v06-reconciliation-v01/<run-id>/
├─ summary.json
├─ reconciliation-all.jsonl
├─ current-matches-v06.jsonl
├─ current-missing-after-verified-apply.jsonl
├─ current-diverged-from-v06.jsonl
├─ work-or-plan-missing.jsonl
├─ latest-execute-run-per-batch.json
├─ all-execute-runs.json
├─ incomplete-or-inconsistent-runs.json
└─ artifact-integrity-issues.json
```

主要状态：

- `current_matches_v06_exact`：当前 AI group 与旧计划完全一致；
- `current_matches_v06_identity_fields`：等级、批次和政策仍一致，仅其他字段有格式或附加差异；
- `current_missing_after_verified_apply`：有旧的逐条已验证写入证据，但当前 AI 结论为空；
- `current_scanned_without_valid_conclusion`：当前留有扫描痕迹，但没有合法等级或区间；
- `current_has_other_formal_conclusion`：当前已有另一条正式结论，不能用旧结果覆盖；
- `work_missing`：旧计划对应 Work 当前不存在；
- `plan_missing` / `plan_missing_radar_assessment`：本地恢复证据不完整。

## 如何解释结果

`current_missing_after_verified_apply` 是恢复候选，不是自动恢复许可。下一阶段仍需：

1. 验证 Work ID、siteId 和标题身份没有漂移；
2. 验证旧计划来源仍可追溯；
3. 检查旧政策与当前政策的兼容性；
4. 将证据不足的旧固定等级转换为符合当前准则的有界区间；
5. 保证 `humanAssessment` 前后哈希完全相同；
6. 生成新的 dry-run、checkpoint 和批次确认；
7. 每条写回后 API 回读验证。

在本工具完成前，不应重新评估全部 9,364 条，也不应把 `RadarResearchRecords` 直接复制到 Works。
