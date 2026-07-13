# AI 排雷初筛工作流 v0.1

本工作流为全资料库作品生成可复核的 AI 排雷建议。它不是人工最终裁决，也不会直接覆盖当前人工评级。

## 目标

对每个 Work：

1. 汇总 Payload 中已有标题、简介、分析、证据备注、雷点矩阵、标签、注意点、创作者、机构和来源信息。
2. 按 `radar-rating-policy-v0.4-draft` 的 55 条规则逐条判断。
3. 保留全部命中规则。
4. 按 `X → F → E → D → C → B → A → S` 取最危险的一档作为当前 AI 建议等级。
5. 输出置信度、资料覆盖度、证据状态、来源、冲突和页面提示状态。
6. 所有 AI 结果使用 `加速排雷（AI）` 页面提示。

## 安全边界

当前 v0.1 只有两个阶段：

- 构建只读证据资料包；
- 解析已经生成的逐规则评估结果。

它不会：

- 写入 Payload；
- 直接写 PostgreSQL；
- 修改 `Works.rank`；
- 发布或锁定作品；
- 覆盖人工已确认结果；
- 自动把作品正式判定为 X。

X 级命中会保留在结果中，但进入 `blocked_or_human_review_required`。

## 一、构建证据资料包

### 从本地 Payload 读取

```powershell
cd "D:\0GitHubtest\Baihepailei"

$env:RADAR_PAYLOAD_EMAIL="你的 Payload 后台邮箱"
$env:RADAR_PAYLOAD_PASSWORD="你的 Payload 后台密码"

pnpm radar:build-input -- --url http://localhost:3000
```

也兼容现有导出账号环境变量：

```powershell
$env:PAYLOAD_EXPORT_EMAIL="你的 Payload 后台邮箱"
$env:PAYLOAD_EXPORT_PASSWORD="你的 Payload 后台密码"
```

小批量测试：

```powershell
pnpm radar:build-input -- --url http://localhost:3000 --limit 100
```

### 从本地 JSON / JSONL 读取

```powershell
pnpm radar:build-input -- --file "data_local\some-works.jsonl" --limit 100
```

默认输出：

```text
data_local/staging/ai-radar/ai-radar-input-v01.jsonl
data_local/staging/ai-radar/ai-radar-input-v01-summary.json
```

每条资料包包含：

```text
workId / siteId / title / titles
media
existingState
writeProtection
summaryText / analysisText / evidenceNote / searchText
riskMatrix
creators / organizations / tags / warnings
externalIds / sourceLinks / candidateSources
evidenceSignals
assessmentInstructions
```

## 二、逐规则评估输入格式

AI 或其他整理流程应输出：

```text
data_local/staging/ai-radar/ai-radar-raw-assessments-v01.jsonl
```

每行示例：

```json
{
  "workId": "123",
  "siteId": "work-000123",
  "title": "示例作品",
  "evidenceCoverage": 0.8,
  "evidenceStatus": "multiple_secondary_supported",
  "existingState": {
    "ratingNotice": "none"
  },
  "ruleAssessments": [
    {
      "code": "A-NEAR-CONFIRMED",
      "matched": true,
      "confidence": 82,
      "reason": "两名女性主要角色之间的关系接近明确恋爱。",
      "evidenceStatus": "multiple_secondary_supported",
      "sources": [
        {
          "label": "来源名称",
          "url": "https://example.invalid/source",
          "sourceType": "secondary"
        }
      ],
      "supportingEvidence": [
        "证据摘要"
      ],
      "contradictingEvidence": []
    },
    {
      "code": "F-MALE-NTR",
      "matched": true,
      "confidence": 74,
      "reason": "存在男性介入主要女性关系的资料。",
      "evidenceStatus": "single_secondary_supported",
      "sources": [
        {
          "label": "另一来源"
        }
      ]
    }
  ]
}
```

`confidence` 可以写 `0–1` 或 `0–100`。解析时会统一转成 `0–1`。

证据状态允许值：

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

## 三、解析当前建议等级

```powershell
pnpm radar:resolve
```

自定义输入或阈值：

```powershell
pnpm radar:resolve -- `
  --input "data_local\staging\ai-radar\ai-radar-raw-assessments-v01.jsonl" `
  --minimum-match-confidence 0.5 `
  --positive-coverage-threshold 0.5
```

默认输出：

```text
data_local/staging/ai-radar/ai-radar-resolved-v01.jsonl
data_local/staging/ai-radar/ai-radar-ready-v01.jsonl
data_local/staging/ai-radar/ai-radar-blocked-v01.jsonl
data_local/staging/ai-radar/ai-radar-low-confidence-v01.jsonl
data_local/staging/ai-radar/ai-radar-conflicts-v01.jsonl
data_local/staging/ai-radar/ai-radar-review-v01.csv
data_local/staging/ai-radar/ai-radar-resolve-v01-summary.json
```

## 等级解析原则

- 同一作品可命中多个类别。
- 全部命中类别都保存在 `matchedRules`。
- `currentGradeSuggestion` 取最危险的命中等级。
- F 与 A 同时命中时，当前建议等级为 F。
- 没有达到最低置信阈值的命中时，回退为 `D-UNCLEAR`。
- 只有 S/A 正向线索，但资料覆盖不足且没有强证据时，回退为 `D-UNCLEAR`。
- 规则代码前缀不决定等级，以规则注册表中的 `grade` 为准：
  - `C-FUTURE-HET-HINT` 当前属于 D；
  - `D-ABO` 当前属于 E。
- X 建议不会自动进入可写队列。

## 证据覆盖度与判断置信度

这两个字段意义不同：

- `overallConfidence`：对决定性规则和当前建议等级的确信程度。
- `evidenceCoverage`：现有资料对整部作品、路线或结局的覆盖程度。

因此可以出现：

```text
判断置信度 90%，资料覆盖度 20%
```

表示已有证据很明确，但只覆盖作品的一小部分。

## 测试

```powershell
pnpm test:radar-assessment
```

测试覆盖：

- 55 条规则完整性；
- F 覆盖 A 但保留两条命中；
- 无有效命中时回退 D-UNCLEAR；
- 弱正向证据不能直接进入 S/A；
- X 强制人工裁决；
- 人工已确认条目保持写保护。

## 后续阶段

完成首批真实评估并审查输出结构后，再增加：

1. AI 评估批处理器；
2. 冲突与异常审计器；
3. 分等级、分雷点的 review CSV；
4. Payload patch planner；
5. 默认 dry-run、显式确认令牌的 apply 脚本；
6. 前台 AI 综合评级与页面提示展示。

在上述写入阶段完成前，本工作流不会修改任何作品记录。
