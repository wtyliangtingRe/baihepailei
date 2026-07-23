# Test Work production apply-once v0.1

状态：已收到精确 apply 授权。当前先生成和审阅 runner；runner-review 打包本身不连接数据库、不执行 apply。实际运行使用 parser-safe `execute-test-work-production-apply-once-v02.ps1`。

## 授权范围

```text
AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01
```

只授权一次以下 production apply：

```text
10097 -> 32186
25561 -> 32094
```

不授权 rollback、full-dump restore、migration、schema push、Payload 发布或 PR merge。

## 执行窗口

runner 必须绑定已验收的 transaction review、production gate、v03、exact-before 与 baseline schema audit，并要求固定 branch HEAD。

执行顺序：

1. 校验所有 manifest 与 SQL SHA-256；
2. 确认 PostgreSQL 镜像仍为 `postgres:17-alpine`；
3. 检查仓库目录下没有 Node、Python、Payload、Next 或 importer 进程；
4. 从 PostgreSQL Compose label 推导 project；
5. 停止同 project 内所有非 PostgreSQL 运行容器；
6. 连续两次确认 production 数据库没有其他 client session；
7. 在同一维护窗口创建 fresh custom-format dump；
8. 在隔离容器中完整恢复 fresh dump，并通过 37 / 37 与 83 表计数；
9. 重新运行 write-schema audit；
10. 比较 9 份稳定 schema fingerprint 文件；
11. 运行 production baseline preflight；
12. 获取 83 张业务表 baseline count；
13. 再次确认无其他 client session；
14. 执行一次 serializable apply；
15. 运行独立 post-merge acceptance；
16. 核对 83 张表，只有两项允许变化：

```text
public.works_review_reasons                   -12
public.works_radar_assessment_matched_rules    -5
```

17. 生成不可变 apply receipt；
18. 恢复先前停止的 writer 容器；
19. 再次生成包含 writer restart 状态的最终 receipt；
20. 打包小型 evidence ZIP。

fresh dump 保存在本地 fresh backup 目录，不加入小型 receipt ZIP。

## 失败策略

### Commit 前

任何 manifest、备份、恢复、schema、preflight、session、SQL 或事务内 acceptance 失败：

- PostgreSQL apply 不提交；
- runner 恢复停止的 writer 容器；
- 保存 failure JSON；
- 不运行 rollback。

### Commit 后

如果 apply 已提交但独立 acceptance 或 table delta 失败：

- runner 不自动 rollback；
- writer 容器保持暂停；
- 保存 fresh backup、日志和 failure JSON；
- 必须使用 apply receipt 设计 rollback preflight；
- 必须另行收到 `AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-ROLLBACK-V01`。

## Runner review

先运行：

```powershell
& .\scripts\radar\run-and-package-test-work-production-apply-runner-review-v01.ps1 `
  -TransactionReviewDirectory <dir> `
  -GateReviewDirectory <dir> `
  -LabRehearsalDirectory <dir> `
  -BaselineSchemaAuditDirectory <dir> `
  -AuthorizationPhrase AUTHORIZE-PRODUCTION-TEST-WORK-MERGE-APPLY-V01
```

输出：

```text
exports/test-work-production-apply-runner-review-<timestamp>/
exports/TEST-WORK-PRODUCTION-APPLY-RUNNER-REVIEW-<timestamp>.zip
```

review ZIP 包含 v01 runner、parser-safe v02 wrapper、receipt builder 与授权合同，不包含 apply SQL，不连接 production。

## 实际执行

只有 runner-review ZIP 再次验收后，才运行 `execute-test-work-production-apply-once-v02.ps1`。必须传入验收时固定的 branch HEAD 和全部证据目录。

成功输出至少包括：

```text
ApplyCommitted                True
PostMergeAcceptance           Passed
PostMergeTableDeltas          Matched
BusinessTableCountChecks      83
WriterContainers              Restarted
RollbackAutomaticallyRun      False
ProductionRollbackAuthorized  False
```

需要保留：

- fresh `database-backup.dump`；
- fresh backup verification 目录；
- fresh schema audit 目录；
- production apply receipt 目录；
- `TEST-WORK-PRODUCTION-APPLY-RECEIPT-*.zip`。
