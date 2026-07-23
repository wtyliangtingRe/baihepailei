# Radar 公共结论隔离恢复库往返演练 v0.1

状态：隔离演练阶段。本流程把已经通过的全量审计与 schema review 恢复到一次性、无网络 PostgreSQL 容器中，执行首次 `radar_public` schema 与 9,000 条公共 AI 结论写入，再执行只读 acceptance、精确 rollback 和 baseline 恢复验证。

该流程不会执行生产 migration，不会向生产数据库写入，也不构成 production apply 授权。

## 固定输入

### 最终全量审计

```text
ALL-REMAINING-RADAR-GLOBAL-AUDIT-20260723-204835.zip
SHA-256 7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA
```

固定结论：

```text
source rows             10805
private already current  9361
private ready                0
private blocked           1444
public ready              9000
public blocked            1805
global blockers              0
```

### Schema review

```text
RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-20260723-221852.zip
SHA-256 297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB
```

绑定 migration commit：

```text
3ea530cb342bfab5c126e94498d2d94c98413aa0
```

固定 ready 文件：

```text
public-ai-ready.jsonl
rows    9000
SHA-256 95111C7A01FC5C56EFD58A9ED03A2C446EC831D1B6FE3CE6822A9BDFAFC1258F
```

## 演练确认字符串

隔离演练只接受：

```text
RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-LAB-V01
```

该字符串只批准一次性隔离容器写入，不批准生产 DDL/DML，也不批准 PR merge。

生产 apply 与 rollback 仍分别要求独立、完全一致的授权短语。

## 活动入口

```text
scripts/radar/build-radar-public-conclusions-lab-sql-v01.mjs
scripts/radar/build-radar-public-conclusions-lab-sql-v02.mjs
scripts/radar/run-and-package-radar-public-conclusions-lab-rehearsal-v02.ps1
tests/radar-public-conclusions-lab-rehearsal.test.mjs
```

v02 SQL builder 运行 v01 的确定性计划生成后，对生成 SQL 做结构校正与再次验证；它不改写仓库源文件，不在运行时 patch PowerShell runner。

## 演练顺序

```text
验证两个 ZIP、manifest、行数与 SHA-256
→ 确认生产仍无 radar_public，Works = 35615
→ 读取生产非 Radar 业务表行数
→ 创建 fresh custom-format pg_dump
→ 启动 --network none 一次性 PostgreSQL 容器
→ 完整恢复 fresh dump
→ 比较生产与恢复库的非 Radar 表集合和行数
→ serializable schema apply + 9000 行写入
→ 主表、数组子表、等级、哈希集合与孤儿行 acceptance
→ 确认全部非 Radar 表行数未变化
→ serializable exact rollback
→ 确认 Radar 表与 enum 全部消失
→ 确认 baseline 非 Radar 表集合和行数完整恢复
→ 删除隔离容器与生产容器临时文件
→ 生成小型 evidence ZIP
```

## 数据写入范围

隔离 apply 只允许创建并写入：

```text
radar_public
radar_public_review_reasons
radar_public_radar_assessment_matched_rules
radar_public_radar_assessment_contradictions
enum_radar_public*
```

禁止修改：

- `works`；
- `_works_v`；
- `payload_locked_documents_rels`；
- 人工 `humanAssessment`；
- 私有 Work `radarAssessment`；
- 其他业务表；
- 生产 Payload 或 PostgreSQL。

## 9,000 行数据门槛

每条输入必须：

- `publicStatus = ready_public_ai_after_schema`；
- `publicBlockers` 与兼容 `blockers` 均为空；
- `publicationKey = work:<canonical Work ID>`；
- `work = workIdSnapshot`；
- publication key、Work ID、conclusion SHA-256 各自唯一；
- 来源文件 SHA-256 与最终审计 manifest 一致。

固定等级分布：

```text
S    8
A  267
B  675
C  868
D 7032
E  138
F   12
```

## Apply 内部验收

写入事务在 `COMMIT` 前比较：

- 所有主表字段与输入 `publicRecord`；
- review reasons 的顺序和值；
- matched rules 的顺序、ID、代码、等级、置信度和说明；
- contradictions 的顺序、ID 与内容。

任何 mismatch 都会使整个隔离事务失败。

## Post-apply acceptance

只读 acceptance 至少验证：

- 主表总数 = 9,000；
- publication key / Work ID / conclusion hash 唯一数均为 9,000；
- current、package 行数均为 9,000；
- 等级分布完全一致；
- review reasons、matched rules、contradictions 数量一致；
- publication key、Work ID、conclusion hash 排序集合摘要一致；
- 三类子表不存在孤儿行；
- 所有非 Radar 业务表集合和行数与恢复 baseline 一致。

## Rollback acceptance

rollback 后必须：

- 4 张 `radar_public*` 表全部不存在；
- 所有 `enum_radar_public*` 类型全部不存在；
- 非 Radar 业务表集合和行数与 apply 前恢复 baseline 完全一致；
- 隔离容器删除；
- 生产容器临时 dump 与计数 SQL 删除。

## Fresh backup

本阶段会读取生产库并创建一份 fresh dump，用于本轮隔离恢复：

```text
exports/radar-public-conclusions-lab-rehearsal-<timestamp>/database-backup.dump
```

完整 dump：

- 只保存在用户本地；
- 不进入 evidence ZIP；
- 不上传到公开仓库；
- 本轮演练后应继续保留，直到 production execution gate 验收完成。

生产数据库只被读取；所有 schema 和数据写入仅发生在 `--network none` 的隔离容器中。

## 输出

```text
exports/radar-public-conclusions-lab-rehearsal-<timestamp>/
exports/RADAR-PUBLIC-CONCLUSIONS-LAB-REHEARSAL-<timestamp>.zip
```

主要证据：

```text
radar-public-conclusions-lab-rehearsal-summary.json
lab-stage-status.json
lab-sql/radar-public-lab-plan-summary.json
lab-sql/radar-public-lab-apply.sql.lab-only
lab-sql/radar-public-lab-acceptance.sql
lab-sql/radar-public-lab-rollback.sql.lab-only
lab-sql/radar-public-lab-post-rollback-acceptance.sql
production-pre-table-counts.tsv
lab-baseline-table-counts.tsv
lab-post-apply-nonradar-table-counts.tsv
lab-post-rollback-table-counts.tsv
apply-stdout.txt / stderr.txt
acceptance-stdout.txt / stderr.txt
rollback-stdout.txt / stderr.txt
post-rollback-acceptance-stdout.txt / stderr.txt
manifest.json
```

只有 evidence ZIP 存在、SHA-256 已输出、manifest 完整匹配时，才视为证据包完成；本地中间状态文件不能替代最终 ZIP。

## 成功门槛

```text
PublicRowsApplied         9000
PostApplyChecks           all / all
PostRollbackChecks        all / all
BaselineRestored          true
SourceTempFilesRemoved    true
LabContainerRemoved       true
ProductionDatabaseWrite   false
ProductionMigrationRun    false
PayloadWrite              false
LabDatabaseWrite          true
ProductionApplyAuthorized false
```

## 演练后

隔离演练通过后仍不直接执行生产写入。下一阶段生成 production execution gate，绑定：

- 最终审计 ZIP；
- schema review ZIP；
- migration commit；
- 本轮 lab evidence ZIP；
- fresh backup SHA-256；
- exact apply / rollback / acceptance SQL；
- 当前生产 schema 与行级 preflight；
- apply 与 rollback 的不同授权短语。

自然语言的“继续”“可以写”“开始吧”只允许进入准备或隔离演练，不构成 production apply 授权。
