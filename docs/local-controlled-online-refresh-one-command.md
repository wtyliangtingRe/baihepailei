# 本地联网扩库：统一入口

本页记录 Windows / PowerShell 环境下的推荐入口。内部仍保留多个可单独测试的 Node 脚本，但日常使用不需要手工串联它们。

完整环境、凭据边界、代理与故障记录见 [`local-controlled-online-refresh-runbook.md`](./local-controlled-online-refresh-runbook.md)。

## 设计原则

统一入口只负责：

1. 检查当前 PowerShell 是否已有 Payload 临时登录变量；
2. 自动探测 v2rayN 默认混合端口 `127.0.0.1:10808`，只给 Bangumi 抓取器使用；
3. 调用现有 `run-controlled-online-refresh-v01.mjs`；
4. 把 profile、来源和小样本限制统一传下去。

内部抓取、审计、标准化和去重脚本继续分开，以便独立测试和定位来源故障。统一入口不会保存密码，也不会把凭据写入参数、日志或仓库。

## 前置条件

第一个 PowerShell 保持本地网站运行：

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"
pnpm dev
```

第二个 PowerShell 每次安全输入密码：

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

$env:RADAR_PAYLOAD_EMAIL = (
  Get-Content .env |
  Where-Object { $_ -match '^\s*SITE_OWNER_EMAIL=' } |
  Select-Object -First 1
).Split('=', 2)[1].Trim().Trim('"').Trim("'")

$SecurePassword = Read-Host "请输入 Payload 管理员密码" -AsSecureString
$env:RADAR_PAYLOAD_PASSWORD = ConvertFrom-SecureString $SecurePassword -AsPlainText
Remove-Variable SecurePassword
```

密码只存在当前 PowerShell 进程中，关闭窗口后消失。

## 推荐命令

首次或回归验证使用小样本：

```powershell
.\scripts\radar\run-controlled-online-refresh-v01.ps1 -Sample
```

日常 quick：

```powershell
.\scripts\radar\run-controlled-online-refresh-v01.ps1 -Profile quick
```

定期 full：

```powershell
.\scripts\radar\run-controlled-online-refresh-v01.ps1 -Profile full
```

当前默认来源是：

```text
bangumi,vndb,steam
```

Yurizukan 因公开路由迁移暂不默认启用。修复完成前若要显式复测：

```powershell
.\scripts\radar\run-controlled-online-refresh-v01.ps1 `
  -Sample `
  -Sources "bangumi,yurizukan,vndb,steam"
```

若 v2rayN 不在默认端口，可明确指定：

```powershell
.\scripts\radar\run-controlled-online-refresh-v01.ps1 `
  -Sample `
  -Proxy "http://127.0.0.1:10808"
```

## 2026-07-21 已验证结果

### 本地数据库

```text
Works read: 35,615
Evidence unassessed: 34,370
Needs external research: 35,609
Ready for AI assessment with warnings: 6
```

### Bangumi

在直连 IPv4/IPv6 均超时的网络环境中，v2rayN 混合端口 `127.0.0.1:10808` 已验证可用：

```text
Bangumi proxy probe: HTTP 200
Searched: 59
Accepted after tag threshold: 23
Rejected below threshold: 36
Failed: 0
proxyUsed: true
```

### VNDB + Steam

小样本只读计划已完整跑通：

```text
Normalized candidates: 120
VNDB rows: 100
Steam rows: 20
Would create temporary draft: 54
Would update existing Work: 65
Possible duplicate: 1
Blocked: 0
```

这些结果只生成 `data_local` 快照和计划，没有创建、更新、发布 Works，也没有修改 `humanAssessment` 或 `radarAssessment`。

## 为什么不把所有代码合成一个文件

单文件会让来源路由变化、代理故障、字段变化和去重回归难以独立测试。推荐结构是：

```text
PowerShell 统一入口
  → Node 总编排器
    → Works 快照与审计
    → Bangumi / Yurizukan / VNDB / Steam 抓取器
    → 标准化
    → 跨来源聚合与站内去重
    → create / update / duplicate / blocked 计划
```

对使用者是一条命令，对维护者仍是可测试的模块。

## 当前安全边界

```text
Payload read: true
Payload write: false
PostgreSQL direct write: false
create/update/publish Works: false
humanAssessment mutation: false
radarAssessment mutation: false
apply available: false
```

在 checkpoint、AI contract、dry-run、批次确认、API 回读与索引重建完成前，统一入口不会开放写入参数。
