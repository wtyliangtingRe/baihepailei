# AI Radar 第三波 250 条一键启动 v0.1

## 目标

在前两批各 100 条完成闭环后，将下一轮扩大为 250 条，同时保持一次运行、一个上传 ZIP 和完整来源追踪。

## 数据范围

第三波从原始正式只读目录批次 `RADAR-RESEARCH-0003` 开始：

```text
RADAR-RESEARCH-0003：100 条
RADAR-RESEARCH-0004：100 条
RADAR-RESEARCH-0005：前 50 条
合计：250 条
```

原始批次文件、SHA-256、选取行数以及首尾 workId 全部写入 `wave-provenance.json`。

## 一键入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave3-start-v01.ps1"
```

入口会自动：

1. 定位包含 `RADAR-RESEARCH-0003` 的正式只读目录清单；
2. 校验原始批次 0003、0004、0005 的文件、行数和 SHA-256；
3. 选取 250 个不重复的 `external_research` 条目；
4. 生成一个带完整原始批次 provenance 的合成目录清单；
5. 调用既有受保护研究 preparer，生成 50 个五条研究块；
6. 验证所有块的路径与 SHA-256；
7. 运行基础流程及第三波测试；
8. 输出唯一需要上传的 ZIP：

```text
data_local/outputs/ai-radar/waves/
RADAR-RESEARCH-WAVE-0003-0250-input-v01.zip
```

## 处理预期

```text
250 条外部研究
→ 研究组装
→ 可评级行进入站长校准 AI 评级
→ 固定规则 resolver
→ AI 线路内部 QA
→ 通过与定向暂缓分流
→ 一个完整结果 ZIP
```

人工审核线保持独立，本流程创建或修改人工记录为 0。

## 安全边界

- 所有读取的目录数据必须位于 `data_local`；
- 原始批次 SHA-256 不匹配时立即停止；
- 不写 Payload；
- 不直接写 PostgreSQL；
- 不修改 Works；
- 不发布评级；
- 不创建或修改人工审核记录；
- 生成产物全部位于 `data_local`。

## 规模说明

正式只读导出中共有 35,076 条进入 `external_research` 队列。前两批已触达 200 条，因此第三波开始前还有 34,876 条尚未进入研究流程。以 250 条波次计算，约需 140 个波次覆盖剩余初始队列；后续可在稳定性验证后继续提高单波规模，并通过系列级证据复用减少重复研究。
