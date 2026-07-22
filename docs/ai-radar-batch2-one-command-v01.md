# AI Radar 第二批一键启动 v0.1

## 目标

用一个 PowerShell 入口从现有正式只读导出中定位 `RADAR-RESEARCH-0002`，生成 100 条外部研究输入，并只输出一个需要上传的 ZIP。

## 一键入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-batch2-start-v01.ps1"
```

入口会自动：

1. 在 `data_local/staging/ai-radar` 下寻找包含第二批的 `catalog-batch-manifest-v01.json`；
2. 要求批次为 `external_research`、100 条，并核验来源 JSONL 的 SHA-256；
3. 生成 `RADAR-RESEARCH-0002` 的 20 个五条研究块；
4. 核验所有块的行数、路径边界和 SHA-256；
5. 运行研究、校准、AI QA 与第二批入口测试；
6. 生成：

```text
data_local/outputs/ai-radar/batch2/RADAR-RESEARCH-0002-input-v01.zip
```

只上传该 ZIP，不要逐块上传。

## 预期处理方式

第二批采用一次助手处理：

```text
100 条外部研究
→ 研究结果组装
→ 对可评级行生成站长校准上下文
→ AI 评级
→ AI 线路内部 QA
→ 未决项定向暂缓
→ 返回一个完整结果 ZIP
```

这能把用户侧操作压缩成：

```text
运行一次启动脚本
→ 上传一个输入 ZIP
→ 下载一个完整结果 ZIP
→ 运行一次回收脚本
→ 上传一个最终检查点 ZIP
```

## 线路边界

- 本流程只属于 AI 审核线；
- 人工审核线创建或修改为 0；
- 校准只用于解释模糊边界，不创造事实；
- 不写 Payload；
- 不直接写 PostgreSQL；
- 不修改 Works；
- 不发布评级；
- 全部产物位于 `data_local`。

## 当前批次固定参数

| 参数 | 值 |
|---|---:|
| batchId | `RADAR-RESEARCH-0002` |
| 输入行数 | 100 |
| 每块行数 | 5 |
| 块数 | 20 |
| 队列 | `external_research` |

第二批完成并验证后，再决定第三批是否扩大到 250 条。
