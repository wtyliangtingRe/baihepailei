# Radar blocked 最新有效记录与冲突保留策略 v0.1

状态：用于首次 9,000 条公共结论之后，对剩余 1,805 条公共 blocked / 1,444 条私有 blocked 进行统一修复。

## 目标

同一作品的 AI Radar 数据只保留一份 current 快照，但不删除任何历史来源、旧结论或冲突证据。

```text
current = 最新、有效、完整、身份确定的同轨道记录
history = 所有旧记录、来源、哈希、替换关系和冲突
```

“最新”不能单独凌驾于有效性、完整性和身份门槛之上。

## 整体替换，不做字段残留式拼接

同一作品出现新完整记录时：

- 新快照整体替换旧 AI 快照；
- 数组、对象和可选字段全部以新快照为准；
- 新快照明确为空或 null 时，旧值必须清空；
- 不从旧记录偷偷补回新记录已经删除的字段；
- 新旧来源与差异保存在 history / conflict ledger，不混进 current 快照。

这样可以避免“表面是新版，内部还残留旧数组或旧判断”的混合记录。

## Current 选择顺序

候选记录按以下门槛选择：

1. canonical Work 身份唯一且一致；
2. 记录结构完整并通过 parser / schema 校验；
3. policyVersion、来源包和 assessmentBatch 可追溯；
4. assessedAt 为有效时间；
5. conclusion hash 可以从记录内容复算；
6. 没有作废测试 assessment 标记；
7. 不存在阻止该轨道使用的 blocker；
8. 在满足以上条件的候选中，选择 assessedAt 最新者；
9. assessedAt 相同时，使用明确的 batch/version 顺序与稳定 hash 决胜，禁止依赖文件修改时间。

因此：

```text
更新但无效 / 不完整 / 身份冲突
不会覆盖
较旧但有效完整的 current
```

## 冲突处理

### 不影响结论的冲突

例如措辞差异、来源描述详略、非决定性元数据差异：

- 最新有效完整快照可成为 current；
- 差异进入 `non_decisive_conflicts`；
- 旧值、旧来源和旧 hash 保留。

### 影响等级、规则或身份的冲突

例如：

- 来源对关系结局说法相反；
- 新旧 grade 或 decisive rule 不一致；
- Work 身份、系列成员或版本归属不一致；
- publication guard 是否解除存在分歧；
- 新来源比旧来源更晚，但可靠性不足。

处理规则：

- 不以“时间较新”自动裁决事实真假；
- 两方证据都写入 contradictions；
- current candidate 可以指向最新研究快照，但状态保持 blocked；
- 只有冲突得到来源或人工判定解决后，才可进入 public ready；
- 解决记录必须说明胜出值、被替代值、理由和证据。

## 人工与 AI 优先级

本策略只处理 AI 轨道内部版本：

```text
有效人工结论
→ current 公共 AI
→ unknown
```

新 AI 不得覆盖有效人工字段；人工与 AI 的分歧继续可见。

## 私有与公共轨道

- 私有 AI current 可以比公共 AI 更早更新；
- 公共发布仍需独立 publication guard、live snapshot、catalogStatus 与 visibility 门槛；
- 私有 current 不代表公共 ready；
- 公共 blocked 不回滚或删除私有研究历史。

## Ledger 必备字段

每个 Work 至少保存：

```text
workId
publicationKey
title
currentCandidateSha256
currentCandidateAssessedAt
currentCandidateStatus
privateBlockers
publicBlockers
resolutionLane
history[]
conflicts[]
supersedes[]
nextAction
```

每个 history 项至少包含：

```text
sourcePackage
policyVersion
assessmentBatch
assessedAt
conclusionSha256
sourceRowSha256
status
blockers
```

## 作废测试结论

已作废测试 assessment：

- 永远不能通过改 Work ID、改标题或 remap 重新成为 current；
- 必须生成新 batch、新来源、新 assessedAt、新 evidence 与新 hash；
- 旧测试记录继续保留在 history，并标记为 discarded。

## 生产边界

1,805 条会先全部进入 blocker/conflict ledger 和研究波次。

在全部条目收口之前：

- 不写生产 `radar_public`；
- 不修改现有 9,000 条；
- 不生成新的 production apply 授权；
- 不把 blocked 强制改成 ready。

最终只发布：

```text
ready_public_ai_create
ready_public_ai_update
```

其他状态继续保留在 ledger 中。
