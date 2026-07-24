# Radar 公共结论 production apply-once v0.1

状态：生产执行入口。该流程只接受已经通过 storage normalization、隔离往返演练和 production execution gate 的固定 9,000 条公共 AI Radar 结论。

## 独立授权

生产 apply 只接受完全一致的短语：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01
```

rollback 是另一项独立操作，本入口不接受 rollback 授权，也不会在任何失败后自动执行 rollback。

## 固定证据

```text
Storage normalization ZIP
642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E

Storage lab ZIP
EB3B1BCBE7B553471157BDED6B027F6850E3927AA9C1226AFFDC63B85EE69825

Production gate ZIP
C0FBEC5B62C3FC45072B9F235C5DF5FEA7462F564226EA7FDD3CE9C723E0E2B5
```

固定数据：

```text
public rows       9000
review reasons    9000
matched rules     9077
contradictions       0
Works            35615
existing tables     83
```

## 活动入口

```text
scripts/radar/execute-radar-public-conclusions-production-apply-once-v02.ps1
scripts/radar/execute-radar-public-conclusions-production-apply-once-v01.ps1
scripts/radar/build-radar-public-conclusions-production-apply-receipt-v01.mjs
tests/radar-public-conclusions-production-apply-runner.test.mjs
```

v02 只负责把已验收的 `public-ai-storage-ready.jsonl` 放到 gate SQL 锁定的容器路径：

```text
/tmp/public-ai-storage-ready.jsonl
```

它不改写 SQL，不 patch v01 源文件，结束时删除该临时输入。

## 生产维护窗口

runner 会：

1. 拒绝仓库内除 `next-env.d.ts`、`payload-types.ts` 外的本地修改；
2. 拒绝本仓库的本地 Node、Payload、Next、Python 等潜在 writer；
3. 找到 PostgreSQL 所属 Compose project；
4. 停止同 project 中除 PostgreSQL 外的运行中容器；
5. 连续两次确认生产数据库没有其他 client backend；
6. 任何提交前失败都会恢复原先运行的 writer 容器。

## 同窗口 fresh backup 与演练

生产事务之前必须重新完成：

```text
gate preflight
→ 83 表 gate baseline 零漂移
→ serializable-deferrable custom pg_dump
→ backup 前后 preflight 与 83 表计数一致
→ --network none PostgreSQL
→ 完整 pg_restore
→ preflight 2 / 2
→ exact apply
→ acceptance 22 / 22
→ Radar 表 9000 / 9000 / 9077 / 0
→ exact rollback
→ post-rollback 17 / 17
→ 83 表 baseline 完整恢复
```

同窗口完整 dump 只保存在用户本地，不进入 receipt ZIP。

## 生产 apply

只有上面的同窗口演练通过后，runner 才会重新检查：

```text
radar_public absent
Works = 35615
83 张原业务表与 gate baseline 完全一致
没有其他数据库 client backend
```

随后执行 gate 中哈希锁定的：

```text
production-apply.sql.disabled
SHA-256 61F5673A2727D2FDE63590A1A74C2A26C5CFB2EACFA7AE27078F9CD999048DDA
```

该 SQL 在一个 serializable 事务中创建 `radar_public*` 结构并写入 9,000 条结论。SQL 内部会在 `COMMIT` 前比较主字段、review reasons、matched rules 和 contradictions。

## 提交后验收

提交后必须通过：

- 22 / 22 独立只读 acceptance；
- 9,000 个唯一 publication key；
- 9,000 个唯一 Work ID；
- 9,000 个唯一 conclusion hash；
- 等级分布完全一致；
- 0 个子表孤儿行；
- 原有 83 张表行数全部不变；
- 新表精确为：

```text
radar_public                                        9000
radar_public_review_reasons                         9000
radar_public_radar_assessment_matched_rules         9077
radar_public_radar_assessment_contradictions           0
```

验收全部通过后才恢复 writer 容器并生成最终 receipt。

## 失败策略

### 提交前失败

- 不存在生产提交；
- 自动恢复原先停止的 writer；
- 保留 fresh backup 与失败证据；
- 不执行 rollback。

### 提交后、验收前失败

- writer 保持暂停；
- 保存 `production-apply-failure.json`；
- 保留 fresh backup；
- 明确记录 `rollbackAutomaticallyExecuted = false`；
- 只有用户另行发送独立 rollback 精确授权后，才允许准备 rollback 执行。

### 提交与验收均成功、但证据打包失败

生产状态保持已验收状态，writer 会恢复；修复证据包时不得再次运行 apply，因为 preflight 会发现 `radar_public` 已存在。

## Receipt

本地目录：

```text
exports/radar-public-production-apply-<timestamp>/
```

上传证据：

```text
exports/RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-APPLY-RECEIPT-<timestamp>.zip
```

核心内容：

```text
production-apply-receipt.json
production-apply-receipt.sha256.txt
production-apply-summary.json
production-apply-stage-status.json
production-apply-metadata.json
post-apply-table-count-diff.json
production-acceptance-stdout.txt / stderr.txt
production-pre-backup-*.txt
production-post-backup-*.txt
fresh-lab-*.txt
writer-restart-status.json
manifest.json
```

完整 `database-backup.dump` 留在本地并从 manifest 与 ZIP 中排除。

## 不包含的权限

本授权不包含：

- production rollback；
- PR merge；
- Payload PATCH；
- Payload migration command；
- Works 发布；
- 人工或私有 AI 字段修改；
- 任何其他数据清理或 schema 变更。

## 2026-07-24 实际生产执行记录

本入口已经成功执行一次；V01 apply 授权视为已消费，不得用于后续增补批次。

```text
Execution ID
radar-public-production-apply-20260724-010844

Production receipt ZIP
RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-APPLY-RECEIPT-20260724-010844.zip
SHA-256 D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA

Production apply receipt core
SHA-256 e7db5ebc80c668b8c26a0dcb26e20790500e7283af4c59a3a24338864442a1d9

Fresh production backup
SHA-256 e6190015a3567ab3887e0622fb7172184accb78e77f53f81c138465d97a16c9d
```

验收结果：

```text
production schema applied       true
production public rows          9000
production acceptance           22 / 22
existing production tables      83 unchanged
radar_public                     9000
radar_public_review_reasons      9000
matched rules                    9077
contradictions                      0
writer containers restarted     true
Payload migration command       false
Payload write                    false
PR merge                         false
implicit rollback                false
```

Receipt ZIP 的 manifest 共 48 项并全部匹配。完整 fresh dump 继续只留在本地。

## 首次执行后的增补边界

首次建表和 9,000 条公共写入成功后，后续批次不得再次运行本入口，也不得重用 V01 授权。

后续流程改为：

```text
重新研究 blocked 行或接收新研究包
→ 读取当前私有 AI 与 radar_public
→ 分类 ready_create / ready_update / already_current / blocked
→ 只对 ready_create / ready_update 做 storage normalization
→ 数据级隔离演练
→ 新 production gate
→ 新版本精确授权
→ 增量 create / supersede
```

只有公共集合的字段、约束、索引或 enum 发生变化时才重新生成 schema migration。现有 9,000 条记录应作为 `already_current` 保留，不得为了方便而全量重写。
