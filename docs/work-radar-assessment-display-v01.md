# 作品页排雷可信度展示 v0.1

## 位置

作品页顺序：

```text
基础信息
→ 排雷可信度
→ 雷点 / 注意点矩阵
→ 列表操作与正文
```

完整详情索引页和搜索索引回退页都会经过 `WorkRiskMatrixCard`，因此两种作品详情页都显示同一张可信度卡片。

## 展示内容

- 判断置信度（0–100%）
- 资料覆盖度（0–100%）
- 证据状态
- 复核状态
- 评估日期（有值时）
- 规则版本（有值时）
- 来源摘要（有值时，可折叠）

页面明确说明：

> 置信度表示当前建议与现有证据的一致程度，不等同于作品安全概率。

资料覆盖度表示角色关系、剧情发展、结局、官方说明和来源材料等关键证据的完整度。

## Payload 字段

新增可选 group：`radarAssessment`

```text
confidencePercent
evidenceCoveragePercent
evidenceStatus
sourceSummary
policyVersion
assessedAt
```

所有字段都是可选字段。旧作品没有新版指标时，前台显示“尚未计算”，不会把缺失值解释成 0%。

## 证据状态

```text
official_confirmed
primary_material_confirmed
multiple_secondary_supported
single_secondary_supported
community_consensus
inferred_from_metadata
conflicting_evidence
insufficient_evidence
unknown
```

## 导出

`enrich-lite-review-fields.mjs` 会把以下字段同步到搜索索引和详情索引：

```text
reviewStatus
evidenceStrength
ratingNotice
radarAssessment
```

因此完整详情页和索引回退页的展示保持一致。

## 安全

此功能只增加 Schema、只读导出和页面展示，不包含 AI 评估结果的 Payload apply 操作。

首批 100 条的内容数据仍保留在 staging；在人工复核、patch plan、apply dry-run 和用户明确批准之前，不写入作品记录。
