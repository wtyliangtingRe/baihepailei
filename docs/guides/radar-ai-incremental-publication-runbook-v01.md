# Radar AI 增补与公共发布运行手册 v0.1

状态：长期复用流程。本手册说明从 AI 研究包进入私有 Radar 轨道、生成公共候选、完成 schema 与隔离演练，最终以一次性生产执行包增补公共结论的完整技术路线。

本流程服务于“排雷与偏好提示”，不把 AI 输出当作不可争议的事实，也不覆盖有效人工结论。

## 1. 核心原则

### 1.1 人工与 AI 双轨

- 人工结论保存在 canonical `humanAssessment` 轨道；
- 私有 AI 研究结果保存在 Work 的 `radarAssessment` 轨道；
- 公共 AI 结论保存在独立、versionless 的 `radar_public` 集合；
- 公共有效等级优先级固定为：

```text
valid human assessment
→ current public AI conclusion
→ unknown
```

AI 写入不得覆盖人工字段，也不得通过发布 Works 草稿来公开 AI 结论。

### 1.2 增补，不是每轮全量重写

每一轮可以输入一份新增或更新研究包，但执行计划必须重新对照当前生产状态：

```text
新增结论      → ready
内容已一致    → already_current
证据或身份不足 → blocked
```

已经完成且 `conclusionSha256`、来源包、规则版本和目标 Work 身份均未变化的作品不重新写入。只有以下情况进入新一轮更新：

- 新增作品或此前无结论；
- 新证据改变判断；
- 规则版本改变并影响结论；
- canonical Work 身份发生修正；
- 旧公共结论需要被新 AI 结论 supersede；
- 人工审核要求重新研究。

首轮建表后，后续增补通常不再生成 schema migration，只生成数据 upsert/supersede 计划。

### 1.3 全量对照与增量执行并存

“增量”指生产写入只覆盖新建或变化的结论，不表示跳过全局安全检查。

推荐模式：

```text
用户输入：一个研究批次包
内部：按可恢复子批次研究、校验和组装
审计：对当前完整来源视图与生产状态重新分类
生产执行：只写 ready 的增量集合
```

大批次可以采用：

```text
用户侧 1 × 2500 条输入包
内部 10 × 250 条可恢复子波次
用户侧 1 × 完整结果包
```

某个子波次失败时只重跑对应子波次；已经通过哈希和 acceptance 的子波次不作废。

## 2. 阶段总览

```text
研究来源包
→ 来源完整性与规则校验
→ 私有 AI 计划
→ 私有 AI 幂等写入
→ 双快照全局审计
→ 公共 AI ready 集
→ schema review（首次或结构变化时）
→ 隔离恢复库 apply / acceptance / rollback 往返
→ production execution gate
→ fresh backup + production apply-once
→ 全局 acceptance + 不可变 receipt
```

任何阶段失败都不得绕过后续门槛，也不得把 casual approval 当作生产授权。

## 3. 阶段 A：研究来源包

### 3.1 输入要求

每条研究结果至少应绑定：

- 来源包 ID、版本与 SHA-256；
- canonical Work 候选身份；
- compatibility grade；
- matched rules；
- evidence、contradictions 与 review reasons；
- assessedAt 与 assessmentBatch；
- publication guard；
- policyVersion；
- `needs_review` / `doNotPublish` 等安全状态。

### 3.2 来源与证据门槛

以下情况保持 blocked：

- Work 身份无法唯一确认；
- 来源冲突尚未处理；
- X/未知等级不满足公共发布条件；
- publication guard 生效；
- 规则命中为空或证据强度不足；
- 已确认作废的测试 assessment；
- 人工锁定或明确要求重新研究。

旧测试记录不能通过 ID remap 重新成为 canonical Work 的结论，必须产生新的研究结果。

## 4. 阶段 B：私有 AI 轨道

私有 AI 轨道用于保存完整研究信息，不直接作为公共读取源。

分类固定为：

```text
ready_private_ai_write
already_current_private_ai
blocked_private_ai
blocked_discarded_test_assessment
```

执行规则：

- 只修改允许的私有 AI 字段；
- 不修改人工轨道；
- 不依据 legacy `status` 推导生命周期；
- 不自动发布 Works；
- current 内容一致时不重复写入；
- 写入后重新读取并比较 canonical JSON / SHA-256。

## 5. 阶段 C：双快照全局审计

### 5.1 为什么需要双快照

