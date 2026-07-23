# Radar 公共 blocked inventory v0.1

状态：首次 9,000 条公共结论生产写入完成后，对剩余 1,805 条公共 blocked 建立只读、可追溯的修复账本。

## 目的

本阶段不修生产、不解除 blocker、不生成 production apply。它只回答：

- 1,805 条各自为什么 blocked；
- 当前生产私有 AI、公共 AI、人工轨道分别是什么状态；
- 是否存在多个候选版本；
- 哪一份是最新有效候选；
- 新旧结论在哪些字段冲突；
- 应进入自动格式修复、重新研究、人工裁决还是保留 blocked；
- 下一动作是什么。

## 固定证据

输入绑定：

```text
ALL-REMAINING-RADAR-GLOBAL-AUDIT-20260723-204835.zip
SHA-256 7877020D0314352531290BE0D4E334D2B17E18E6F552591DD14E30431F7837BA

RADAR-PUBLIC-CONCLUSIONS-PRODUCTION-APPLY-RECEIPT-20260724-010844.zip
SHA-256 D1E8114371926C1CDA07D91DD2DB730180D5830ACF691D7CCC6F65DE84CBE6CA
```

固定基线：

```text
source audit rows              10805
public blocked                  1805
private blocked                 1444
production Works               35615
published Works                35615
current public conclusions      9000
```

## Latest valid 规则

本 inventory 遵循：

```text
身份唯一
→ 结构完整
→ policyVersion、来源包和 assessmentBatch 可追溯
→ assessedAt 有效
→ grade、decisive rule 与 hash 结构有效
→ 非作废测试 assessment
→ 在满足以上条件的候选中选择 assessedAt 最新者
```

较新但无效、不完整或身份冲突的记录不会覆盖较旧但有效的候选。

每个候选都保存在 `history[]`；不允许把新旧对象做字段残留式拼接。新快照明确为空或 null 时，旧值不能偷偷补回。

## 冲突

差异分为：

- 非决定性：措辞、覆盖率、信心、来源摘要详略等；
- 决定性：grade、decisive rule、matched rules、contradictions、Work 身份或 publication guard。

决定性冲突不会被“时间更新”自动裁决。冲突双方、时间、来源、旧值和新值全部进入 conflict ledger，状态保持 blocked，直到新增来源或人工裁决解决。

## 当前快照读取

runner 启动一个专用 Next/Payload 只读服务，并重新读取：

```text
draft/latest Works
live/public Works
current radar-public-conclusions
```

数据库会强制：

```text
PAYLOAD_DB_PUSH=false
PGOPTIONS=-c default_transaction_read_only=on ...
```

因此 Payload 意外写请求也会被 PostgreSQL 拒绝。

## 分类

### A：自动格式修复

仅包含确定性的存储表示问题，例如时间精度、可复算 hash 或 null/default 规范化。不得在这一类中修改评级事实。

### B：重新研究

包含：

- 缺少 source summary；
- 需要两条可追溯来源；
- 研究字段不完整；
- 作废测试 assessment 必须从零重做。

### C：人工裁决

包含：

- canonical Work 身份冲突；
- grade、decisive rule 或 contradictions 的决定性冲突；
- publication guard 是否解除需要判断。

### D：保留 blocked

主要是当前 live lifecycle 或 visibility 不允许公开。研究历史继续保留，但不能仅靠补来源绕过生命周期。

## 输出

```text
radar-public-blocked-inventory.jsonl
radar-public-blocked-inventory.csv
radar-public-blocked-conflict-ledger.jsonl
radar-public-blocked-lane-automatic-storage-repair.jsonl
radar-public-blocked-lane-research.jsonl
radar-public-blocked-lane-human-review.jsonl
radar-public-blocked-lane-retained.jsonl
radar-public-blocked-inventory-summary.json
blocked-inventory-run-validation.json
manifest.json
```

主 inventory 每行包含：

```text
workId / sourceWorkId / publicationKey
siteId / title
privateStatus / publicStatus
privateBlockers / publicBlockers
humanTrack
latestDraftSnapshot / liveSnapshot
currentPublicRecord
selectedCandidate / selectedCandidateStatus
history[] / conflicts[] / supersessionCandidates[]
resolutionLane / repairClass / nextAction
sourceAuditRowSha256 / sourceAuditRow
```

CSV 用于人工浏览；JSONL 是后续自动修复和研究波次的唯一机器输入。

## 执行入口

```text
scripts/radar/build-radar-public-blocked-inventory-v01.mjs
scripts/radar/run-and-package-radar-public-blocked-inventory-v01.ps1
tests/radar-public-blocked-inventory.test.mjs
```

输出 ZIP：

```text
exports/RADAR-PUBLIC-BLOCKED-INVENTORY-<timestamp>.zip
```

## 安全边界

本阶段：

- 不 PATCH Works；
- 不写 `radar_public`；
- 不修改人工轨道；
- 不执行 migration；
- 不执行 schema push；
- 不生成 production apply；
- 不消费新的生产授权；
- 不把 blocked 自动改成 ready。

## 下一阶段

inventory 验收后，按实际统计决定：

```text
A 自动格式修复
B 重新研究
C 人工裁决
D 保留 blocked
```

所有 1,805 条完成研究和 ledger 收口后，再统一生成 `ready_create` / `ready_update`，统一做 storage normalization、数据级隔离演练和一次新的增量 production gate。
