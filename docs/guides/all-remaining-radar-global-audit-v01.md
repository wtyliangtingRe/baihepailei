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

- 当前 Works 总数为 35,615；
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
- `catalogStatus = active`；
- Payload `_status = published`；
- lite/full 均未隐藏；
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
5. 读取当前 35,615 条 Works；
6. 逐条生成私有与公共分类；
7. 关闭临时读取服务器；
8. 生成 manifest 和 ZIP。

临时读取服务器默认使用端口 3101，不会替代站点当前运行端口。

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
