# Radar 公共结论 storage-normalized 隔离演练与 production gate v0.1

状态：生产写入前最后准备阶段。

本流程消费已经验收的 storage-normalization replacement 包，在一次性、无网络 PostgreSQL 中完成 schema 与 9,000 条公共 AI 结论的真实写入、验收、精确回滚和 baseline 恢复。演练通过后自动生成 production execution gate，但不执行生产 DDL/DML。

## 固定输入

### Storage normalization

```text
RADAR-PUBLIC-STORAGE-NORMALIZATION-20260724-000639.zip
SHA-256 642E43B9CBAC02C75D2D473293C7B57B8B0197594262DFA96B065015E89C135E
```

内部固定产物：

```text
public-ai-storage-ready.jsonl
rows    9000
SHA-256 BDA8429DFCF6DBCAAEB90199AC1697196B308013F65DF546F20B46167B49A220

public-conclusions-storage-write-plan.jsonl
rows    9000
SHA-256 72191D11AC163AA09F927353E64B3BDC22D74963D7436A4BF790CE30EE39BC39

public-conclusion-storage-rewrite-map.jsonl
rows    9000
SHA-256 1CFF56EB78482C0A5A6BF714E617E8C00A5F90CC1866B76D9081E8BD10DECCFD
```

### Retained schema review

```text
RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-20260723-221852.zip
SHA-256 297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB
migration commit 3ea530cb342bfab5c126e94498d2d94c98413aa0
```

Storage normalization 只 supersede 旧数据计划；业务审计与 migration DDL 继续保留。

## 活动入口

```text
scripts/radar/build-radar-public-conclusions-storage-lab-sql-v01.mjs
scripts/radar/run-and-package-radar-public-conclusions-storage-lab-and-gate-v01.ps1
scripts/radar/run-and-package-radar-public-conclusions-storage-lab-and-gate-v02.ps1
tests/radar-public-conclusions-storage-lab-and-gate.test.mjs
```

用户运行 v02。v02 调用 v01 的数据库演练逻辑，并负责最终 evidence manifest 与 gate SHA 绑定。

## 单次流水线

```text
验证 storage ZIP、schema ZIP 与 manifest
→ 验证 9,000 条实际存储内容可复算 conclusion hash
→ 验证 storage plan 与 rewrite map 一一对应
→ 生产只读 preflight：radar_public absent、Works = 35615
→ backup 前业务表计数
→ serializable-deferrable fresh pg_dump
→ backup archive list 校验
→ backup 后业务表计数并要求完全一致
→ --network none 一次性 PostgreSQL
→ 完整 restore
→ 恢复库业务表计数与生产 baseline 完全一致
→ schema + 9,000 条 storage-normalized apply
→ 主字段和三类数组子表事务内 exact comparison
→ 独立只读 post-apply acceptance
→ 非 Radar 表集合和行数不变
→ exact rollback
→ Radar 表与 enum 全部消失
→ baseline 完整恢复
→ 删除隔离容器与生产容器临时文件
→ lab evidence ZIP
→ production execution gate ZIP
```

## 数据与结构边界

允许在隔离库中创建、写入和删除：

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
- 其他非 Radar 业务表；
- 生产 PostgreSQL 或 Payload。

## Evidence ZIP 与完整 backup

完整 fresh dump 只保存在本地：

```text
exports/radar-public-conclusions-storage-lab-<timestamp>/database-backup.dump
```

lab evidence ZIP 明确排除该 dump。v02 会在排除后重新生成 manifest 和 ZIP，再把最终 lab ZIP SHA 回填到 production gate summary，最后重建 gate manifest 和 ZIP。

因此下面两个条件必须同时成立：

```text
lab manifest 不引用 database-backup.dump
gate summary 的 labEvidenceBundleSha256 等于最终 lab ZIP SHA-256
```

## Production execution gate

Gate 包含：

```text
production-preflight.sql
production-apply.sql.disabled
production-acceptance.sql
production-rollback.sql.disabled
production-post-rollback-acceptance.sql
radar-public-storage-lab-plan-summary.json
radar-public-conclusions-storage-lab-summary.json
production-baseline-table-counts.tsv
radar-public-conclusions-production-gate-summary.json
manifest.json
```

Gate 没有生产执行 wrapper。`production-apply.sql.disabled` 与 `production-rollback.sql.disabled` 只是不可变审阅输入。

## 授权边界

隔离演练确认：

```text
RUN-ISOLATED-RADAR-PUBLIC-CONCLUSIONS-STORAGE-LAB-V01
```

生产 apply：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-APPLY-V01
```

生产 rollback：

```text
AUTHORIZE-PRODUCTION-RADAR-PUBLIC-CONCLUSIONS-ROLLBACK-V01
```

三者互不替代。自然语言的“继续”“开始”“一口气做完”只允许进入隔离演练与 gate 生成，不批准生产 apply，也不批准 rollback。

## 成功门槛

```text
storage rows                  9000
unique publication keys      9000
unique Work IDs               9000
unique new hashes             9000
post-apply checks             all / all
post-rollback checks          all / all
non-Radar table counts        unchanged
baseline restored             true
lab container removed         true
production radar schema       absent
production database write     false
production rows written       0
production apply authorized   false
rollback authorized           false
```

演练与 gate 通过后，保留本地 fresh backup，只上传 lab evidence ZIP 与 production gate ZIP。随后才能构建并运行绑定 gate SHA 的 production apply-once 入口。
