# 临时测试 Work PostgreSQL 备份恢复验证 v0.1

状态：只有在 v03 dry-run 已验证、实际 exact-before 37 / 37 全部匹配后才允许运行。不会修改生产数据库，也不会合并 Work。

## 目标

在准备任何可执行合并 SQL 前，建立一份新的 PostgreSQL 自定义格式备份，并证明它能够在隔离环境中完整恢复。

验证流程同时要求：

1. 已上传并验证的 exact-before 证据为 37 / 37；
2. 备份前重新运行 37 项 exact-before，全部匹配；
3. 备份前读取所有非系统表行数；
4. 使用 `pg_dump -Fc -Z 9 --serializable-deferrable` 创建一致性备份；
5. 备份后再次运行 37 项 exact-before，全部匹配；
6. 备份后所有非系统表行数与备份前一致；
7. `pg_restore --list` 能完整读取归档目录；
8. 使用生产 PostgreSQL 容器当前镜像启动一次性隔离容器；
9. 通过 `pg_restore --exit-on-error` 恢复整个备份；
10. 在恢复库中再次运行 37 项 exact-before，全部匹配；
11. 恢复库所有非系统表行数与生产备份基线一致；
12. 删除隔离恢复容器和生产容器 `/tmp` 临时文件。

## 生产环境安全边界

生产 PostgreSQL 只执行：

- `BEGIN TRANSACTION READ ONLY` 查询；
- `pg_dump`；
- `pg_restore --list`；
- 容器 `/tmp` 文件创建、读取和删除。

生产数据库不会执行：

- `UPDATE`、`INSERT`、`DELETE`；
- DDL；
- 创建验证数据库；
- 恢复备份；
- 合并、归档或修改 Work。

完整恢复只发生在一次性 Docker 容器中。该容器使用随机临时密码，验证完成后通过 `docker rm -fv` 删除。

## 推荐入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\radar\run-and-package-test-work-backup-verification-v02.ps1 `
  -DryRunV03Directory .\exports\test-work-merge-dryrun-v03-<timestamp> `
  -ExactBeforeDirectory .\exports\test-work-exact-before-<timestamp>
```

v02 是 parser-safe 入口。它会：

- 读取 v01 源脚本；
- 将日志重定向目标改成普通路径变量；
- 在系统临时目录生成副本；
- 使用 PowerShell AST parser 做语法校验；
- 运行后删除临时脚本。

## 输出

```text
exports/test-work-backup-verification-<timestamp>/
```

其中包含本地可恢复备份：

```text
database-backup.dump
database-backup.dump.sha256
```

还会生成较小的上传证据包：

```text
exports/TEST-WORK-BACKUP-VERIFICATION-EVIDENCE-<timestamp>.zip
```

证据 ZIP **不包含数据库 dump 本体**，只包含：

- dump 文件名、字节数和 SHA-256；
- `pg_restore --list` 结果；
- 生产备份前、备份后的 exact-before 结果；
- 隔离恢复后的 exact-before 结果；
- 三次全业务表行数结果；
- pg_dump / pg_restore stderr；
- 隔离容器日志；
- `backup-verification-summary.{json,md}`；
- `evidence-manifest.json`。

数据库备份可能较大且包含完整业务数据，因此应只保存在用户本地安全位置，不上传到聊天或提交到 Git。

## 通过条件

必须同时满足：

```text
ProductionPreExactChecks  = 37 / 37
ProductionPostExactChecks = 37 / 37
RestoreExactChecks        = 37 / 37
ProductionCountsStable    = true
RestoredCountsMatch       = true
RestoreCompleted          = true
BackupRestoreVerified     = true
ProductionDatabaseWrite   = false
MergePerformed            = false
VerificationContainer     = removed
ProductionTempFiles       = removed
```

任一条件失败都必须停止，不得生成事务合并 SQL。

## 后续门槛

备份恢复验证通过后，仍需：

1. 审阅真实表结构、枚举和唯一约束；
2. 生成最小化事务 SQL；
3. 为每项写入添加 exact-before 条件；
4. 生成独立回滚 SQL；
5. 生成验收 SQL；
6. 逐行审阅全部 SQL；
7. 用户明确批准后才能执行。
