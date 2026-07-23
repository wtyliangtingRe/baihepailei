# Radar blocked 队列修复与后续增补发布 v0.1

状态：首次 9,000 条公共结论生产写入成功后的后续流程。目标是逐步解锁满足证据与发布条件的 blocked 行，而不是绕过 blocker 强制把所有历史行写入公共集合。

## 当前生产基线

2026-07-24 首次生产执行完成后：

```text
public current conclusions     9000
private AI already current     9361
private AI ready                  0
private AI blocked             1444
public AI blocked              1805
```

首次 production receipt：

```text
RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-APPLY-RECEIPT-20260724-010844.zip
SHA-256 D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA
```

现有 9,000 条公共结论应在后续审计中归类为 `already_current_public_ai`，不得为了“全量一致”而重复写入。

## Blocked 队列结构

### 私有 AI blocked

```text
private blocked                                  1444
multiple_secondary_requires_two_traceable_sources 1238
missing_source_summary                            203
discarded_test_assessment_requires_fresh_research   3
```

### 公共 AI blocked

```text
public blocked                                   1805
multiple_secondary_requires_two_traceable_sources 1238
publication_guard                                 698
missing_source_summary                            203
discarded_test_assessment_requires_fresh_research   3
```

同一行可以命中多个 blocker，因此各 blocker 数量不能相加当作唯一行数。

## 为什么不能直接写完 1,805 条

blocked 不是“尚未执行”的同义词，而是“当前证据、身份或公开条件不满足”。

- `multiple_secondary_requires_two_traceable_sources`：多个二手来源尚未形成两条可追溯证据；
- `missing_source_summary`：缺少能够支撑判断的人类可读来源摘要；
- `publication_guard`：公共发布门槛主动阻止公开，可能涉及身份、内容风险、生命周期或可见性；
- `discarded_test_assessment_requires_fresh_research`：已确认测试结论作废，禁止从旧结论 remap，必须重新研究。

因此后续目标是：

```text
尽可能解锁所有符合条件的作品
≠
强制让每一条 blocked 记录公开
```

某些作品在证据仍不足、身份不确定或 publication guard 继续成立时，应长期保持 blocked。

## 阶段 1：建立 blocker ledger

每条 blocked 行建立稳定账本，至少包含：

- canonical Work ID；
- 来源包、规则版本与旧 conclusion hash；
- private blockers；
- public blockers；
- 缺失证据类型；
- publication guard 原因；
- 是否需要人工身份判断；
- 是否为已作废测试 assessment；
- 下一动作与优先级；
- 最近一次研究时间。

建议输出：

```text
radar-blocked-ledger-all.jsonl
radar-blocked-ledger-two-sources.jsonl
radar-blocked-ledger-missing-summary.jsonl
radar-blocked-ledger-publication-guard.jsonl
radar-blocked-ledger-fresh-research.jsonl
radar-blocked-ledger-summary.json
```

## 阶段 2：按 blocker 类型研究

### 两条可追溯来源

需要：

- 两个独立且可追溯的来源；或
- 一个高质量主要来源与一个独立交叉验证来源；
- 保存来源 URL/外部 ID、获取时间和支持的具体判断；
- 明确区分简介、评论、创作者声明和数据库元数据。

仅有多个互相复制的二手摘要不构成两个独立来源。

### 缺少来源摘要

为每条记录生成能够审阅的 `sourceSummary`：

- 说明来源实际支持什么；
- 不把推断写成来源事实；
- 明确男性介入、关系结局、设置偏好和矛盾证据；
- 对不确定内容保留保守措辞；
- 与 matched rules 和等级直接对应。

### Publication guard

逐条判断 guard 是否可以解除：

- canonical Work 身份是否唯一；
- live snapshot 是否公开；
- `catalogStatus` 是否仍为 active；
- lite/full visibility 是否允许公开；
- 结论是否仍需人工复核；
- 来源是否足以支撑公共表达；
- 是否存在冲突证据或误配作品风险。

生命周期或可见性 blocker 不能仅靠增加来源解除。

### 作废测试 assessment

必须从零生成新研究结果：

```text
新 batch ID
新来源集合
新 assessedAt
新 evidence / matched rules
新 conclusion hash
```

