# Radar blocked 最新快照覆盖与历史保留策略 v0.2

状态：用于首次 9,000 条公共结论之后，对剩余 1,805 条公共 blocked / 1,444 条私有 blocked 进行统一修复。

## 目标

同一作品的 AI Radar 数据只保留一份 current 快照。为了避免修复流程长期停在冲突裁决上，当前规则改为：

```text
current = 身份确定且结构有效的最新 AI 快照
history = 所有旧快照、来源、哈希、冲突与替换关系
```

只要 canonical Work 身份确定、记录结构可解析且 assessedAt 有效，最新的结构有效快照直接胜出。

## 最新快照覆盖规则

同一作品出现多份 AI 快照时：

1. 排除身份未确定、作废测试、时间无效或结构损坏的候选；
2. 在剩余候选中按 assessedAt 选择最新记录；
3. assessedAt 相同时，依次比较 policyVersion、assessmentBatch 和稳定 candidate SHA-256；
4. 新快照整体覆盖旧 AI 快照；
5. 数组、对象和可选字段全部以新快照为准；
6. 新快照明确为空或 null 时，旧值必须清空；
7. 禁止从旧快照补回新版未保留的字段。

这意味着较旧但字段更完整的 AI 快照，不能反过来覆盖更新的结构有效快照。新版字段不完整时，可以继续保留相应 evidence 或 publication blocker，但 current 候选仍指向新版。

## 冲突处理

等级、规则和措辞冲突不再阻止最新快照成为 current。

例如：

```text
旧记录：A，assessedAt = 2026-07-01
新记录：B，assessedAt = 2026-07-20
```

处理结果：

```text
current = 2026-07-20 的 B
history = 旧 A + 新 B + 差异说明
```

冲突只进入历史账本，不再要求逐条人工裁决后才能选择 current。

需要保留的内容包括：

- 旧 grade 与新 grade；
- 旧 decisive rule 与新 decisive rule；
- 双方 sourceSummary、matchedRules 与 contradictions；
- assessedAt、policyVersion、assessmentBatch；
- candidate SHA-256 与 conclusion SHA-256；
- supersededBy / supersedes 关系。

## 仍然保留的硬门槛

“大胆覆盖”只处理 AI 内容版本冲突，不绕过以下硬错误：

- canonical Work 身份尚未确定；
- 明确标记为 discarded test assessment；
- assessedAt 无效；
- JSON 或记录结构损坏；
- grade、policyVersion、assessmentBatch 或 decisive rule 无法形成可解析快照；
- Work 已归档、不可见或不存在 live snapshot；
- 有效人工结论保护。

这些情况继续 blocked，直到产生新的结构有效记录或合法的 Work 状态变化。

## Publication guard

publication guard 与 AI 内容冲突分开处理：

- grade / rule 冲突由最新快照直接覆盖；
- lifecycle、visibility、live snapshot 和 canonical identity 问题仍按真实当前状态处理；
- 增加来源不能自动解除归档、隐藏或身份错误；
- guard 解除后，直接使用已经选出的最新结构有效快照，不回滚到旧版本。

## 人工与 AI 优先级

本策略只处理 AI 轨道内部版本：

```text
有效人工结论
→ current 公共 AI
→ unknown
```

最新 AI 不覆盖人工字段。人工与 AI 的不同结论可以同时保留，但展示仍由有效人工结论优先。

## 私有与公共轨道

- 私有 AI 可以先采用最新结构有效快照；
- 公共 AI 继续检查 live snapshot、catalogStatus 与 visibility；
- 私有 current 不自动代表公共可见；
- 公共 blocked 不删除私有研究历史；
- 后续公共增量只 create / supersede 真正通过非冲突发布门槛的记录。

## Ledger 必备字段

每个 Work 至少保存：

```text
workId
publicationKey
title
selectedCandidate
selectedCandidateStatus
selectedCandidateSelectionOrder
latestStructurallyValidIdentityResolvedWins
decisiveConflictsOverwrittenByLatest
remainingNonConflictBlockers
history[]
conflicts[]
supersessionCandidates[]
finalRemediationStatus
```

## 作废测试结论

已作废测试 assessment 永远不能通过“最新覆盖”复活：

- 必须生成新 batch；
- 必须重新建立来源和 evidence；
- 必须生成新 assessedAt 与新 hash；
- 旧测试记录只保留在 history 中。

## 生产边界

当前 1,805 条流程仍先生成只读 inventory、ledger 和 250 条研究波次：

- 不修改现有 9,000 条公共记录；
- 不写生产 Payload；
- 不写生产 PostgreSQL；
- 不在 inventory 阶段生成生产授权；
- 完成研究、storage normalization、隔离演练与新 production gate 后，才执行增量 create / supersede。

入口：

```text
scripts/radar/run-and-package-radar-public-blocked-inventory-v03.ps1
```
