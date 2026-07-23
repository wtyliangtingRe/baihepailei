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
  - 非公开记录优先拦截
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
