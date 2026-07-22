# AI Radar 第四波：2500 条增量大波次 v0.2

## 目标

把用户操作从每 250 条一次缩减为每 2500 条一次，同时保留子波次级恢复能力，并确保此前完成的 `RADAR-ASSESS-0001` 至 `RADAR-ASSESS-0041` 不会被误当成全新联网研究。

```text
用户侧：1 个 2500 条输入 ZIP
内部：10 个 × 250 条可独立恢复子波次
每个子波次：50 个 × 5 条研究块
用户侧：1 个聚合结果 ZIP
```

## 旧成果对账

第三波早期台账只扫描新研究线和 AI QA 产物，没有覆盖更早的 10,250 条批量评级成果。第四波 v0.2 在选择研究条目前会重新扫描本地历史结果，包括：

- `v0.4-resolutions.jsonl`、`v0.5-resolutions.jsonl`、`v0.6-resolutions.jsonl`；
- 历史 `radar-assess-XXXX-chunk-XXXX.output.jsonl`；
- 已解析的 calibrated/resolved JSONL。

只有同时具备以下条件的旧记录才可复用：

- `workId` 与 `siteId` 完整且与当前目录精确一致；
- 没有身份冲突、错摘要、重复身份或系列身份冲突；
- 有来源摘要；
- 证据覆盖至少 35%；
- 证据状态不是 unknown、insufficient 或 conflicting；
- 至少有一个等级或规则信号。

满足条件的旧成果进入独立 reassessment 队列，附带原始来源摘要、覆盖率、证据状态、等级、规则与原始行 SHA-256；它们不占 2500 条联网研究容量。弱证据和身份冲突仍进入定向研究。

## 默认增量规则

- 已通过当前 AI QA 且目录未变化：完全跳过；
- 旧批量评级、证据可复用：只重新评级，不重新联网；
- 新作品：占用联网研究容量；
- needs_more_research：定向补查；
- identity_review：优先确认身份；
- ai_qa_deferred：补查 AI QA 指定缺口；
- 目录证据变化：只刷新变化作品；
- 政策或校准变化：进入独立 reassessment 队列，不占 2500 条联网研究容量；
- 保护条目：跳过。

第四波默认预留最多 500 个研究名额给历史重试；实际重试不足时由真正未处理的新作品自动补满。

## 恢复模型

每个子波次拥有独立：

- source JSONL；
- handoff manifest；
- 50 个研究块及 SHA-256；
- checkpoint seed；
- recovery identity。

重复运行时，只有子波次结果 manifest 与全部声明哈希匹配，才允许跳过。失败或 partial 子波次单独重跑。聚合结果缺少任一子波次时必须标记 partial，不得伪装 complete。

## 启动命令

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

pwsh `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File `
    ".\scripts\radar\run-ai-radar-wave4-2500-start-v01.ps1"
```

启动器会先重建台账，并要求至少扫描 10,000 条旧结果、至少接受 8,000 条可复用旧证据。若旧成果文件已被移走或删除，流程会明确阻断，不会退回到重复研究模式。

输出：

```text
data_local/outputs/ai-radar/waves/
RADAR-INCREMENTAL-WAVE-0004-2500-input-v02.zip
```

旧的 `input-v01.zip` 已废弃，不应继续处理。只上传新的 v02 ZIP，不需要逐个上传 500 个研究块。

## 安全边界

- 不写 Payload；
- 不直接写 PostgreSQL；
- 不修改 Works；
- 不发布评级；
- 不创建或修改人工审核线；
- 所有产物只写入 data_local。
