# 全量剩余 Radar 唯一审计 v0.1

状态：只读。该审计把历史 v0.6 全量来源和当前生产状态重新对齐，生成唯一的剩余私有 AI 与公共 AI 写入集。审计本身不 PATCH Payload、不写 PostgreSQL、不生成或执行 migration。

## 固定来源全集

来源固定为：

```text
data_local/staging/ai-radar/v06-package-import-v01/
  ai-radar-v06-package-import-v01.jsonl
  ai-radar-v06-package-import-v01-summary.json
```

必须满足：

```text
rowsRead                         10805
readyForPayloadPlanning           9364
blockedBeforePayloadPlanning      1441
publicationGuardRows               698
```

这些数字只证明来源全集与历史导入结果没有丢失。当前是否需要写入，必须重新读取生产库决定。

## 当前生产基线

审计要求：

- 当前 Works draft/latest 快照总数为 35,615；
- 当前 Works published/live 快照总数为 35,613；
- Test Work production apply receipt 已证明：
  - `10097 → 32186`；
  - `25561 → 32094`；
  - apply committed；
  - post-merge acceptance passed；
  - 83 张业务表变化与计划一致。

四个测试 Work 的旧 v0.6 assessment 均被标为：

```text
blocked_discarded_test_assessment
```

不会 remap 后重新写入 canonical Work，也不会公开。它们只能在新的研究结果产生后重新进入评级流程。

## 双快照原则

私有 AI 与公共生命周期不能使用同一套 Payload 快照：

```text
draft=true   → 最新 Work 快照，用于私有 radarAssessment 对比

draft=false  → published/live Work 快照，用于公共生命周期与公开标题
```

原因是最新 draft 可能包含已经写入的私有 AI 数据，同时其 `_status`、lite/full visibility 不能代表当前公开页面。公共 AI 结论只允许依据 published/live Work 判断是否可展示。

## 私有 AI 轨道

审计复用当前稳定身份解析与 Work patch 规则，逐条分类：

```text
ready_private_ai_write
already_current_private_ai
blocked_private_ai
blocked_discarded_test_assessment
```

人工结论与 AI 结论是并行轨道。已有人工结论不会被覆盖；AI 更新只能修改允许的私有 AI 字段。明确锁定、身份不确定、X 级、无规则、冲突或其他既有 blocker 继续保持阻止。

## 公共 AI 轨道

公共候选必须同时满足：

- 私有 assessment 身份与规则有效；
- `needsPublicationGuard !== true`；
- 等级为 `S/A/B/C/D/E/F`；
- published/live Work 存在；
- published/live `catalogStatus = active`；
- published/live Payload `_status = published`；
- published/live lite/full 均未隐藏；
- 不是已作废的测试 assessment。

分类：

```text
ready_public_ai_after_schema
ready_public_ai_create
ready_public_ai_update
already_current_public_ai
blocked_public_ai
blocked_discarded_test_assessment
```

当前数据库若缺少 `public.radar_public`，审计只生成公共写入集并标记：

```text
schemaCreationRequired = true
```

后续唯一执行包必须先执行经过同一审计绑定的 Radar-only 加法 schema，再导入公共结论。不得使用通用 schema push。

## 一次审计的运行方式

runner 会：

1. 校验 v0.6 来源摘要；
2. 校验最终 Test Work production receipt manifest；
3. 只读查询 `public.radar_public` 是否存在；
4. 以 `PAYLOAD_DB_PUSH=false` 启动独立端口的临时 Next/Payload 读取服务器；
5. 读取 35,615 条 draft/latest Works；
6. 独立读取 35,613 条 published/live Works；
7. 逐条生成私有与公共分类；
8. 关闭临时读取服务器；
9. 生成 manifest 和 ZIP。

临时读取服务器默认使用端口 3101，不会替代站点当前运行端口。

### Payload 审计登录凭据

活动入口为：

```text
run-and-package-all-remaining-radar-global-audit-v02.ps1
```

它按以下顺序寻找管理员登录：

```text
RADAR_PAYLOAD_EMAIL / RADAR_PAYLOAD_PASSWORD
PAYLOAD_EXPORT_EMAIL / PAYLOAD_EXPORT_PASSWORD
PAYLOAD_SEED_EMAIL / PAYLOAD_SEED_PASSWORD
```

同时读取本地 `.env` 与 `.env.local`。若仍缺失：

- 邮箱通过普通 `Read-Host` 输入；
- 密码通过 `Read-Host -AsSecureString` 输入，终端不显示；
- 只在当前审计进程中临时设置 `RADAR_PAYLOAD_*`；
- 无论成功或失败都恢复原环境变量；
- 不把密码写入 `.env`、命令历史、输出目录、日志、manifest 或 ZIP。

## 输出

```text
exports/all-remaining-radar-global-audit-<timestamp>/
exports/ALL-REMAINING-RADAR-GLOBAL-AUDIT-<timestamp>.zip
```

主要文件：

```text
all-remaining-radar-global-audit.jsonl
private-ai-ready.jsonl
private-ai-already-current.jsonl
private-ai-blocked.jsonl
public-ai-ready.jsonl
public-ai-already-current.jsonl
public-ai-blocked.jsonl
all-remaining-radar-global-audit-summary.json
manifest.json
```

## 成功门槛

```text
SourceRows                       10805
ProductionWorksRead              35615
PublishedWorksRead               35613
GlobalBlockers                   0
ReadyForSingleExecutionPlanning  true
PayloadWrite                     false
PostgreSQLWrite                  false
MigrationGenerated               false
SchemaPush                       false
DedicatedAuditServer             stopped
```

行级 blocker 可以存在；它们表示该行没有进入写入集，不等于整个审计失败。只有来源、生产基线、receipt、服务器或全集完整性错误会进入 `globalBlockers`。

## 审计后的唯一执行

审计 ZIP 验收后，下一阶段只生成一个生产执行包：

```text
fresh backup + isolated restore
→ fresh exact preflight
→ Radar-only schema（仅缺失时）
→ 私有 AI 写入集
→ 公共 AI 写入集
→ 分块 acceptance
→ 全局 acceptance
→ 单一 receipt
```

用户侧只运行一次。内部可按可恢复事务块处理，但不得把 blocked 行混入写入集，也不得自动公开 publication-guard 行。
