# Radar 公共结论存储规范化 v0.1

状态：公共数据计划修正阶段。本流程在业务审计与数据库物理存储之间建立一个确定性的 storage normalization 边界。

它不重新研究作品，不更改评级，不重新决定 canonical Work，也不执行生产 migration 或数据写入。

## 为什么需要独立的存储规范化层

最终全量审计中的 9,000 条公共结论使用来源时间：

```text
2026-07-14T18:11:01.252188+00:00
```

生成的 Payload/PostgreSQL 字段为：

```sql
timestamp(3) with time zone
```

该物理字段只保存三位小数，并按照数据库精度进行舍入。若直接写入六位微秒时间，数据库实际保存值会与来源 JSON 中参与 `conclusionSha256` 的值不同。

首次隔离演练因此在事务提交前触发：

```text
main row field mismatches: 9000
```

这不是 9,000 条评级错误，而是：

```text
结论哈希声明的六位时间
≠
数据库可保存的三位时间
```

只放宽验收会让哈希无法从数据库实际内容重算，因此禁止。

## 正确边界

```text
业务研究包
→ 全局业务审计
→ 公共发布候选
→ storage normalization
→ storage-ready 数据计划
→ schema/data review
→ isolated rehearsal
→ production gate
```

业务审计回答：

- 这条结论是否允许公开；
- 目标 canonical Work 是谁；
- 等级、证据与 publication guard 是否通过。

存储规范化回答：

- 该结论如何表示，才能与目标数据库字段逐字节/逐字段一致；
- 规范化后的实际存储内容对应什么 `conclusionSha256`。

两层不得混为一体。

## 活动入口

```text
scripts/radar/lib/public-conclusion-storage-v01.mjs
scripts/radar/build-radar-public-storage-normalization-v01.mjs
scripts/radar/run-and-package-radar-public-storage-normalization-v01.ps1
tests/radar-public-storage-normalization.test.mjs
```

## 固定输入

### 最终业务审计

```text
ALL-REMAINING-RADAR-GLOBAL-AUDIT-20260723-204835.zip
SHA-256 7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA
```

### 首次 schema review

```text
RADAR-PUBLIC-CONCLUSIONS-SCHEMA-REVIEW-20260723-221852.zip
SHA-256 297FED9AB54675748E5AE0DD812CFA4AC367966D12E7732541913223D74AC0FB
```

其中 schema migration 继续有效；只有旧数据计划被取代。

### 被拒绝的旧 ready 文件

```text
public-ai-ready.jsonl
rows    9000
SHA-256 95111C7A01FC5C56EFD58A9ED03A2C446EC831D1B6FE3CE6822A9BDFAFC1258F
```

该文件保留为业务审计证据，但禁止直接写入 `radar_public`。

### 首次失败隔离演练

```text
radar-public-conclusions-lab-rehearsal-20260723-231628
fresh backup bytes  27596786
fresh backup SHA-256 F44F647833B4A1EA39EA48EE71D59A5F707C0F8595734CE6A1871372BA7014DC
```

固定失败证据：

```text
freshBackupCreated            true
isolatedRestorePassed         true
schemaApplyPassed             false
dataRowsApplied               0
labContainerRemoved           true
sourceContainerTempFilesRemoved true
productionDatabaseWrite       false
apply error                    main row field mismatches: 9000
```

## 时间规范化算法

输入必须是带时区的 ISO-8601 instant，最多六位小数：

```text
YYYY-MM-DDTHH:mm:ss.ffffffZ
YYYY-MM-DDTHH:mm:ss.ffffff+HH:mm
```

处理顺序：

1. 解析不含小数的整秒与时区；
2. 将小数补齐到六位微秒；
3. 加 500 微秒后除以 1,000，模拟 `timestamp(3)` 毫秒舍入；
4. 处理进位到下一秒、分钟、日期；
5. 输出 UTC 三位毫秒格式：

```text
YYYY-MM-DDTHH:mm:ss.sssZ
```

示例：

```text
2026-07-14T18:11:01.252188+00:00
→ 2026-07-14T18:11:01.252Z

2026-07-14T18:11:01.252500Z
→ 2026-07-14T18:11:01.253Z

2026-07-14T18:11:01.999500Z
→ 2026-07-14T18:11:02.000Z
```

