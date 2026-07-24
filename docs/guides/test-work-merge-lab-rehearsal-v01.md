# Test Work 合并隔离恢复库往返演练 v0.1

状态：只在一次性隔离 PostgreSQL 容器中执行 apply 与 rollback。生产 PostgreSQL 容器仅通过 `docker inspect` 读取镜像名，不运行 `psql`、`pg_dump`、`pg_restore`，也不复制临时文件。

## 输入

演练同时绑定：

1. 已验收的 transaction review 目录；
2. 已验证的本地 `database-backup.dump`；
3. backup verification evidence manifest；
4. apply、rollback 和两份 acceptance SQL 的 SHA-256；
5. 事务审阅包中固定的操作数量和安全声明。

当前备份：

```text
bytes   27196757
sha256  3c3af1df4cde2d8da0f2e4e8b3236ad2a3dcdf5345c99ed723c6346075aec11e
```

当前 transaction review：

```text
Work updates                 4
Factual child reparents      3
Test assessment deletes     17
Feedback archives            3
Semantic duplicate skips     1
Version rows exact-guarded 1118
Exact-before rows          1146
Relation count guards       19
Version count guards        11
```

## 必需确认

入口要求精确确认字符串：

```text
RUN-ISOLATED-TEST-WORK-MERGE-LAB-V01
```

这只批准一次隔离实验室往返，不是 production execute approval。

## 隔离模型

runner：

- 用 `docker inspect` 读取 `baihepailei-postgres` 当前镜像；
- 启动唯一命名的一次性 PostgreSQL 容器；
- 使用 `--network none`；
- 不发布宿主机端口；
- 随机生成实验室数据库密码；
- 恢复已验证 dump；
- 最终执行 `docker rm -fv`；
- 只有在容器已确认删除后才允许汇总成功证据。

生产容器不接收 SQL、dump 或临时文件。

## 往返顺序

```text
restore verified dump
→ baseline rollback-acceptance (read-only)
→ baseline 83-table counts
→ apply transaction
→ post-merge acceptance (read-only)
→ post-merge 83-table counts
→ rollback transaction
→ post-rollback baseline acceptance (read-only)
→ post-rollback 83-table counts
→ remove lab container
```

## 表行数门槛

apply 后只允许两张测试 assessment 子表发生行数变化：

```text
public.works_review_reasons                   -12
public.works_radar_assessment_matched_rules    -5
```

以下操作不改变表行数：

- 4 条 Work 更新；
- 3 条事实子行改父级；
- 3 条反馈归档；
- 1 条语义重复跳过；
- 所有版本与版本子行保持原样。

rollback 后 83 张业务表的行数必须逐表回到 baseline。

行数比较之外，SQL 自身还会验证：

- 1,146 条完整 JSONB exact row；
- 19 个 Work 关系计数；
- 11 个版本关系计数；
- apply 后完整 acceptance；
- rollback 后完整 baseline acceptance。

## 运行入口

```powershell
& .\scripts\radar\run-and-package-test-work-merge-lab-rehearsal-v01.ps1 `
  -TransactionReviewDirectory `
    .\exports\test-work-merge-transaction-review-<timestamp> `
  -BackupVerificationDirectory `
    .\exports\test-work-backup-verification-<timestamp> `
  -Confirm RUN-ISOLATED-TEST-WORK-MERGE-LAB-V01
```

输出：

```text
exports/test-work-merge-lab-rehearsal-<timestamp>/
exports/TEST-WORK-MERGE-LAB-REHEARSAL-<timestamp>.zip
```

## 成功门槛

```text
RestoreCompleted            true
BaselineAcceptance          passed
ApplyTransaction            passed
PostMergeAcceptance         passed
RollbackTransaction         passed
PostRollbackAcceptance      passed
BusinessTableCountChecks    83
LabRoundTripVerified        true
LabNetwork                  disabled
LabContainer                removed
ProductionDatabaseWrite     false
MergePerformedInProduction  false
ProductionExecutionApproved false
```

## 失败行为

任一步失败时：

- 后续阶段不运行；
- runner 尽力保存当前日志与 `lab-rehearsal-failure.json`；
- 隔离容器仍进入 `finally` 删除；
- 不生成成功 ZIP；
- 不触碰生产数据库。

## 后续

隔离往返演练通过后，才允许设计 production execute-once 门槛。仍需：

1. 审阅演练证据 ZIP；
2. 修正演练发现的任何 SQL 问题；
3. 生成 production 执行前最新只读漂移检查；
4. 设计 apply receipt 与精确 rollback 绑定；
5. 用户单独明确批准 production execution；
6. PR 保持 Draft、未合并，直到数据库阶段与代码阶段分别验收。
