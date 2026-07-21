# AI Radar 结论覆盖保证 v0.1

## 1. 核心原则

只要一个身份有效的作品已经完成 AI 扫描，就不得无声地回到“完全未知”。AI 必须输出以下两种结论形态之一：

1. **固定等级**：证据足以支持一个相对明确的 `suggestedGrade`；
2. **有界区间**：证据不足以支持单一等级，但足以给出最好情况、最坏情况和最可能等级。

AI 扫描完成后只返回空等级、裸 `unknown` 或一句“资料不足”，不视为合格输出。

这项保证适用于：

- 新发现作品；
- 站内从未 AI 审核的既有作品；
- 人工或反馈新增但资料不完整的作品；
- 来源变化、规则升级或旧结果过期后的重新评估。

## 2. 固定等级模式

当身份明确、来源可追溯、规则证据达到门槛时，输出：

```json
{
  "conclusionMode": "fixed_grade",
  "suggestedGrade": "C",
  "confidencePercent": 82,
  "evidenceCoveragePercent": 74,
  "evidenceStatus": "sufficient",
  "requiresHumanReview": false
}
```

固定等级仍必须保留置信度、证据覆盖率、决定性规则、命中规则、矛盾和来源摘要。固定等级不是人工确认，也不得覆盖 `humanAssessment`。

## 3. 有界区间模式

当来源不足、作品未完结、结局未知、关键男性介入尚未证实、系列/卷册边界不清或其他信息缺口使单一等级不可靠时，输出：

```json
{
  "conclusionMode": "bounded_range",
  "likelyGrade": "D",
  "bestGrade": "C",
  "worstGrade": "E",
  "confidencePercent": 58,
  "evidenceCoveragePercent": 36,
  "evidenceStatus": "partial",
  "requiresHumanReview": true,
  "uncertaintyReasons": [
    "ending_not_verified",
    "male_involvement_not_fully_checked"
  ]
}
```

区间必须满足：

- `bestGrade`、`likelyGrade`、`worstGrade` 都来自当前政策允许的等级；
- 按安全程度排序时，`bestGrade` 不得差于 `likelyGrade`，`likelyGrade` 不得差于 `worstGrade`；
- 区间必须由已知证据和未解决问题推导，不能为了避免空值而随意填写；
- 区间过宽时仍应给出已知风险下限、缺失信息和下一步研究建议；
- 前台必须明确标记“AI 暂定区间 / 资料不完整”，不能把区间伪装成固定评级。

仓库现有 `RadarResearchRecords.proposedLikelyGrade`、`proposedBestGrade`、`proposedWorstGrade` 已提供这套语义。新作品 AI 契约应复用同一含义，而不是另造不兼容的等级体系。

## 4. 允许保持无评级的例外

只有下列情况可以没有固定等级或区间，并且必须标记为“未完成 AI 扫描”，不能标记为已评估：

- 作品身份无法确认或多个 Works 冲突；
- 输入不是有效作品记录；
- 来源响应损坏、哈希不一致或关键来源抓取失败；
- 模型输出行数、ID 或身份字段不匹配；
- 当前政策无法表示该内容，需要先升级规则；
- 安全门槛要求整行阻断。

这些情况进入 `identity_review_required` 或 `blocked`，不进入“已扫描但空评级”状态。

## 5. 新作品自动扩库门槛

外部候选只有满足以下结论覆盖要求，才能进入后续 temporary Works 创建或既有 Works 更新计划：

```text
fixed_grade with valid suggestedGrade
OR
bounded_range with valid best/likely/worst grades
```

若两种形态都不成立：

- 不得标记 AI 扫描完成；
- 不得进入 `auto_eligible`；
- 不得发布只有 `ai_synthesized_pending_review` 提示却没有实际结论的空壳评级；
- 应进入 `review_required` 或 `blocked` 并记录具体原因。

证据不足本身不等于阻断。只要身份有效、来源可追溯并能形成有根据的区间，就应优先输出区间，为人工复核和愿意尝试作品的用户提供风险提示。

## 6. 前台展示要求

固定等级展示：

```text
AI 暂定等级：C
置信度：82%
证据覆盖：74%
```

区间展示：

```text
AI 暂定范围：C–E
最可能：D
置信度：58%
证据覆盖：36%
尚未确认：结局、男性介入程度
```

无论哪种模式，都应展示：

- AI 而非人工结论；
- 置信度；
- 证据覆盖率；
- 已知风险；
- 关键缺失信息；
- 来源摘要；
- 是否建议人工复核。

## 7. 汇总与审计口径

不得再用 `Works.evidenceStrength = unassessed` 直接推断“没有 AI 评级”。该字段表示顶层证据强度，而且其定义明确允许“未评估不等于没有证据”。

AI 覆盖统计必须直接检查：

```text
radarAssessment.suggestedGrade
radarAssessment.assessedAt
radarAssessment.policyVersion
radarAssessment.assessmentBatch
未来的 conclusionMode / bestGrade / likelyGrade / worstGrade
```

Payload group 可能为每条 Works 返回一个所有字段为空的对象，因此“存在 radarAssessment 对象”也不等于已经完成评估。

批次摘要至少应区分：

```text
fixed_grade
bounded_range
scanned_without_valid_conclusion
unscanned
identity_review_required
blocked
```

`scanned_without_valid_conclusion` 必须为零，才能把该 AI 批次视为完整。

## 8. 双轨安全

本保证只约束 `Works.radarAssessment` 和内部研究输出：

- 不写入、覆盖或清空 `humanAssessment`；
- 不把 AI 固定等级或区间标记为人工已确认；
- 人工轨道可与 AI 轨道不同，两者分别展示；
- 目录展示仍遵循人工参考优先、否则 AI、再否则兼容旧字段；
- 所有自动写回继续受 checkpoint、dry-run、批次确认、API 回读和审计事件保护。

## 9. 实施顺序

1. 修正当前覆盖审计，直接统计 `suggestedGrade`，不再把 `evidenceStrength` 当成 AI 完成状态；
2. 核对历史 v0.6 的计划、研究记录和实际 Works 写回数量；
3. 在新作品 AI contract 中加入 `conclusionMode` 与区间字段；
4. 对固定等级和区间做确定性校验；
5. 把不合格空结论挡在 `auto_eligible` 之外；
6. 在前台分别展示固定等级和暂定区间；
7. 对站内历史 Works 采用同一覆盖保证进行增量补评。
