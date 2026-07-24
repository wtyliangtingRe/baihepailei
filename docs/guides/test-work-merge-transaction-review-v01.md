# Test Work 合并事务审阅包 v0.1

状态：只生成审阅文件，不执行数据库写入。apply 与 rollback 文件使用 `.sql.disabled` 扩展名，仓库中不存在执行它们的 wrapper。

## 输入门槛

生成器同时绑定：

1. canonical Work identity 只读审计；
2. merge dry-run v03；
3. PostgreSQL 备份与隔离恢复验证；
4. 当前写目标 schema / 约束审计；
5. 本地 `database-backup.dump` 的字节数与 SHA-256。

任一 manifest、exact-before 计划、备份哈希或 schema 绑定变化时，生成失败。

## 当前两组决定

```text
10097 -> 32186
25561 -> 32094
```

- 32186 与 32094 保持 canonical；
- 10097 与 25561 软归档、隐藏但不删除；
- 四条 Work 的当前人工与 AI 测试 assessment 全部清空；
- 人工状态回到 pending，兼容 grade 回到 unknown；
- 不创建公共 AI 结论；
- 所有 Payload Work versions 和版本子行原地保留；
- 48 条 `_works_v` 与 1,070 条版本子行，共 1,118 条历史记录做逐行 JSONB exact guard，而不只比较数量。

## 事务策略

### Work 主表

四条 Work 都使用完整 JSONB exact-before guard，并在事务内 `FOR UPDATE`。

canonical：

- `catalog_status = active`；
- lite/full visible 为 true；
- 复制缺失的事实 external ID；
- 合并清洗后的搜索文本；
- 清空人工与私有 AI 测试 assessment。

merge-out：

- `catalog_status = archived`；
- lite/full visible 为 false；
- 保留 `id`、`site_id`、`slug`、`_status`、事实元数据与全部版本；
- 清空人工与私有 AI 测试 assessment。

### 搜索文本 refinement

v03 会过滤从 merge-out 输入的新操作日志，但 canonical 自身只有旧日志、没有新名称时，可能不生成清理动作。

事务审阅层重新计算两侧搜索文本，并剔除：

```text
mergedIntoWorkId
mergedIntoWorkTitle
mergedDuplicateWorkIds
duplicateMergeSourceKey
duplicateMergeMediumKey
```

这项变化会单独写入 `transaction-standardization-refinements.jsonl`。

### 事实子行

对 canonical 缺失且非语义重复的事实子行，事务使用**原行改父级**：

- 不生成任意的新 Payload child ID；
- 保留原行 ID、字段和值；
- 仅把父级列改为 canonical Work ID；
- rollback 将父级列精确改回 merge-out Work ID。

语义重复行不写入，但会纳入 exact-before 和 acceptance 的“保持不变”校验。

### 测试 assessment 子行

经用户明确授权，当前两组中以下不准确测试子行可以删除：

- private Radar matched rules；
- Work review reasons；
- 其他已被计划识别的 assessment child rows。

rollback 使用原始完整 JSONB 行恢复，不凭应用类型或默认值重建。

### 测试反馈

反馈记录：

- 只把 `workflow_status` 改为 `archived`；
- 保留原 `linked_work_id`；
- 保留正文、证据、提交者和历史字段；
- `updated_at` 使用事务时间；
- rollback 恢复原状态和原 timestamp。

### 版本保护

事务不会 UPDATE、INSERT、DELETE 或 reparent 任一版本行。

为防止“数量没变但历史内容被改写”，以下行同时参与 apply exact-before、事务内 acceptance、rollback guard 和 baseline acceptance：

```text
_works_v rows                 48
version child rows          1070
exact version rows total    1118
```

此外，11 个版本关系定位器仍保留 count guard，形成“逐行内容 + 关系数量”双重校验。

## SQL 文件

- `merge-transaction.sql.disabled`
  - serializable transaction；
  - lock/statement/idle timeout；
  - 1,146 条 exact-before 行校验；
  - 19 个 Work 关系计数 guard；
  - 11 个版本关系计数 guard；
  - apply；
  - 事务内 acceptance；
  - commit。
- `merge-rollback.sql.disabled`
  - 验证当前状态仍等于本次 apply 结果；
  - 恢复主表字段、子行与反馈；
  - 事务内 baseline acceptance；
  - commit。
- `merge-acceptance-readonly.sql`
  - post-merge 只读验收。
- `merge-rollback-acceptance-readonly.sql`
  - post-rollback 只读验收。

## 运行生成器

```powershell
& .\scripts\radar\run-and-package-test-work-merge-transaction-review-v01.ps1 `
  -IdentityAuditDirectory .\exports\canonical-work-identity-audit-<timestamp> `
  -DryRunV03Directory .\exports\test-work-merge-dryrun-v03-<timestamp> `
  -BackupVerificationDirectory .\exports\test-work-backup-verification-<timestamp> `
  -SchemaAuditDirectory .\exports\test-work-write-schema-audit-<timestamp>
```

输出：

```text
exports/test-work-merge-transaction-review-<timestamp>/
exports/TEST-WORK-MERGE-TRANSACTION-REVIEW-<timestamp>.zip
```

## 安全边界

生成完成仍必须是：

```text
ExecutableSQLText         = true
DisabledExtension         = true
ExecuteWrapperGenerated   = false
ExplicitApprovalReceived  = false
DatabaseWrite             = false
PayloadWrite              = false
MergePerformed            = false
RollbackPerformed         = false
BackupFileModified        = false
```

“SQL text generated”只表示进入逐行审阅阶段，不表示已经获准执行。

## 执行前仍需完成

1. 验证 ZIP 与 manifest；
2. 逐项审阅 `transaction-operations.json`；
3. 审阅 apply、rollback 与两份 acceptance SQL；
4. 在隔离恢复库中做 apply + acceptance + rollback + baseline acceptance 演练；
5. 演练结果与本地备份哈希重新绑定；
6. 用户明确批准 production execute-once；
7. 执行前再次验证数据库未漂移。

在这些条件全部满足前，不创建 production 执行入口。
