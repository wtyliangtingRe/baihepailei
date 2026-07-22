# AI Radar 站长校准档案 v0.1

## 目标

在固定排雷规则与 AI 判断之间加入一个可审计的个人校准层：

```text
事实证据
→ radar-rating-policy-v0.4-draft
→ site-owner-primary-v0.1
→ AI 规则判断
→ 人工复核
```

校准档案不是事实来源，也不是自动发布授权。它只用于解释模糊边界、规则选择和严重度。

## 当前基础版本

- 只启用一个档案：`site-owner-primary-v0.1`。
- 档案来源为 `ai-radar-calibration-review-index-v0.1`。
- 原始索引的 68 个样本完整保存在 source 文档中。
- 36 个明确回答进入运行时 `approved` anchors，权重 1。
- 8 个记忆或判断不确定的回答不进入运行时。
- 1 个只确定原则、未确定具体等级的回答不进入 anchor，但其明确原则可单独保留。
- 23 个未回答样本不进入运行时。
- 16 条从明确回答中提炼的通用原则为 active principles。

## 文件

```text
config/radar/calibration-profiles/registry.v0.1.json
config/radar/calibration-profiles/site-owner-primary.v0.1.json
docs/radar/calibration-sources/ai-radar-calibration-review-index-v0.1.md
scripts/radar/lib/calibration-profile-v01.mjs
scripts/radar/prepare-ai-radar-calibrated-assessment-handoff-v01.mjs
scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs
scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs
```

## 安全规则

- 事实证据始终优先于个人校准。
- 校准档案不得创造剧情、关系、结局、角色性别或来源。
- 未明确样本不进入运行时 active anchors。
- 校准不能隐藏已命中的雷点；所有匹配规则继续保留。
- X 级仍只能进入人工裁决，不能自动发布。
- 全流程只读本地输入并写入 `data_local`，不包含 Payload PATCH 或 PostgreSQL 写入。

## 生成带校准信息的评级块

```powershell
node `
  scripts/radar/prepare-ai-radar-calibrated-assessment-handoff-v01.mjs `
  --batch-id RADAR-ASSESS-RESEARCH-0001 `
  --manifest $AssessmentManifest `
  --out-dir $CalibratedHandoffRoot `
  --chunk-size 25
```

每一行输入都会增加：

- `calibrationContext.profileId`
- `calibrationContext.activePrinciples`
- `calibrationContext.relevantAnchors`
- 被忽略的未明确样本数量
- 事实优先与不可造证据说明

## AI 输出

每行必须额外包含：

```json
{
  "calibrationProfileId": "site-owner-primary-v0.1",
  "calibrationSignals": [
    {
      "type": "principle",
      "id": "male-noise-rule-is-narrow",
      "weight": 1,
      "effect": "rejected B-MALE-NOISE and used E-MALE-INTIMACY",
      "reason": "证据显示为明确男性亲密接触，而非轻微背景干扰。"
    }
  ],
  "calibrationNotes": []
}
```

没有适用信号时输出空数组。组装器只接受输入行公开的 principle/anchor ID。

## 组装与解析

```powershell
node `
  scripts/radar/assemble-ai-radar-calibrated-assessment-handoff-v01.mjs `
  --batch-id RADAR-ASSESS-RESEARCH-0001 `
  --out-dir $CalibratedHandoffRoot
```

```powershell
node `
  scripts/radar/resolve-ai-radar-calibrated-assessments-v01.mjs `
  --input $CompleteRawAssessments `
  --out-dir $ResolvedRoot
```

人工审核 CSV 会保留固定规则命中、决定性规则、校准档案 ID、实际采用的 principle/anchor、采用原因、阻断项、警告、证据覆盖与置信度。

## 后续扩展

未来可以在 registry 中登记其他已审核档案，并为档案、来源文件和单个 anchor 设置权重。v0.1 不做多人投票、平均分或自动融合，只保留兼容字段。