禁止简单字符串截断，因为大于或等于 500 微秒时数据库会进位。

## 哈希契约

原始结论哈希继续按以下规则验证：

```text
publicRecord 删除 conclusionSha256
→ 对象键递归排序
→ JSON.stringify
→ SHA-256
```

规范化前必须先确认旧哈希可重算。随后只允许修改：

```text
publicRecord.radarAssessment.assessedAt
publicRecord.conclusionSha256
```

规范化后的 `conclusionSha256` 必须从规范化后的实际可存储内容重新计算，并能再次重算得到同一值。

若除以上两个字段之外有任何差异，整包失败。

## 不变项

每一条记录必须保持：

- `publicationKey`；
- canonical Work ID 与 `workIdSnapshot`；
- `workSiteId`；
- 标题；
- `recordStatus` 与 `conclusionMode`；
- S/A/B/C/D/E/F 等级；
- best / likely / worst；
- rating notice；
- review reasons；
- evidence strength；
- Radar 置信度、覆盖率、证据状态、来源摘要、来源数量；
- policy version 与 assessment batch；
- decisive rule；
- matched rules 与 contradictions；
- source package ID/SHA；
- publication version；
- 全部 blocker 与 publication guard 决定。

固定等级分布仍为：

```text
S    8
A  267
B  675
C  868
D 7032
E  138
F   12
```

## 输出

```text
exports/radar-public-storage-normalization-<timestamp>/
exports/RADAR-PUBLIC-STORAGE-NORMALIZATION-<timestamp>.zip
```

主要文件：

```text
public-ai-storage-ready.jsonl
public-conclusions-storage-write-plan.jsonl
public-conclusion-storage-rewrite-map.jsonl
radar-public-storage-normalization-summary.json
storage-normalization-supersession.json
storage-normalization-run-validation.json
bound-failed-lab-stage-status.json
bound-failed-lab-apply-stderr.txt
manifest.json
```

### `public-ai-storage-ready.jsonl`

完整的 9,000 条 replacement 数据。保持原 `publicStatus`，并增加：

```text
storageStatus = ready_public_ai_storage_normalized
storageNormalizationVersion = radar-public-storage-normalization-v0.1
```

### rewrite map

每行记录：

```text
publicationKey
work / workIdSnapshot
oldAssessedAt
normalizedAssessedAt
oldConclusionSha256
newConclusionSha256
changedFields
```

它是旧业务结论与新实际存储记录之间的可审计桥梁。

## Supersession 规则

规范化包必须明确：

```text
business audit             retained
schema migration DDL       retained
old ready JSONL            superseded for writing
old schema-review data plan superseded
```

禁止说“整个审计失效”或“整个 schema review 失效”。失效范围只限旧数据表示与旧写入计划。

## 成功门槛

```text
rows                         9000
unique publication keys      9000
unique Work IDs              9000
unique old hashes            9000
unique new hashes            9000
business fields changed      false
assessedAt changed rows      9000
conclusion hash changed rows 9000
grade distribution           unchanged
old data plan superseded     true
business audit superseded    false
migration DDL superseded     false
production database write    false
production apply authorized  false
```

## 后续隔离演练

新的 lab runner 必须只接受：

```text
public-ai-storage-ready.jsonl
```

并拒绝旧 `public-ai-ready.jsonl`。

主字段验收必须继续比较实际数据库字段，不能忽略时间精度，也不能跳过 `conclusionSha256` 重算契约。

隔离演练通过后，production execution gate 才能绑定新的 normalized ready SHA-256、write-plan SHA-256、lab evidence ZIP 和 fresh backup SHA-256。

自然语言的“继续”“开始”“可以写入”不构成生产 apply 或 rollback 授权。

## 以后复用

所有未来 AI 增补批次都应在业务审计后执行目标存储规范化。任何进入结论哈希的字段，只要数据库会进行：

- 精度缩减；
- 时区规范化；
- 大小写或 Unicode 规范化；
- 数值 scale 舍入；
- 默认值填充；
- 空字符串与 `NULL` 转换；

都必须先转换成数据库实际会保存的形式，再计算公共结论哈希。

原则是：

> 哈希描述的必须是数据库能够真实保存并重新读出的公共结论，而不是写入前的临时表示。
