# 项目指南索引

这里保存需要长期维护、便于以后重新接手时查阅的操作与设计指南。

## 当前指南

### 作品评级与审核

- [Work 评级与结构规范模型 v0.1](./work-assessment-model-v01.md)
  - 人工审核轨道与公共 AI Radar 轨道
  - 有效等级优先级
  - 生命周期字段与废止字段
  - 人工审核新旧字段统一原则
  - 历史 `rank` 来源保护

- [Radar AI 增补与公共发布运行手册 v0.1](./radar-ai-incremental-publication-runbook-v01.md)
  - 新研究包、私有 AI 与公共 AI 的双轨增补路线
  - 已完成结论保持 `already_current`，只写新增或变化记录
  - 双快照全局审计、publication guard 与 canonical Work 身份门槛
  - 首次 schema、隔离往返演练、生产 apply-once 与独立 rollback 授权
  - 大波次内部可恢复子批次、证据包与不可变 receipt

### 数据库结构整理

- [Work 数据库结构规范化运行手册 v0.1](./work-schema-normalization-runbook-v01.md)
  - 已确认的 schema 漂移
  - UTF-8 安全只读审计流程
  - 规范化阶段与验收门槛
  - 备份、SQL 审阅与回滚要求

- [Work 规范化候选决定 v0.1](./work-normalization-candidate-decisions-v01.md)
  - 8 条人工候选的初步处理类别
  - 56 条等级候选的来源保护
  - v01 dry-run 的 53 条公共 AI 初步候选
  - `status`、`legacy_x_wiki_page` 与 `rank` 的退役前置条件

- [Work 规范化 dry-run v02 语义门槛](./work-normalization-dryrun-v02-gates.md)
  - 非公开生命周期优先于 AI 分类
  - canonical Work identity gate
  - 同作品分裂记录提示
  - `timestamptz` 类型安全比较
  - v02 只读校正与打包入口

- [Canonical Work 身份审计指南 v0.1](./canonical-work-identity-audit-v01.md)
  - 完整主表、关系、引用与版本审计
  - canonical ID 选择证据
  - 用户明确指定测试记录时的评级清空与重新标准化规则
  - parser-safe v02 只读审计入口

- [临时测试 Work 合并与标准化 v0.1](./test-work-merge-standardization-v01.md)
  - 已确认测试污染的 canonical / merge-out 选择
  - 事实字段、来源与外部 ID 合并规则
  - 人工与 AI 测试评级清空规则
  - 测试反馈归档、软归档与版本原地保留
  - v03 exact-before 只读执行门槛

- [临时测试 Work PostgreSQL 备份恢复验证 v0.1](./test-work-backup-verification-v01.md)
  - 生产库只读 `pg_dump` 一致性备份
  - 备份前后 37 项 exact-before 复核
  - 一次性隔离 PostgreSQL 容器完整恢复
  - 全部非系统表行数一致性比较
  - 本地备份与小型上传证据包分离

- [Test Work 合并写目标 schema 审计 v0.1](./test-work-write-schema-audit-v01.md)
  - 绑定已验证本地 dump 与 v03 计划
  - 自动推导真实写目标表和物理列
  - 审计约束、索引、trigger、RLS、policy、enum 与 sequence
  - 在事务 SQL 生成前保持 PostgreSQL 只读

- [Test Work 合并事务审阅包 v0.1](./test-work-merge-transaction-review-v01.md)
  - 生成 serializable apply、精确 rollback 与两份只读 acceptance SQL
  - 事实子行原 ID reparent、测试 assessment 子行删除与反馈归档
  - canonical 搜索文本旧 merge 日志清理 refinement
  - `.sql.disabled` 与无执行 wrapper 的安全边界

- [Test Work 合并隔离恢复库往返演练 v0.1](./test-work-merge-lab-rehearsal-v01.md)
  - 生产 PostgreSQL 容器只做镜像 inspect
  - `--network none` 一次性恢复容器
  - baseline → apply → acceptance → rollback → baseline 完整往返
  - 83 张业务表行数与 1,146 条 exact row 双重验收
  - 演练完成后删除容器，仍不批准 production execution

- [Test Work production execution gate review v0.1](./test-work-production-execution-gate-review-v01.md)
  - 锁定 transaction、lab、backup 与 SQL SHA-256 证据链
  - production apply 与 rollback 使用独立授权
  - 真正执行前要求同窗口 fresh backup 与隔离恢复验证
  - gate package 只含只读 SQL，不含 apply、rollback 或执行 wrapper

- [Test Work production apply-once v0.1](./test-work-production-apply-once-v01.md)
  - 精确 apply 授权只覆盖两组已审阅测试重复记录
  - 自动暂停 Compose writer，并拒绝本地 Node/Python writer
  - 同窗口 fresh backup、隔离恢复和 schema fingerprint
  - serializable apply、独立 acceptance、83 表差异与不可变 receipt
  - commit 后失败不自动 rollback，并保持 writer 暂停

- [全量剩余 Radar 唯一审计 v0.1](./all-remaining-radar-global-audit-v01.md)
  - 锁定 v0.6 的 10,805 条来源全集
  - 重新读取当前 35,615 条 Works，而不是沿用历史 wouldUpdate
  - 分离私有 AI 与公共 AI 写入集
  - publication guard、人工保护与非公开生命周期继续生效
  - 四条已作废测试 assessment 不会重新写入
  - 审计通过后只生成一个全量生产执行包