Payload 的 latest/draft 视图与 live/public 视图承担不同职责：

```text
draft=true
→ 判断最新私有 radarAssessment 是否已经 current

draft=false
→ 取得每个 Work 可公开的 live snapshot
→ 判断 catalog lifecycle 与公开可见性
```

不得用 latest draft 的 `_status` 或 visibility 判断公共发布，也不得要求 live API 返回对象的 `_status` 全部等于 `published`。可靠门槛是：

- draft/latest Work ID 唯一；
- live snapshot Work ID 唯一；
- 两套 Work ID 集合符合预期；
- 公共判断使用 live snapshot 的 `catalogStatus` 与 lite/full visibility。

### 5.2 公共候选门槛

公共 AI ready 必须同时满足：

- 私有 assessment 身份、规则和证据有效；
- `needsPublicationGuard !== true`；
- compatibility grade 为 `S/A/B/C/D/E/F`；
- `catalogStatus = active`；
- live snapshot 可公开；
- lite/full 均未隐藏；
- 不是已作废测试 assessment；
- `publicationKey = work:<canonical Work ID>`；
- `work = workIdSnapshot`；
- `conclusionSha256` 有效且唯一。

公共分类：

```text
ready_public_ai_after_schema
ready_public_ai_create
ready_public_ai_update
already_current_public_ai
blocked_public_ai
blocked_discarded_test_assessment
```

审计输出必须区分 `privateBlockers` 和 `publicBlockers`，不得把生命周期 blocker 污染私有统计。

## 6. 阶段 D：公共 schema review

### 6.1 首次建表

生产库缺少 `radar_public` 时，先生成：

1. 空操作 current-schema baseline migration；
2. 只创建 `radar_public*` 表与 `enum_radar_public*` 的加法 migration；
3. exact up/down SQL，保存为 `.sql.disabled`；
4. 与 ready 集绑定的不可变写入计划；
5. SHA-256 manifest 和 review ZIP。

禁止：

- 修改 `works`、`_works_v`、`payload_locked_documents_rels`；
- 写人工轨道或私有 AI；
- 执行 `payload migrate`；
- schema push；
- 生产 DDL/DML；
- PR merge。

### 6.2 数据库强制只读

`migrate:create` 可能连接生产库做 schema introspection，因此不能只靠“命令通常不写”。活动 runner 必须同时设置：

```text
PAYLOAD_DB_PUSH=false
PGOPTIONS=-c default_transaction_read_only=on ...
PostgreSQL pool options=default_transaction_read_only=on
```

这样即使框架初始化意外尝试写入，也由 PostgreSQL 拒绝。

### 6.3 直接 runner 原则

活动生产准备脚本必须是完整、静态、可直接 parser 检查的文件。

禁止使用：

- 运行时对旧脚本做 `Replace-Exact`；
- patch-on-patch wrapper；
- 把临时脚本写入 Git 仓库后再执行 dirty check；
- 依赖空格、换行或 here-string 细节的整段文本替换。

当前活动入口：

```text
scripts/radar/prepare-radar-public-conclusions-migration-v05.ps1
scripts/radar/run-and-package-radar-public-conclusions-schema-review-v05.ps1
```

### 6.4 提交与证据包顺序

安全顺序：

```text
生成 5 个 migration 文件
→ 本地 commit
→ 绑定 ready 行与 exact SQL
→ 完成 manifest 和 review ZIP
→ 最后 push migration commit
```

在 push 前失败：

- reset 到起始 HEAD；
- 删除本轮生成的 migration 文件；
- 删除不完整 review ZIP；
- 不在远端留下半成品 commit。

## 7. 阶段 E：隔离恢复库往返演练

schema review ZIP 验收后，在一次性 PostgreSQL 容器或隔离数据库完成：

```text
恢复 fresh production dump
→ baseline fingerprint
→ exact schema up
→ 写入 ready 公共结论
→ schema acceptance
→ 行级 acceptance
→ API / presentation acceptance
→ exact rollback
→ baseline fingerprint 恢复
```

必须验证：

- 表、enum、索引、约束和关系只涉及 Radar 公共集合；
- ready 行数、publication key、Work ID 和 conclusion hash 全部匹配；
- Works、人工轨道、私有 AI 与其他业务表没有变化；
- rollback 后结构与全部业务表回到 baseline；
- 演练容器和临时文件被删除。

隔离演练通过仍不等于生产授权。

