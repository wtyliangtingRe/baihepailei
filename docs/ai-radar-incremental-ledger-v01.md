# AI Radar 增量处理台账 v0.1

## 默认运行模式

后续计划固定按以下顺序运行：

```text
读取当前目录快照
→ 对照已处理台账
→ 跳过未变化的已完成作品
→ 处理新增作品
→ 重试以前暂缓的作品
→ 只重算受规则或证据变化影响的作品
```

不会在每次启动时重新联网研究全部作品。

## 台账位置

```text
data_local/outputs/ai-radar/state/ai-radar-processing-ledger-v01.jsonl
```

台账由现有本地研究结果和 AI QA 输出重建，不写 Payload、PostgreSQL、Works 或人工审核线路。

## 主要状态

- `skip_completed_unchanged`：目录指纹、规则版本和校准版本均未变化，直接复用。
- `research_new`：当前目录中新出现、台账中不存在的作品。
- `research_retry_needs_more_research`：过去资料不足，定向补研究。
- `research_retry_identity_review`：过去身份不明确，定向核对身份。
- `research_retry_ai_qa_deferred`：评级后被 AI QA 暂缓，补足对应事实。
- `research_refresh_catalog_changed`：目录中的身份、摘要、证据或保护状态发生变化。
- `reassess_policy_changed`：研究事实不变，仅规则版本变化；不重新联网研究。
- `reassess_calibration_changed`：研究事实不变，仅校准档案变化；不重新联网研究。
- `skip_protected`：人工或锁定保护项，不进入 AI 增量流程。

## 构建台账

```powershell
node scripts/radar/build-ai-radar-processing-ledger-v01.mjs `
  --catalog-manifest data_local/staging/ai-radar/formal-readonly-handoff-v01/export/<export>/queue/catalog-batch-manifest-v01.json
```

## 选择下一波

```powershell
node scripts/radar/select-ai-radar-incremental-wave-v01.mjs `
  --catalog-manifest data_local/staging/ai-radar/formal-readonly-handoff-v01/export/<export>/queue/catalog-batch-manifest-v01.json `
  --target-rows 250 `
  --retry-reserve 50
```

默认每个 250 条波次最多预留 50 条给历史暂缓项；没有足够暂缓项时，空位由新增作品补足。

规则或校准变化产生的重算项写入独立的 reassessment 文件，不占用联网研究波次。

## 当前第三波

`RADAR-RESEARCH-WAVE-0003-0250` 在台账功能加入前已经生成，但已核验与前两批 workId 重合为 0，因此无需重新生成。第三波完成后，其研究与 AI QA 结果会进入台账；第四波开始正式由台账选择器生成。

## 安全边界

- 所有文件只写入 `data_local`；
- 不写 Payload；
- 不直接写 PostgreSQL；
- 不修改 Works；
- 不发布评级；
- 不创建或修改人工审核记录；
- 已完成作品只有在目录指纹、规则版本、校准版本或显式刷新原因变化时才允许重算。