- [Radar 公共结论 schema review v0.1](./radar-public-conclusions-schema-review-v01.md)
  - 绑定最终审计 ZIP 与 9,000 条唯一公共写入清单
  - 生成并提交空操作 schema baseline 与 Radar-only 加法 migration
  - 抽取 exact up/down SQL，但保持 `.sql.disabled`
  - 禁止修改 Works、私有 AI、人工轨道或执行生产 migration
  - 为隔离恢复库往返演练提供不可变输入

- [Radar 公共结论隔离恢复库往返演练 v0.1](./radar-public-conclusions-lab-rehearsal-v01.md)
  - 绑定最终审计、schema review、migration commit 与 9,000 条 ready 记录
  - fresh production dump 恢复到 `--network none` 一次性 PostgreSQL
  - schema + 数据 apply、字段与子表 acceptance、exact rollback
  - 非 Radar 表行数往返一致，完整 dump 留本地、仅上传证据 ZIP
  - 演练通过后仍需 production execution gate 与独立精确授权

- [Radar 公共结论存储规范化 v0.1](./radar-public-storage-normalization-v01.md)
  - 在业务审计与物理数据库之间建立可复用的 storage normalization 边界
  - 将六位微秒时间按 PostgreSQL `timestamp(3)` 规则舍入为 UTC 毫秒
  - 只修改 `assessedAt` 与由实际存储内容重算的 `conclusionSha256`
  - 保留业务审计和 migration DDL，仅取代旧 ready JSONL 与数据计划
  - 为新的隔离演练和 production gate 提供 storage-ready 不可变输入

- [Radar 公共结论 storage-normalized 隔离演练与 production gate v0.1](./radar-public-storage-lab-and-production-gate-v01.md)
  - 绑定 storage-normalization replacement 包与保留的 migration DDL
  - fresh backup → 无网络恢复 → 9,000 行 apply → acceptance → exact rollback
  - lab ZIP 排除完整 dump，并把最终 lab SHA 回填到 production gate
  - gate 只含禁用态 apply/rollback SQL 与证据链，不含生产执行 wrapper
  - apply 与 rollback 继续使用互不替代的精确授权短语

- [Radar 公共结论 production apply-once v0.1](./radar-public-conclusions-production-apply-once-v01.md)
  - 精确 apply 授权只覆盖已验收的 9,000 条 storage-normalized 公共结论
  - 暂停 Compose writer，并要求生产与 gate baseline 零漂移
  - 同窗口 fresh backup、无网络完整恢复与第二次 apply/rollback 演练
  - 生产 serializable apply、22 项 acceptance、83 张原业务表零变化
  - commit 后失败不自动 rollback，完整 dump 留本地、receipt ZIP 可上传

- [Radar blocked 队列修复与后续增补发布 v0.1](./radar-blocked-rows-remediation-and-incremental-publication-v01.md)
  - 以首次 9,000 条生产结论为 already-current 基线，不重复全量重写
  - 按两条可追溯来源、缺少摘要、publication guard 与作废测试拆分队列
  - 先解锁证据与发布门槛，再生成 private/public 增量计划
  - 后续通常只做数据级隔离演练，无结构变化时不再生成 migration
  - 每批只 create / supersede ready 增量，blocked 继续保留明确原因

- [Radar 剩余条目统一修复与单次增量发布 v0.1](./radar-remaining-rows-unified-remediation-campaign-v01.md)
  - 先完成全部剩余条目的研究与结构化录入，再统一修复共性问题
  - 内部按约 250 条可恢复波次处理，中途不反复进入生产
  - 最终统一生成 ready-create / ready-update / still-blocked 结果包
  - 现有 9,000 条作为 already-current 基线逐哈希保持不变

- [Radar blocked 最新有效记录与冲突保留策略 v0.1](./radar-blocked-latest-valid-conflict-policy-v01.md)
  - current 选择最新、有效、完整且身份确定的同轨道记录
  - 新完整快照整体替换旧 AI 快照，明确为空时清除旧值
  - 所有旧记录、来源、哈希和冲突保存在 history / conflict ledger
  - 影响等级、规则或身份的冲突继续 blocked，不按时间戳强行裁决
  - ledger 生成入口：`run-and-package-radar-blocked-ledger-v01.ps1`

### 审计产物完整性

- [审计产物完整性与字符编码指南 v0.1](./audit-artifact-integrity-v01.md)
  - PostgreSQL、Docker、psql 与 PowerShell 之间的 UTF-8 安全传输
  - Base64 传输封装与逐行 JSON 校验
  - `validation.json`、SHA-256 与不可用于迁移的产物判定

### 发布安全

- [Radar 公共结论与 Works 发布安全指南 v0.1](./radar-publication-safety-v01.md)
  - 为什么禁止通过 Works 草稿发布 AI 结论
  - 独立公共结论集合的职责边界
  - 迁移暂停与恢复条件

## 文件放置原则

- 长期设计、操作步骤和安全规则放在 `docs/guides/`。
- 可执行脚本放在 `scripts/`，并由指南链接过去。
- 临时审计结果、包含作品标题或数据库记录的 JSONL/TSV/ZIP 放在 `exports/`，默认不提交到仓库。
- 正式迁移放在 `src/migrations/`，但只有在备份、dry-run、逐行 SQL 审阅和明确批准后才允许生成或执行。
- 规则正文与机器可读规则继续保存在它们原有的专用位置；指南只负责说明入口、版本和操作顺序，不复制出另一份互相漂移的真相。

## 更新要求

涉及以下内容的 PR，应同步更新对应指南：

- 字段新增、废止或语义变化；
- 人工/AI 等级优先级变化；
- 数据导入、发布或迁移流程变化；
- 新的事故结论或安全门槛；
- 审计脚本、备份路径或回滚步骤变化。
