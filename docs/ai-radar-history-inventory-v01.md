# AI Radar 历史成果总盘点 v0.1

## 目标

在继续批量补评之前，先只读核对三条彼此独立的数据线：

1. `Works.radarAssessment` 中已经正式写入的 AI 固定等级或有界区间；
2. `radar-research-records` 中仍可复用的研究建议、来源和未解决问题；
3. `data_local/staging/ai-radar` 中历史 v0.6 package、plan、dry-run、readiness 和 execute summary 痕迹。

盘点结果用于回答：以前完成的 AI 工作究竟已经写进 Works、仍停留在研究档案，还是只生成了本地计划。它不执行迁移，也不重新调用模型。

## 安全边界

脚本：

```text
scripts/radar/audit-ai-radar-history-v01.mjs
```

始终满足：

```text
Payload read: true
Payload write: false
Payload PATCH: 0
PostgreSQL write: false
Works mutation: false
Research record mutation: false
```

`--execute`、`--apply`、`--write`、`--patch`、`--confirm` 和 `--publish` 会被拒绝。

## 本地运行

保持 `pnpm dev` 在另一个 PowerShell 窗口运行，并在当前窗口准备临时登录变量：

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

运行：

```powershell
node scripts/radar/audit-ai-radar-history-v01.mjs `
  --url "http://127.0.0.1:3000"
```

脚本会读取当前 Works 与 `radar-research-records`，并扫描本机 `data_local/staging/ai-radar` 中文件名含 `v06` 的 summary JSON。

## 输出

每次运行创建唯一目录：

```text
data_local/staging/ai-radar/history-inventory-v01/<run-id>/
├─ summary.json
├─ reusable-research-candidates.jsonl
├─ scanned-without-valid-conclusion.jsonl
├─ unresolved-current-research.jsonl
├─ duplicate-current-research-works.jsonl
├─ works-without-formal-or-current-research.jsonl
├─ works-without-formal-or-reusable-research.jsonl
└─ local-v06-artifact-summaries.json
```

### Works 口径

```text
fixed_grade
bounded_range
scanned_without_valid_conclusion
unscanned
```

`ratingNotice`、顶层 `evidenceStrength` 和空的 Payload group 都不会被误算为完成评级。

### 研究记录口径

```text
bounded_range
likely_only
no_grade_suggestion
```

- `bounded_range`：已有最好、最可能、最坏等级，可作为后续有界区间候选；
- `likely_only`：有最可能等级，但仍需确定性补齐范围或重新评估；
- `no_grade_suggestion`：只有研究说明、风险信号或来源，不能直接形成评级。

研究记录始终只是可复用输入，不会自动覆盖 `Works.radarAssessment`。

## 关键摘要

重点查看：

```text
works.byCoverageMode
research.currentRows
research.byProposalMode
overlap.nonFormalWorksWithReusableResearch
overlap.unscannedWithReusableResearch
overlap.worksWithoutFormalOrCurrentResearch
overlap.worksWithoutFormalOrReusableResearch
localV06Artifacts.topLevelSummaries
```

这些数字将把历史作品分成：

1. 已有正式 AI 结论；
2. 没有正式结论，但有可复用研究；
3. 有研究记录，但不足以形成固定等级或区间；
4. 只存在 v0.6 本地计划或 dry-run；
5. 真正没有可复用 AI 成果。

## 后续决策

只有总盘点完成后，才决定：

- 哪些研究记录可以转换为新的 `bounded_range` 输入；
- 哪些 v0.6 已审核结果可以恢复受控写回；
- 哪些需要补来源后重新评估；
- 哪些才进入全新的 AI 扫描队列。

任何转换仍需独立计划、哈希、dry-run、checkpoint、批次确认、API 回读和人工轨道零差异检查。