## 8. 阶段 F：production execution gate

生产执行包必须绑定：

- 最终审计 ZIP SHA-256；
- schema review ZIP SHA-256；
- migration commit SHA；
- schema up/down SQL SHA-256；
- write plan SHA-256；
- 隔离演练 receipt；
- 当前生产 schema fingerprint；
- apply 与 rollback 的不同授权短语。

生产 apply 与 rollback 必须分别授权。不得把“继续”“可以写”“ok”等自然语言扩大解释为 exact production approval。

示例命名：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01
```

每次新批次或执行包版本改变都应更新授权短语版本，旧短语不得复用。

## 9. 阶段 G：production apply-once

维护窗口内顺序固定：

```text
暂停 Compose / Node / Python writer
→ fresh exact preflight
→ fresh pg_dump
→ 隔离完整恢复验证
→ schema fingerprint 复核
→ serializable schema apply（仅首次或结构变化时）
→ 分块写入公共结论
→ 分块 acceptance
→ 全局 acceptance
→ immutable receipt
```

### 9.1 数据写入策略

公共结论以 `publicationKey = work:<id>` 为稳定身份：

- 无 current 记录：create；
- current 内容完全一致：no-op / already_current；
- 新 conclusion hash：创建新 current AI 结论并 supersede 旧 AI 结论；
- 有效人工结论继续优先，不被 AI 覆盖；
- blocked 行永远不混入执行集。

大批次内部应按可恢复事务块执行。某块失败只恢复或重跑该块，不让已验收块作废；全局 acceptance 未通过前不得宣布完成。

### 9.2 commit 后失败

生产事务已经 commit 后发生日志、打包或后验失败时：

- 不自动 rollback；
- 保持 writer 暂停；
- 保存现场和 receipt；
- 只在收到独立 rollback 授权后执行精确 rollback。

## 10. 后续增补批次

首次 `radar_public` schema 已部署后，后续标准流程通常缩短为：

```text
新研究包
→ 私有 AI 幂等计划/写入
→ 双快照审计
→ 公共 create/update/already_current/blocked 分类
→ 隔离数据写入演练
→ production apply-once
```

只有集合字段、索引、约束或物理结构发生变化时才重新进入 schema migration 流程。

后续批次不得为了“简单”而把历史 9,000 条全部重写。完整来源只用于重新分类和检测漂移，真正的执行集只包含 `ready_create` / `ready_update`。

## 11. 产物保留

仓库中保留：

- 长期指南；
- 可执行脚本与测试；
- 正式 migration；
- 不包含真实作品数据的结构规则。

本地 `exports/` 保留：

- 来源与审计 ZIP；
- schema review ZIP；
- lab rehearsal receipt；
- production gate / apply receipt；
- manifest、SHA-256 与 acceptance；
- fresh dump（不得上传到公开仓库）。

上传给审阅者时优先上传小型证据 ZIP；完整数据库 dump 只留本地。

## 12. 本次首轮实例（2026-07-23）

最终全量审计：

```text
source rows            10805
private already current 9361
private ready               0
private blocked          1444
public ready             9000
public blocked           1805
global blockers             0
```

最终审计 ZIP：

```text
ALL-REMAINING-RADAR-GLOBAL-AUDIT-20260723-204835.zip
SHA-256 7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA
```

schema migration commit：

```text
3ea530cb342bfab5c126e94498d2d94c98413aa0
```

schema review ZIP：

```text
RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-20260723-221852.zip
SHA-256 297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB
```

该实例只完成 schema 生成与 review 包，尚未执行生产 migration 或写入 9,000 条公共结论。下一阶段是隔离恢复库完整往返演练。

## 13. 事故经验

本轮流程固化了以下经验：

1. latest/draft 与 live/public 必须分开读取；
2. live API 返回对象上的 `_status` 不能代替 live snapshot 存在性；
3. 私有 blocker 与公共生命周期 blocker 必须分开统计；
4. `migrate:create` 的只读声明必须由 PostgreSQL 强制；
5. 临时 wrapper 不得写入仓库后触发自己的 dirty check；
6. 不再使用运行时文本补丁链；
7. PowerShell 脚本必须通过真实 parser 测试；
8. review ZIP 完成前不得 push migration commit；
9. schema review、lab rehearsal 与 production apply 是三个不同授权阶段；
10. 所有执行均应幂等、可恢复、可验收并有不可变 receipt。
