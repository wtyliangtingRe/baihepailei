# AI Radar 第三波 250 条一键研究 v0.1

## 本波目标

第三波固定处理 `RADAR-RESEARCH-WAVE-0003-0250`，由原始目录批次 0003、0004 和 0005 的前 50 条组成，总计 250 条、50 个五条研究块。

当前第三波输入包已在 Windows 上生成并上传，且与前两批 workId 重合为 0，因此不需要重新生成。

## 后续默认模式

从第三波完成后开始，下一波不再依赖硬编码批次起点，而是使用处理台账：

```text
读取当前目录快照
→ 对照已处理台账
→ 跳过未变化的已完成作品
→ 处理新增作品
→ 重试以前暂缓的作品
→ 只重算受规则或证据变化影响的作品
```

台账与选择器：

```text
scripts/radar/build-ai-radar-processing-ledger-v01.mjs
scripts/radar/select-ai-radar-incremental-wave-v01.mjs
```

说明见：

```text
docs/ai-radar-incremental-ledger-v01.md
```

## 当前一键入口

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave3-start-v01.ps1"
```

它会：

1. 核验正式只读目录清单；
2. 核验原始批次文件、行数和 SHA-256；
3. 保存每个原始批次的 provenance；
4. 检查 250 条身份无重复；
5. 生成 50 个五条研究块；
6. 运行基础与第三波测试；
7. 输出唯一上传 ZIP。

## 输出

```text
data_local/outputs/ai-radar/waves/
RADAR-RESEARCH-WAVE-0003-0250-input-v01.zip
```

## 安全

- Payload 写入：0；
- PostgreSQL 写入：0；
- Works 修改：0；
- 人工审核线路修改：0；
- 发布评级：0；
- 所有产物只位于 `data_local`。
