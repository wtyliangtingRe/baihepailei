# AI Radar v0.6 定向发布计划 v0.1

## 背景

真实双视图盘点确认：

- v0.6 有 9,364 条逐条 `applied_and_verified` 证据；
- 2 条已经存在于 published/main 视图；
- 9,361 条只存在于 latest draft/version 视图；
- 1 条 latest draft 已有另一条正式 AI 结论；
- 0 条身份缺失；
- 0 条产物完整性问题。

这些结果没有丢失，但不能直接“发布全部草稿”。latest draft 可能包含之后的标题、简介、来源或其他编辑内容，整份发布会把无关改动一并带入主记录。

Payload drafts 的 `draft=true` 更新只保存到 versions table；普通 published/main 读取不会看到这些更新。发布需要显式写入 `_status: published`，但本项目必须通过允许字段的部分 PATCH 完成，不能复制整个 latest draft。

## 工具

```text
scripts/radar/plan-ai-radar-v06-targeted-publication-v01.mjs
```

该脚本只生成计划，不发出 PATCH。

它读取：

1. 最近一次 `draft-only-v06-match.jsonl`；
2. v0.6 execute、applied 和原始 plan 证据；
3. 当前 published/main Works；
4. 当前 latest draft Works。

随后为每条作品重新验证：

- Work ID 与 siteId 未漂移；
- latest draft 的完整 `radarAssessment` 仍与已验证 v0.6 plan 一致；
- published/main 中不存在另一条正式 AI 结论；
- v0.6 等级、政策版本和批次完整；
- 人工轨道不进入 PATCH；
- PATCH 不含标题、简介、来源或其他草稿字段。

## PATCH 白名单

所有作品都只允许：

```text
_status
radarAssessment
```

当前没有人工轨道的作品，还可以从原始 v0.6 plan 恢复以下兼容展示字段：

```text
rank
ratingNotice
reviewStatus
reviewReasons
evidenceStrength
```

有人工轨道的作品只计划 `radarAssessment + _status`，避免覆盖人工兼容字段。

明确禁止：

```text
humanAssessment
title
slug
summary
analysis
sourceLinks
candidateSources
creators
organizations
任何其他 latest draft 字段
```

## 本地运行

保持 Payload 运行，并确保当前 PowerShell 仍有临时管理员凭据：

```powershell
node --env-file=.env scripts/radar/plan-ai-radar-v06-targeted-publication-v01.mjs `
  --url "http://127.0.0.1:3000"
```

若要指定双视图盘点文件：

```powershell
node --env-file=.env scripts/radar/plan-ai-radar-v06-targeted-publication-v01.mjs `
  --url "http://127.0.0.1:3000" `
  --gap-file "data_local\staging\ai-radar\v06-publication-gap-v01\<run-id>\draft-only-v06-match.jsonl"
```

## 输出

```text
data_local/staging/ai-radar/v06-targeted-publication-plan-v01/<run-id>/
├─ summary.json
├─ targeted-publication-plan.jsonl
├─ ready-for-publication-dry-run.jsonl
└─ blocked.jsonl
```

主要汇总字段：

```text
planRows
readyForPublicationDryRun
blocked
withHumanTrack
byBlocker
patchFieldCounts
artifactIntegrityIssues
```

## 安全顺序

计划成功不等于允许执行。后续必须按顺序完成：

1. 定向发布 dry-run，重新读取 published 和 latest draft；
2. 验证计划中保存的 published、human 和 draft Radar 哈希；
3. 在隔离测试条目验证“部分 PATCH + `_status: published`”不会带入无关 draft 字段；
4. 建立新的数据库 checkpoint 并验证可恢复性；
5. 按小批次生成候选、arm 和最终确认；
6. 每条写入后分别回读 published 与 latest draft；
7. 验证 `humanAssessment` 和无关字段哈希保持不变；
8. 遇到第一条失败立即停止。

本工具拒绝 `--execute`、`--apply`、`--write`、`--patch`、`--publish` 和 `--restore`。不得把它的 JSONL 直接发送给通用导入脚本。
