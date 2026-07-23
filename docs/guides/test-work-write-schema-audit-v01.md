# Test Work 合并写目标 schema 审计 v0.1

状态：已通过 canonical identity、v03 merge dry-run、37 / 37 exact-before 和 PostgreSQL 备份隔离恢复验证。当前步骤仍为只读 schema 审计，不生成可执行事务 SQL，不修改数据库。

## 目的

在生成事务、回滚和验收 SQL 之前，以 PostgreSQL 当前物理结构为准审计所有计划写目标：

- 表是否真实存在；
- 物理列名和 PostgreSQL 类型；
- `NOT NULL`、默认值、identity、generated 与 sequence；
- 主键、唯一约束、外键、CHECK 与 exclusion constraint；
- 普通索引、唯一索引和 partial index；
- 数据库 trigger；
- row-level security 与 policy；
- enum 类型及合法标签。

不能用 `payload-types.ts`、Payload collection 配置或旧 migration snapshot 代替这一步。

## 输入绑定

入口同时要求：

1. 已验证的 `test-work-merge-dryrun-v03-*` 目录；
2. 已验证的 `test-work-backup-verification-*` 目录；
3. 本地 `database-backup.dump` 仍存在；
4. dump 字节数和 SHA-256 与恢复验证证据完全一致。

备份文件缺失、哈希变化、v03 manifest 变化或恢复证据变化时，审计直接停止。

## 写目标推导

目标表从 v03 计划自动推导：

- `works` 主表更新；
- 需要复制事实子行的表；
- 需要清除测试 assessment 子行的表；
- 需要归档测试反馈的表；
- 标记为需要引用重写复核的表；
- 仅当别名确实需要新增时才包括 aliases 表。

以下内容不作为写目标：

- `_works_v` 与版本子表，因为版本计划明确为原地保留；
- semantic duplicate 已存在而无需复制的行；
- 只读审计和证据表。

## 运行入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-test-work-write-schema-audit-v01.ps1 `
  -DryRunV03Directory .\exports\test-work-merge-dryrun-v03-<timestamp> `
  -BackupVerificationDirectory .\exports\test-work-backup-verification-<timestamp>
```

输出：

```text
exports/test-work-write-schema-audit-<timestamp>/
exports/TEST-WORK-WRITE-SCHEMA-AUDIT-<timestamp>.zip
```

## 主要文件

- `write-schema-targets.json`
- `write-schema-audit-readonly.sql`
- `table-metadata.jsonl`
- `column-metadata.jsonl`
- `constraints.jsonl`
- `indexes.jsonl`
- `triggers.jsonl`
- `policies.jsonl`
- `enum-labels.jsonl`
- `sequence-metadata.jsonl`
- `unique-definitions.json`
- `write-schema-audit-summary.{json,md}`
- `validation.json`
- `manifest.json`

## 安全边界

审计 SQL 同时使用：

```text
BEGIN TRANSACTION READ ONLY
PGOPTIONS default_transaction_read_only=on
ROLLBACK
```

输出必须继续证明：

```text
PostgreSQLReadOnly       = true
DatabaseWrite            = false
PayloadWrite             = false
ExecutableTransactionSQL = false
MergePerformed           = false
BackupFileModified       = false
```

容器中只临时写入 SQL 文件，运行结束后删除。

## 结果判定

`readyForTransactionSqlPlanning = true` 只表示：

- 所有推导出的表都存在；
- relation kind 可写；
- 计划使用的物理列都存在；
- 没有启用 RLS 阻断本次精确事务设计。

它不等于批准执行。

以下内容会作为 warning 单独审阅：

- 没有主键的目标表；
- enabled user trigger；
- row policy；
- 特殊唯一索引、partial index 或 exclusion constraint。

## 后续顺序

1. 审阅 schema audit ZIP；
2. 针对真实列、enum、唯一约束和 trigger 生成事务 SQL；
3. 同包生成精确 rollback SQL 与 acceptance SQL；
4. 事务 SQL 默认不执行；
5. 逐行审阅写集合和 exact-before guard；
6. 用户明确批准后才允许进入 execute-once 入口。
