# Test Work production execution gate review v0.1

状态：隔离恢复库 apply / rollback 往返已经通过；当前步骤只生成最终授权合同和只读 SQL，不连接数据库，不复制 apply / rollback SQL，不生成 production 执行器。

## 已完成证据链

```text
canonical identity audit
→ merge dry-run v03
→ 37 / 37 production exact-before
→ PostgreSQL backup and isolated restore verification
→ physical schema / constraint audit
→ disabled transaction review package
→ no-network isolated apply / rollback round trip
```

隔离演练结果：

```text
Business tables checked       83
Restore                       passed
Baseline acceptance           passed
Apply transaction             passed
Post-merge acceptance         passed
Rollback transaction          passed
Post-rollback acceptance      passed
Production database write     false
Lab container removed         true
```

## 为什么还不直接执行

现有 `database-backup.dump` 证明：

- 当前 SQL 可以恢复到基线；
- apply 和 rollback 都能在同版本 PostgreSQL 中通过；
- 83 张业务表可以完整往返。

但它是演练证据，不应该直接替代未来生产执行窗口里的新鲜备份。执行前可能存在新的合法数据变化，因此 production apply 必须在同一个短暂停写窗口中重新：

1. 创建 fresh custom-format backup；
2. 在隔离容器中完整恢复并验证；
3. 运行 fresh baseline acceptance；
4. 复核目标 schema fingerprint；
5. 验证所有输入 SHA-256；
6. 才允许进入一次性 apply。

## 当前 gate package 不包含什么

- 不包含 `merge-transaction.sql.disabled`；
- 不包含 `merge-rollback.sql.disabled`；
- 不包含 PowerShell、shell、cmd 或 bat 执行器；
- 不连接 Docker 或 PostgreSQL；
- 不写 Payload；
- 不生成 migration；
- 不批准 production apply；
- 不批准 production rollback。

包中只复制三份只读 SQL：

```text
production-preflight-readonly.sql
production-post-merge-acceptance-readonly.sql
production-post-rollback-acceptance-readonly.sql
```

## 双重授权

apply 与 rollback 使用不同授权：

```text
AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01
AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-ROLLBACK-V01
```

apply phrase 的范围仅为：在 fresh backup、恢复验证、preflight、schema fingerprint 和写暂停全部通过后，生成并使用一次 production apply runner。

它不授权：

- rollback；
- 自动 full-dump restore；
- migration 或 schema push；
- Payload 发布；
- PR merge。

rollback 必须绑定 apply receipt，重新运行 rollback guard，并获得独立授权。不能因为 apply 已批准而自动执行 rollback。

## 执行窗口要求

- 暂停 Payload 对目标 Work 的编辑；
- 暂停 importer、assessment 或批处理写任务；
- fresh backup 与 apply 位于同一维护窗口；
- fresh backup 必须再次隔离恢复验证；
- production 镜像必须与演练镜像一致；
- apply SQL 内部继续使用 serializable、row lock、exact-before 和 transaction acceptance；
- apply 成功后必须立即运行独立 post-merge acceptance 和表行数差异检查；
- 必须生成不可变 apply receipt。

## 失败策略

### Commit 前失败

exact-before、lock、statement、constraint 或 transaction acceptance 失败时，事务自动中止，不提交任何写入。

### Commit 后独立验收失败

- 立即停止；
- 保存所有 stdout、stderr、表差异和 receipt；
- 不自动执行 rollback；
- 不自动进行全库 restore；
- 根据 apply receipt 生成 rollback preflight；
- 获得独立 rollback 授权后再处理。

## 运行 gate review

```powershell
& .\scripts\radar\run-and-package-test-work-production-execution-gate-review-v01.ps1 `
  -TransactionReviewDirectory `
    .\exports\test-work-merge-transaction-review-<timestamp> `
  -LabRehearsalDirectory `
    .\exports\test-work-merge-lab-rehearsal-<timestamp> `
  -BackupVerificationDirectory `
    .\exports\test-work-backup-verification-<timestamp>
```

输出：

```text
exports/test-work-production-execution-gate-review-<timestamp>/
exports/TEST-WORK-PRODUCTION-EXECUTION-GATE-REVIEW-<timestamp>.zip
```

## 成功门槛

```text
EvidenceChainVerified       true
ReadyToRequestApplyApproval true
FreshWindowBackupRequired   true
FreshRestoreCheckRequired   true
DatabaseConnection          false
ProductionDatabaseWrite     false
ApplySQLCopied              false
RollbackSQLCopied           false
ProductionExecuteWrapper    not generated
ProductionApplyAuthorized   false
ProductionRollbackAuthorized false
```

## 下一步

审阅 gate ZIP 后，用户可以单独决定是否提供 apply 授权 phrase。只有收到精确 apply phrase 后，才允许设计和生成 production execute-once runner；生成 runner 也不等于已经执行，实际执行仍需所有 fresh window gates 当场通过。
