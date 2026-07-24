# Radar 公共结论 schema review v0.1

状态：schema review 已生成并通过本地门槛，尚未执行生产 migration 或公共结论写入。该流程绑定已经通过的全量剩余 Radar 唯一审计，为 9,000 条公共 AI 结论生成独立的 Radar-only 加法 migration、禁用态 SQL 和不可变写入清单。

## 固定输入

```text
ALL-REMAINING-RADAR-GLOBAL-AUDIT-20260723-204835.zip
SHA-256 7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA
```

绑定的审计结论：

```text
source rows                         10805
private ready                           0
private already current              9361
private blocked                      1444
public ready                         9000
public already current                  0
public blocked                       1805
global blockers                        0
ready for single execution planning  true
```

`public-ai-ready.jsonl` 固定 SHA-256：

```text
95111C7A01FC5C56EFD58A9ED03A2C446EC831D1B6FE3CE6822A9BDFAFC1258F
```

## 活动入口

当前活动入口是完整、静态、可直接 parser 检查的脚本：

```text
scripts/radar/prepare-radar-public-conclusions-migration-v05.ps1
scripts/radar/run-and-package-radar-public-conclusions-schema-review-v05.ps1
```

旧 v02/v03/v04 wrapper 保留作历史证据，但不得再作为活动入口。活动路径禁止运行时修改旧脚本，也禁止把临时 wrapper 写进 Git 工作区。

## 本阶段允许的动作

- 使用 `payload migrate:create` 读取当前 schema 并生成 migration；
- 生成一个空操作的当前 schema baseline migration；
- 生成唯一的 `radar_public_conclusions_v01` migration；
- 抽取 migration 的 exact up/down SQL，并保存为 `.sql.disabled`；
- 从审计 ZIP 生成 9,000 行不可变写入清单；
- 生成 SHA-256 manifest 和 schema review ZIP；
- review ZIP 完整后才把 migration commit 推送到 PR #311 分支。

本阶段禁止：

- 执行 `payload migrate`；
- 生产 PostgreSQL DDL 或 DML；
- Payload Works PATCH；
- 私有 AI 或人工轨道写入；
- schema push；
- PR merge；
- rollback 执行；
- 把自然语言“继续”或“可以写入”解释为 production apply 授权。

## 数据库只读门槛

`migrate:create` 可能连接当前生产数据库做 schema introspection。活动 runner 同时设置：

```text
PAYLOAD_DB_PUSH=false
PGOPTIONS=-c default_transaction_read_only=on ...
PostgreSQL pool options=default_transaction_read_only=on
```

因此证据包记录：

```text
ProductionDatabaseConnect       true
ProductionDatabaseSessionReadOnly true
ProductionDatabaseWrite         false
```

这不是仅依赖命令习惯的“逻辑只读”，而是由 PostgreSQL 会话拒绝写入。

## 结构门槛

生成的 migration 必须：

- 创建主表 `radar_public`；
- 仅创建、修改或删除 `radar_public*` 表；
- enum 名称全部以 `enum_radar_public` 开头；
- 不修改 `works`、`_works_v` 或 `payload_locked_documents_rels`；
- 不出现人工字段、`legacy_x_wiki_page` 或 Work 数据写入；
- baseline TypeScript migration 必须为空操作；
- baseline snapshot 不得包含 `radar_public`；
- Radar snapshot 必须包含 `public.radar_public`。

## 数据门槛

9,000 条 ready 记录必须同时满足：

- `publicStatus = ready_public_ai_after_schema`；
- `publicBlockers` 与兼容 `blockers` 均为空；
- `publicationKey = work:<Work ID>`；
- `work = workIdSnapshot`；
- publication key、Work ID 与 conclusion SHA-256 各自唯一；
- ready 文件 SHA-256 与审计 manifest 一致。

本阶段只输出轻量写入清单，不复制完整的 public-ready JSONL。实际执行仍从本地固定审计 ZIP 读取完整记录。

## 提交与失败恢复顺序

安全顺序：

```text
生成 5 个 migration 文件
→ 本地 commit
→ 绑定 9,000 行与 exact SQL
→ 完成 manifest 和 review ZIP
→ 最后 push migration commit
```

push 前任一步失败时：

- `git reset --mixed` 回到起始 HEAD；
- 删除本轮生成的 migration 文件；
- 删除不完整输出目录和 ZIP；
- 不在远端留下半成品 commit。

## 本次成功结果

migration commit：

```text
3ea530cb342bfab5c126e94498d2d94c98413aa0
```

生成文件：

```text
src/migrations/20260723_141905_current_schema_baseline_before_radar_public_v01.ts
src/migrations/20260723_141905_current_schema_baseline_before_radar_public_v01.json
src/migrations/20260723_141908_radar_public_conclusions_v01.ts
src/migrations/20260723_141908_radar_public_conclusions_v01.json
src/migrations/index.ts
```

schema review 包：

```text
RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-20260723-221852.zip
SHA-256 297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB
```

成功门槛：

```text
PublicReadyRows           9000
UniquePublicationKeys     9000
UniqueWorkIds             9000
PostgreSQLSessionReadOnly true
RemotePushAfterReview     true
SchemaGenerated           true
SchemaReviewed            false
LabRehearsed              false
ProductionMigrationRun    false
ProductionRowsWritten     0
ProductionWriteAuthorized false
RollbackAuthorized        false
```

## 输出

```text
exports/radar-public-conclusions-schema-review-<timestamp>/
exports/RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-<timestamp>.zip
```

主要文件：

```text
radar-public-conclusions-schema-review-summary.json
schema-review-run-validation.json
public-conclusions-write-plan.jsonl
radar-public-schema-up.sql.disabled
radar-public-schema-down.sql.disabled
<baseline migration>.ts / .json
<Radar migration>.ts / .json
bound-global-audit-summary.json
bound-global-audit-manifest.json
migration-commit-files.txt
migration-generation.log
manifest.json
```

## 授权边界

生成 schema review 包不构成生产写入授权。

生产 apply 只接受完全一致的独立短语：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01
```

rollback 需要另一条完全一致的短语：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01
```

此前 Test Work merge 的授权不适用于本次 9,000 条公共结论写入。上述 production apply 短语只有在隔离恢复库往返演练和 production gate 包都通过后才会被接受。

## 后续

schema review ZIP 验收后，下一包会在隔离恢复库中完成：

```text
exact schema apply
→ 9,000 条公共结论写入
→ 结构与行级 acceptance
→ rollback 往返演练
→ baseline 完整恢复验证
```

隔离演练通过后才生成 production apply-once runner。production runner 仍会在同一维护窗口重新创建 fresh backup 并完整恢复验证。
