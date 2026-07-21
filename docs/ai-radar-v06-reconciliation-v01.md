# AI Radar v0.6 历史写回与发布差距对账 v0.1

## 目标

本地 v0.6 记录显示，44 个批次对 9,364 条可写计划完成了逐条 PATCH 与回读验证；但标准 Works 读取只看到极少量正式 `radarAssessment`。真实原因不能靠重新评估推断，必须同时区分：

1. 已发布主记录；
2. `draft=true` 返回的最新版本；
3. v0.6 原始计划；
4. 逐条 `applied_and_verified` 执行证据。

Payload drafts 开启后，更新请求使用 `draft=true` 会只写 versions table，主集合保持不变；读取时 `draft=true` 返回最新版本。因此“最新草稿与 v0.6 完全一致”不等于“已发布主记录已经拥有该评级”。

本工具组只盘点，不恢复、不迁移、不发布、不重新运行 AI。

## 已验证的本地基线（2026-07-21）

真实 Windows、Payload 与本地 v0.6 产物对账结果：

```text
Works read with draft=true:            35,615
Execute summaries:                         45
Observed batches:                          44
Latest-run PATCH requests:              9,364
Latest-run applied and verified:         9,364
Unique Works with verified evidence:     9,364
Latest draft exact v0.6 matches:         9,363
Latest draft other formal conclusion:        1
Missing after verified apply:                0
Artifact integrity issues:                   0
```

另有一个早期执行尝试使全部历史运行的 PATCH 请求合计为 9,365，但每个批次只采用最新执行后，严格闭合为 9,364。该早期尝试保留在 `incomplete-or-inconsistent-runs.json`，不能重复计入成功数。

这组结果证明：v0.6 成果没有丢失，9,363 条仍精确存在于 latest draft/version 视图；下一步是区分哪些已经发布、哪些只存在于草稿。

## 工具

### 1. 最新版本对账

```text
scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs
```

该脚本读取 `draft=true` 的最新版本，对照 v0.6 execute、candidate、plan 和 applied 证据，回答旧结果是否仍存在于最新版本中。

主要状态：

- `current_matches_v06_exact`：最新版本中的 AI group 与旧计划完全一致；
- `current_matches_v06_identity_fields`：等级、批次和政策一致，仅其他字段存在附加差异；
- `current_missing_after_verified_apply`：有逐条已验证写入证据，但最新版本中结论为空；
- `current_has_other_formal_conclusion`：最新版本已有另一条正式结论；
- `work_missing` / `plan_missing`：身份或本地证据不完整。

### 2. 已发布与最新草稿差距

```text
scripts/radar/audit-ai-radar-v06-publication-gap-v01.mjs
```

该脚本分别读取：

```text
GET /api/works                 → 已发布/主集合视图
GET /api/works?draft=true      → versions table 中的最新版本
```

再用同一组 v0.6 逐条已验证证据对账。

主要状态：

- `published_matches_v06`：已发布主记录已与 v0.6 一致；
- `draft_only_v06_match`：最新草稿与 v0.6 一致，但已发布主记录没有该结论；
- `draft_matches_v06_published_other_formal`：草稿仍是 v0.6，但已发布主记录已有另一条正式结论；
- `latest_draft_has_other_formal_conclusion`：最新草稿已被后续正式结论替代；
- `missing_from_both_views`：已发布和最新草稿都没有旧结论；
- `work_or_plan_missing`：身份或计划证据不完整；
- `needs_review`：无法安全归类。

## 安全边界

两个脚本：

- 可以读取 Payload Works；
- 可以读取 `data_local` 下的 v0.6 执行证据；
- 不能 PATCH Payload；
- 不能写 PostgreSQL；
- 不能执行发布或恢复；
- 明确拒绝 `--execute`、`--apply`、`--write`、`--patch`、`--publish` 和 `--restore`。

`payloadPatchRequests` 只表示发出过请求，不能单独视为成功。正式对账必须找到逐条 `applied.jsonl`，并要求执行摘要中的 `appliedAndVerified` 与文件行数一致。

## 本地运行

保持本地 Payload 运行：

```powershell
pnpm dev
```

在另一个已经设置临时管理员密码的 PowerShell 中：

```powershell
node --env-file=.env scripts/radar/audit-ai-radar-v06-reconciliation-v01.mjs `
  --url "http://127.0.0.1:3000"

node --env-file=.env scripts/radar/audit-ai-radar-v06-publication-gap-v01.mjs `
  --url "http://127.0.0.1:3000"
```

## 发布前的下一阶段

`draft_only_v06_match` 不是“整份草稿可以直接发布”的许可。草稿版本可能同时包含其他编辑变化。下一阶段必须生成只包含允许字段的定向发布计划：

```text
radarAssessment
rank（仅无人工轨道时）
ratingNotice（仅无人工轨道时）
reviewStatus（仅无人工轨道时）
reviewReasons（仅无人工轨道时）
evidenceStrength（仅无人工轨道时）
_status = published
```

并且必须：

1. 重新验证 Work ID、siteId 和标题；
2. 保证 `humanAssessment` 前后哈希完全相同；
3. 不复制草稿中的无关字段；
4. 检查旧政策、来源可追溯性和当前结论覆盖准则；
5. 生成 dry-run、数据库 checkpoint、显式批次确认；
6. 每条发布后分别读取 published 与 `draft=true` 视图验证；
7. 对已有其他正式结论的记录保持阻断。

在双视图对账完成前，不应重新评估全部 9,364 条，也不应整份发布历史草稿。