# AI Radar 第四波：2500 条增量大波次 v0.1

## 目标

在第三波 450 条处理台账基础上，把用户操作从每 250 条一次缩减为每 2500 条一次，同时保留子波次级恢复能力。

```text
用户侧：1 个 2500 条输入 ZIP
内部：10 个 × 250 条可独立恢复子波次
每个子波次：50 个 × 5 条研究块
用户侧：1 个聚合结果 ZIP
```

## 默认增量规则

- 已完成且目录未变化：完全跳过；
- 新作品：占用联网研究容量；
- needs_more_research：定向补查；
- identity_review：优先确认身份；
- ai_qa_deferred：补查 AI QA 指定缺口；
- 目录证据变化：只刷新变化作品；
- 政策或校准变化：进入独立 reassessment 队列，不占 2500 条联网研究容量；
- 保护条目：跳过。

第四波默认预留最多 500 个研究名额给历史重试；实际重试不足时由新作品自动补满。

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

输出：

```text
data_local/outputs/ai-radar/waves/
RADAR-INCREMENTAL-WAVE-0004-2500-input-v01.zip
```

只上传这一份 ZIP，不需要逐个上传 500 个研究块。

## 安全边界

- 不写 Payload；
- 不直接写 PostgreSQL；
- 不修改 Works；
- 不发布评级；
- 不创建或修改人工审核线；
- 所有产物只写入 data_local。
