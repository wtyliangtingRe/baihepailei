# AI Radar v0.6 定向发布 Dry-run v0.1

## 目标

本阶段只验证 9,361 条 `draft_only_v06_match` 的定向发布计划是否仍然安全，不会向 Payload 发出 PATCH，也不会发布整份草稿。

Dry-run 会重新读取：

- published/main Works；
- `draft=true` 的 latest draft/version Works；
- 最新 `targeted-publication-plan.jsonl`。

每条计划都会重新核对：

1. Work ID 与 siteId；
2. published 受控字段哈希；
3. 人工轨道哈希；
4. latest draft 的 `radarAssessment` 哈希；
5. 补丁 SHA-256；
6. 补丁允许字段；
7. 当前实际 changed fields；
8. 模拟发布后人工轨道是否完全不变。

## 安全边界

允许模拟的补丁字段只有：

```text
_status
radarAssessment
rank
ratingNotice
reviewStatus
reviewReasons
evidenceStrength
```

存在人工轨道时，兼容展示字段仍然不允许进入补丁。

明确禁止：

- `humanAssessment`；
- 标题、简介、别名、来源和外部 ID；
- 创作者、组织、标签与警告；
- 直接发布 latest draft 整份文档；
- Payload PATCH；
- PostgreSQL 写入；
- 自动恢复或重新 AI 评估。

脚本会拒绝 `--execute`、`--apply`、`--write`、`--patch`、`--publish` 和 `--restore`。

## 本地运行

保持本地站点运行：

```powershell
pnpm dev
```

在另一个已设置 Payload 临时凭据的 PowerShell 中：

```powershell
node --env-file=.env scripts/radar/dryrun-ai-radar-v06-targeted-publication-v01.mjs `
  --url "http://127.0.0.1:3000"
```

默认会选择 `data_local/staging/ai-radar/v06-targeted-publication-plan-v01` 下最新的：

```text
targeted-publication-plan.jsonl
```

也可以显式指定：

```powershell
node --env-file=.env scripts/radar/dryrun-ai-radar-v06-targeted-publication-v01.mjs `
  --plan-file "data_local\staging\ai-radar\v06-targeted-publication-plan-v01\<run-id>\targeted-publication-plan.jsonl" `
  --url "http://127.0.0.1:3000"
```

## 输出

```text
data_local/staging/ai-radar/v06-targeted-publication-dryrun-v01/<run-id>/
├─ summary.json
├─ targeted-publication-dryrun.jsonl
├─ ready-for-targeted-publication.jsonl
├─ already-published.jsonl
└─ blocked.jsonl
```

状态含义：

- `ready_for_targeted_publication`：当前 published、latest draft、人工轨道和补丁均与计划一致；
- `already_published`：允许字段已经与计划一致，可在恢复执行中安全跳过；
- `blocked`：存在状态漂移、哈希不一致、身份变化、人工轨道变化或非法补丁字段。

## 预期基线

根据 2026-07-21 的真实盘点：

```text
planRowsRead: 9361
readyForTargetedPublication: 9361
alreadyPublished: 0
blocked: 0
```

真实结果必须以运行时重新读取为准。任何 blocker 都必须先解释并重新生成计划，不能直接进入发布。

## 后续步骤

Dry-run 全部通过后仍不能直接批量发布。正确顺序是：

1. 审阅 dry-run 摘要；
2. 创建新的数据库 checkpoint；
3. 生成单条隔离发布候选；
4. 显式 arm；
5. 只发布 1 条；
6. 分别回读 published 与 latest draft；
7. 验证人工轨道哈希和无关字段哈希不变；
8. 再决定是否建立分批发布流程。
