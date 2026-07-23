# Radar 剩余条目统一修复与单次增量发布 v0.1

状态：首次 9,000 条公共结论已经生产写入成功后的推荐工作模式。

目标：先把剩余需要处理的条目全部完成研究、证据补充、身份确认与结构化录入，再统一识别共性问题、统一修复存储表示，并以一次新的增量生产执行完成所有当轮可安全公开的条目。

本流程不把 blocked 解释为“尚未执行”，也不允许为了追求全量完成而绕过证据与 publication guard。

## 当前基线

```text
public current conclusions     9000
private AI already current     9361
private AI blocked             1444
public AI blocked              1805
```

首次生产写入已经完成；现有 9,000 条在后续流程中应归类为 `already_current_public_ai`，不得重复全量写入。

## 核心策略

```text
先完成全部剩余条目的研究与结构化录入
→ 再做一次全局一致性检查
→ 统一解决共性问题
→ 统一生成 ready_create / ready_update
→ 一次 storage normalization
→ 一次数据级隔离演练
→ 一次新的 production gate
→ 一次新的增量 production apply-once
```

这里的“全部录入”指进入研究、staging 或私有候选层，不等于全部进入公共生产。

## 为什么采用统一收口

分批研究、逐批生产容易重复遇到同一类结构问题，例如：

- 时间精度与数据库实际存储表示不一致；
- conclusion hash 由不可存储表示计算；
- source summary 结构或缺失规则不统一；
- matched rules、grade 与 decisive rule 之间存在批次级漂移；
- publication guard 原因分类不完整；
- canonical Work 身份或重复记录在不同波次被不同处理；
- 字段默认值、enum、null 与空字符串在批次间不一致。

先完成全部剩余条目，再一次性做全局检查，可以让同一类问题只修一次，并避免反复生成 gate、backup、lab 与 production receipt。

## 内部波次与外部单批次

研究阶段仍按可恢复子波次执行：

```text
用户侧：1 个剩余条目总计划
内部：约 8 × 250 条可恢复子波次
最后：1 个统一结果包
```

每个内部子波次必须独立保存：

- 输入行集合与 SHA-256；
- 来源与证据；
- canonical Work 身份判断；
- matched rules、grade 与 contradictions；
- blocker 变化；
- parser / schema validation；
- 子波次 receipt。

内部子波次可以重跑，但在全部剩余条目处理完成前，不生成公共生产 apply。

## 处理层次

### 1. 研究与 staging 层

所有剩余条目都可以进入：

```text
researched_ready_candidate
researched_still_blocked
identity_needs_review
publication_guard_retained
fresh_research_required
```

该层允许完整记录不确定性、矛盾证据与下一动作。

### 2. 私有 AI 候选层

完成研究后分类：

```text
ready_private_ai_write
already_current_private_ai
blocked_private_ai
blocked_discarded_test_assessment
```

只有 `ready_private_ai_write` 可以进入私有 AI 增量计划；人工字段、生命周期字段和兼容 rank 继续受保护。

### 3. 公共候选层

全部研究波次结束后，统一读取：

- 当前来源全集；
- draft/latest Works；
- live/public Works；
- 当前 `radar_public`；
- blocker ledger；
- 所有子波次 receipt。

再统一分类：

```text
ready_public_ai_create
ready_public_ai_update
already_current_public_ai
blocked_public_ai
blocked_discarded_test_assessment
```

## 全局共性问题检查

在生成最终增量包前，必须一次性完成以下检查。

### 身份

- publication key 与 canonical Work ID 一致；
- Work ID、external IDs 和 title aliases 不产生新重复组；
- 已作废测试 assessment 不通过 remap 复活；
- 每个 Work 只有一个 current 公共 AI 结论。

### 证据

- 两条可追溯来源要求按统一标准执行；
- source summary 存在且能够支撑 grade 与 matched rules；
- 推断与来源事实明确区分；
- contradictions 不被静默删除；
- publication guard 的保留或解除理由明确。

### 规则与结论

- grade、best/likely/worst、decisive rule 和 matched rules 一致；
- 同一 policy version 使用同一判断标准；
- 低等级拦截优先；
- 同等级多类别可并列；
- 有效人工结论继续优先于公共 AI。

### 存储表示

- `assessedAt` 统一转换为 PostgreSQL `timestamp(3)` 等价 UTC 毫秒；
- `conclusionSha256` 基于实际可存储内容重新计算；
- null、空字符串、默认值和 enum 使用统一约定；
- 主表与子表字段可在真实 PostgreSQL 中往返一致；
- 生成 SQL 不依赖运行时文本 patch。

## 最终统一包

建议输出：

```text
RADAR-REMAINING-ROWS-UNIFIED-REMEDIATION-<timestamp>.zip
```

包内至少包含：

```text
all-remaining-research-results.jsonl
all-remaining-blocker-ledger.jsonl
private-ai-plan.jsonl
public-ready-create.jsonl
public-ready-update.jsonl
public-already-current.jsonl
public-still-blocked.jsonl
public-blocker-summary.json
common-issue-report.json
storage-normalization-plan.json
wave-receipts/
manifest.json
```

## 统一发布门槛

只有全部剩余条目完成研究收口后，才进入：

```text
全局审计
→ storage-normalized 增量包
→ fresh production dump
→ 数据级隔离 apply / acceptance / rollback
→ baseline 恢复
→ 新 production execution gate
→ 新版本精确 apply 授权
→ 增量 create / supersede
→ 全局 acceptance
→ immutable receipt
```

首次 V01 apply 授权已经消费，后续统一增量发布必须使用新的授权版本。

## 生产写入范围

下一轮生产执行只包含：

```text
ready_public_ai_create
ready_public_ai_update
```

不得写入：

```text
already_current_public_ai
blocked_public_ai
identity_needs_review
publication_guard_retained
```

现有 9,000 条未计划记录必须逐哈希保持不变。

## 完成标准

“剩余条目统一处理完成”定义为：

- 1,805 条公共 blocked 全部获得稳定 ledger 与最终状态；
- 1,444 条私有 blocked 全部完成重新研究或明确保留 blocker；
- 所有可补足证据的条目完成研究；
- 所有可解除 publication guard 的条目完成审计；
- 共性结构问题形成统一修复，而不是分波次各自打补丁；
- `ready_create` / `ready_update` 一次完成生产增量写入；
- 现有 9,000 条 already-current 记录未被重复改写；
- 无法安全公开的条目保留明确 blocker 与下一动作；
- 最终生产状态与最新证据、规则、身份和存储表示一致。
