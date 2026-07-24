# Radar 统一 1,804 条生产只读执行门 v0.1

状态：仅用于生产执行前的只读 exact-before gate；不包含生产 apply 能力。

## 目标

该 gate 将已验收的以下产物重新绑定到当前不可变代码提交与当前生产状态：

- 1,804 条统一 storage-normalized assembly；
- 1,804 条隔离 apply / acceptance / exact rollback 证据；
- 当前 PR #311 的精确 commit SHA；
- 当前生产数据库的完整 Radar 指纹、sequence 与全部 public 表计数；
- 同一检查窗口内创建的新 fresh `pg_dump`。

## 固定输入

- Assembly ZIP SHA-256：
  `53AD4CD92D5A7186B7D52A5BDC8D6E714573E7C9CC17559D8BF96CD2D194B8B9`
- 隔离 lab evidence ZIP SHA-256：
  `38AF33DCE50F0536A951D6EED26E85C3E9EA45A251F53588D5AB5E2E8772351C`
- 生产基线：9,000 条 current public AI conclusions；
- 计划 create：1,804 条；
- 隔离 apply 后预期：10,804 条。

## Gate 行为

1. 锁定 branch、local HEAD 与 remote HEAD；
2. 校验两个输入 ZIP 的 SHA-256、CRC 之外的 manifest 全覆盖与逐文件 hash；
3. 重算并核对 assembly storage-ready 文件 hash；
4. 核对 lab summary、SQL plan 与八份 SQL 的 SHA-256；
5. 确认此前 production pre/post/final 三组基线证据完全一致；
6. 只向源 PostgreSQL 容器复制三份只读 SQL和一份动态全表计数 SQL；
7. 在 `default_transaction_read_only=on` 下运行 exact-before；
8. 要求当前输出与已验收 production-final 基线完全一致；
9. 创建同窗口 fresh custom-format `pg_dump`；
10. 用 `--network none` 的一次性容器执行 `pg_restore --list`；
11. backup 后重新运行所有只读检查；
12. 要求 backup 前后、已验收基线三者完全一致；
13. 生成不包含 database dump、apply SQL 或 rollback SQL 的小型证据 ZIP。

## 明确禁止

Gate 不会：

- 执行 `incremental-apply.sql.lab-only`；
- 执行 `incremental-rollback.sql.lab-only`；
- 写入 `radar_public` 或其子表；
- 调用 Payload；
- 执行 migration 或 schema push；
- 创建 production execution authorization；
- 把 gate 通过解释成生产写入授权。

## 通过后的含义

通过只表示：

- 当前生产仍等于已验收的 9,000 条基线；
- 1,804 条输入和 SQL 计划仍与已验收证据一致；
- fresh backup 已创建且 archive 可读取；
- 可以制作一个独立、显式授权、默认不可执行的 production execution package。

实际生产录入仍需：

1. 上传并独立验收 gate evidence ZIP；
2. 生成新的生产执行包；
3. 核对执行包 SHA-256；
4. 用户输入独立的最终授权短语；
5. 执行器在同一事务内再次 exact-before；
6. apply 后逐项 acceptance；
7. 生成不可变 receipt；
8. 保留独立 rollback 包与授权。
