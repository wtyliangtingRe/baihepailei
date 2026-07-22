# AI Radar 第四波：2500 条增量大波次 v0.2

第四波必须先对账 `RADAR-ASSESS-0001` 至 `RADAR-ASSESS-0041` 的 10,250 条旧成果，再选择真正需要联网研究的 2,500 条。完整规则、恢复模型和 Windows 验收要求由启动脚本及 PR #295 维护。

## 启动

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave4-2500-start-v01.ps1"
```

输出：

```text
data_local/outputs/ai-radar/waves/RADAR-INCREMENTAL-WAVE-0004-2500-input-v02.zip
```

`RADAR-INCREMENTAL-WAVE-0004-2500-input-v01.zip` 已废弃，不得继续处理。v01 的包结构和哈希是完整的，但它使用的 450 行台账没有覆盖更早的 10,250 条批量评级成果，因而包含可避免的重复研究。

## 旧成果复用条件

旧记录只有在身份精确一致、来源摘要存在、证据覆盖至少 35%、证据状态不是 unknown/insufficient/conflicting，且不存在身份冲突时才进入 reassessment。其原等级、规则、证据摘要和原始行 SHA-256 会随重新评级队列保留。弱证据与身份冲突继续进入定向联网研究。

## Windows 验收

- `LegacyRowsScanned >= 10000`
- `LegacyReusableRows >= 8000`
- `LegacyReassessmentRows > 0`
- `ResearchRows = 2500`
- `Subwaves = 10`
- `Chunks = 500`
- Payload、PostgreSQL、Works、评级发布和人工审核线写入均为 0

最终仍是一个用户上传 ZIP、十个可独立恢复的 250 条子波次，以及五百个内部五条研究块。
