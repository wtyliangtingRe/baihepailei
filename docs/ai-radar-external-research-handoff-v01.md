# AI Radar 外部研究交接 v0.1

## 目的

正式库只读盘点表明，大多数 Works 缺少可用于排雷评级的剧情、关系和结局证据。该流程把 `external_research` 批次整理为小型联网研究块，并在本地严格回收结果。

它不会直接评级，不会发布，也不会写入 Payload 或 PostgreSQL。

## 输入

使用完整目录导出中的：

```text
queue/catalog-batch-manifest-v01.json
queue/batches/external-research/radar-research-0001.jsonl
```

只允许清单中 `queue=external_research` 的批次。

## 准备研究包

```powershell
node scripts/radar/prepare-ai-radar-research-handoff-v01.mjs `
  --batch-id RADAR-RESEARCH-0001 `
  --manifest <catalog-batch-manifest-v01.json> `
  --out-dir <data_local 下的 research-handoffs 目录> `
  --chunk-size 5
```

默认每块 5 条，允许 1–20 条。

输出包括：

```text
handoff-manifest.json
RESEARCH_INSTRUCTIONS.md
chunks/*.input.jsonl
responses/*.output.jsonl
```

## 研究结果

每个输入行必须返回一个输出行，并原样保留 `workId` 与 `siteId`。

研究只确认事实证据，不直接给出 Radar 等级。需要覆盖：

- 作品身份与别名；
- 剧情概要；
- 女性角色关系；
- 男性恋爱或性介入；
- NTR 风险；
- 结局或连载状态；
- 成人内容；
- TS、futa、ABO、男娘等设置偏好；
- 可追溯来源、冲突与未解决问题。

只有满足下列条件的行才能标记为 `ready_for_ai_assessment`：

- `identityStatus=confirmed`；
- evidenceStatus 不是 `insufficient_evidence`、`unknown` 或 `conflicting_evidence`；
- evidenceCoverage 至少 0.35；
- 至少一个带 HTTP(S) URL 的来源。

其余行进入 `needs_more_research` 或 `identity_review`。

## 组装

```powershell
node scripts/radar/assemble-ai-radar-research-handoff-v01.mjs `
  --batch-id RADAR-RESEARCH-0001 `
  --out-dir <同一个 research-handoffs 目录>
```

组装器验证：

- 来源批次和每个输入块的 SHA-256；
- 每个 Work 恰好返回一次；
- `siteId` 完全一致；
- 研究状态、证据覆盖和证据状态合法；
- 来源标签、URL 与类型合法；
- 人工状态和写保护只能来自原始输入。

成功后输出：

```text
assembled/research-results-v01.jsonl
assembled/research-ready-for-ai-assessment-v01.jsonl
assembled/research-needs-more-research-v01.jsonl
assembled/research-identity-review-v01.jsonl
assembled/assessment-ready-input-v01.jsonl
assembled/assessment-ready-manifest-v01.json
assembled/assembly-summary.json
```

`assessment-ready-manifest-v01.json` 可直接交给现有的 assessment handoff preparer。它只包含研究证据达到门槛的行，仍然只是 AI 评级输入，不是发布授权。

## 安全边界

- 所有输入和输出必须位于被 Git 忽略的 `data_local`；
- 拒绝 execute、apply、write、patch、gate 等参数；
- 不包含 Payload API 调用；
- 不包含 PostgreSQL 调用；
- 不修改 Works；
- 不发布评级；
- AI 结果仍需组装、规则评估和人工复核。