禁止复制旧测试 conclusion、仅更换 Work ID 或从 merge-out 记录继承结论。

## 阶段 3：私有 AI 增量计划

新研究完成后重新读取当前 Work 私有轨道，并分类：

```text
ready_private_ai_write
already_current_private_ai
blocked_private_ai
blocked_discarded_test_assessment
```

只写 `ready_private_ai_write`。当前一致的 9,361 条保持 no-op；人工字段、兼容 rank 和生命周期字段继续受保护。

私有写入成功后重新读取每条 Work，比较 canonical JSON 和 SHA-256。

## 阶段 4：公共增量全局审计

在私有轨道更新后，重新读取：

- 全部当前研究来源视图；
- 全部 draft/latest Works；
- 全部 live/public Works；
- 当前 `radar_public` 记录。

公共分类改为：

```text
ready_public_ai_create
ready_public_ai_update
already_current_public_ai
blocked_public_ai
blocked_discarded_test_assessment
```

预期：

- 现有 9,000 条大部分进入 `already_current_public_ai`；
- 新解锁且无公共记录的行进入 `ready_public_ai_create`；
- 有新结论 hash 的已存在作品进入 `ready_public_ai_update`；
- blocker 未解除的行继续 blocked。

## 阶段 5：Storage normalization

所有 `ready_create` / `ready_update` 在进入数据库前统一规范：

```text
assessedAt
→ PostgreSQL timestamp(3) 等价 UTC 毫秒

conclusionSha256
→ 基于实际可存储 publicRecord 重新计算
```

只允许改变存储表示和由其派生的 hash；不得在 storage normalization 阶段改变等级、规则、证据或 publication decision。

## 阶段 6：数据级隔离演练

公共 schema 已存在时，后续普通增补不再重复建表。隔离演练从 fresh production dump 开始：

```text
完整恢复
→ current public baseline
→ 增量 create / supersede
→ 字段与子表 acceptance
→ already_current 未变化
→ 原业务表零变化
→ exact rollback
→ baseline 恢复
```

只有 collection 字段、enum、索引、约束或关系结构发生变化时，才重新进入 schema migration 流程。

## 阶段 7：新 production gate

每个增补批次生成新的 gate，绑定：

- 新研究包和 blocker ledger；
- 当前生产 public baseline；
- ready_create / ready_update / already_current / blocked 数量；
- storage-normalized 增量包；
- lab receipt；
- exact apply / acceptance / rollback SQL；
- fresh backup 要求；
- 新版本 apply 与 rollback 授权短语。

首次 V01 apply 授权已经消费，禁止在后续批次复用。新 gate 完成后再确定该批次的精确授权短语。

## 阶段 8：增量 production apply-once

生产执行只处理当轮增量：

```text
ready_public_ai_create
ready_public_ai_update
```

写入规则：

- create：创建新的 current 公共 AI 记录；
- update：创建新 current 结论并 supersede 旧 AI 结论；
- already_current：不写；
- blocked：不写；
- 有效人工结论仍优先展示，不被 AI 覆盖。

生产提交后必须验证：

- 增量行数与计划一致；
- 现有 9,000 条未计划记录没有变化；
- publication key 每个 Work 只有一个 current；
- 新旧结论 supersession 链正确；
- 原业务表零变化；
- receipt 不包含完整 dump；
- rollback 未隐式授权或执行。

## 推荐波次

1,805 条 blocked 队列建议按 blocker 类型和风险拆分，而不是全部混跑：

```text
波次 A：missing source summary
波次 B：two traceable sources
波次 C：publication guard 可解除候选
波次 D：3 条 discarded test fresh research
```

每个用户侧大包仍可内部拆成可恢复的 250 条子波次。一次只发布当轮真正解锁的增量，不要求同一轮清空全部 blocked 队列。

## 完成标准

“剩余条目处理完成”应定义为：

- 所有 blocked 行都有明确 ledger 和下一动作；
- 所有可补足证据的行完成研究；
- 所有可解除 guard 的行完成审计；
- 所有 ready 增量完成生产写入和 receipt；
- 无法安全公开的行保留明确 blocker，而不是被强制写入；
- 当前生产公共结论与最新证据、规则和 Work 身份一致。
