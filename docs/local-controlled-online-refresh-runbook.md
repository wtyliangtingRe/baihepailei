# 本地联网扩库运行手册

本文记录 `controlled online refresh` 在 Windows 本地环境中的实际运行方式、凭据边界、代理配置、故障判断和已验证基线。它用于避免后续维护时反复猜测端口、环境文件、管理员邮箱来源或代理方式。

> 本文只记录变量名和本地运行方式。不得把真实密码、token、cookie、数据库 dump 或生产密钥提交到仓库。

## 1. 已验证的本地环境

截至 2026-07-21，本项目实际使用：

```text
操作系统：Windows
Shell：PowerShell 7.6.x
仓库：D:\0GitHubtest\Baihepailei
环境文件：.env（不是 .env.local）
本地 Next/Payload：http://127.0.0.1:3000
开发命令：pnpm dev
Node：24.x
```

`pnpm dev` 会占用一个终端。联网刷新命令应在第二个 PowerShell 窗口运行。

## 2. 启动本地网站

第一个 PowerShell：

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"
pnpm dev
```

确认日志显示：

```text
Local: http://localhost:3000
Environments: .env
Ready
```

本地 URL 应以实际日志为准。当前环境是端口 `3000`，不要沿用旧示例中的 `3001`。

## 3. Payload 登录凭据

本地 `.env` 已有：

```env
SITE_OWNER_EMAIL=...
```

管理员密码不落盘，每次在当前 PowerShell 进程中安全输入。不要把密码加入 `.env`、`.env.example`、README、Git、命令历史或聊天记录。

第二个 PowerShell：

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

只检查是否存在，不输出真实值：

```powershell
node -e "for (const k of ['RADAR_PAYLOAD_EMAIL','RADAR_PAYLOAD_PASSWORD']) console.log(k + ': ' + (process.env[k] ? 'SET' : 'MISSING'))"
```

预期：

```text
RADAR_PAYLOAD_EMAIL: SET
RADAR_PAYLOAD_PASSWORD: SET
```

关闭该 PowerShell 窗口后，临时密码变量自动消失。

## 4. 本地代理

当前 v2rayN 本地混合监听端口为：

```text
127.0.0.1:10808
```

该地址不是秘密，可以作为本地示例；不同机器应以 v2rayN“本地混合监听端口”为准。

### 4.1 先确认代理端口可用

```powershell
Test-NetConnection 127.0.0.1 -Port 10808
```

预期：

```text
TcpTestSucceeded : True
```

### 4.2 通过代理测试 Bangumi

```powershell
curl.exe -x "http://127.0.0.1:10808" -4 -sS --connect-timeout 30 `
  -o NUL `
  -w "Bangumi via proxy HTTP %{http_code}`n" `
  "https://api.bgm.tv/v0/subjects/1"
```

只要不是 `000`，就说明代理连接已经建立。`200` 为最理想结果；其他 HTTP 状态也比连接超时更能说明网络路径已打通。

### 4.3 让 Bangumi 抓取器使用代理

当前 Bangumi 抓取器读取：

```powershell
$env:BANGUMI_PROXY = "http://127.0.0.1:10808"
```

然后单独测试：

```powershell
node --env-file=.env scripts/radar/fetch-controlled-source-snapshots-v01.mjs `
  --profile quick `
  --sources "bangumi" `
  --bangumi-pages 1
```

`BANGUMI_PROXY` 只影响当前 PowerShell 进程；也可以把非敏感代理地址写入本地 `.env`，但不要提交个人代理配置。

### 4.4 代理与 TUN 的区别

- Bangumi 现有抓取器明确支持 `BANGUMI_PROXY`，优先使用该变量，不必为了单一来源强制开启系统全局代理。
- Yurizukan、VNDB、Steam 当前通过 Node `fetch` 请求；不要假设它们会自动读取 `BANGUMI_PROXY`。
- 若这些来源也发生直连超时，可以临时启用 v2rayN TUN，或在代码中统一接入受控代理配置；不要在不清楚影响范围时永久打开全局代理。

## 5. 当前只读小样本命令

四来源小样本：

```powershell
node --env-file=.env scripts/radar/run-controlled-online-refresh-v01.mjs `
  --url "http://127.0.0.1:3000" `
  --profile quick `
  --sources "bangumi,yurizukan,vndb,steam" `
  --bangumi-pages 1 `
  --vndb-pages 1 `
  --yurizukan-pages 1 `
  --yurizukan-max-articles 10 `
  --steam-pages 1 `
  --steam-max-apps 20
```

排除暂时故障来源：

```powershell
node --env-file=.env scripts/radar/run-controlled-online-refresh-v01.mjs `
  --url "http://127.0.0.1:3000" `
  --profile quick `
  --sources "vndb,steam" `
  --vndb-pages 1 `
  --steam-pages 1 `
  --steam-max-apps 20
```

当前命令只读取 Payload、访问外部来源并写 `data_local` staging 文件。它不创建、更新或发布 Works，也不修改 `humanAssessment` 或 `radarAssessment`。

## 6. 2026-07-21 实际数据库基线

一次真实 Payload 读取已经成功完成：

```text
Works read: 35,615
Packets written: 35,615
Existing rank unknown: 35,562
Review status pending: 35,610
Evidence unassessed: 34,370
Evidence weak: 1,182
Evidence medium: 63
Ready for AI assessment with warnings: 6
Needs external research: 35,609
Identity review rows: 0
```

这说明后续管道不能只处理新发现作品，还必须把站内历史 Works 纳入统一补资料和 AI 首次/重新审核队列。

建议的既有 Works 分类：

```text
never_assessed
manual_or_feedback_intake
metadata_incomplete
source_changed
policy_stale
already_current
identity_review_required
```

日常 `quick` 只处理未审核和输入发生变化的作品；定期 `full` 再处理资料不全、旧策略、低证据和长期未检查作品。必须通过来源包哈希与评估输入哈希跳过没有变化的记录，不能每次盲目重跑全部 35,615 条。

## 7. 已观察到的来源故障

### Bangumi

直连 `api.bgm.tv:443` 在本地网络下 IPv4、IPv6 都超时。该问题发生在外部连接层，不是 Payload 凭据或数据库错误。优先按第 4 节使用 v2rayN 本地代理测试。

### Yurizukan

旧列表路径：

```text
https://www.yurizukan.com/articles/newArticlesList
```

在 2026-07-21 返回 404。当前公开作品列表已迁移到类似：

```text
https://www.yurizukan.com/articles?page=1
```

详情链接同时存在：

```text
/articles/<id>
/articles/articleDetail/<id>
```

因此当前抓取器的列表 URL 和 ID 解析规则需要兼容新旧路由。404 不是 VPN 问题，不应靠重试或代理掩盖。

### 来源失败策略

当前实现是首个来源失败就终止整个来源阶段。后续应改为：

```text
抓取阶段：记录单来源 failed，继续其他来源
只读计划：允许生成 incomplete 报告
自动 apply：任一必需来源不完整时禁止写回
```

## 8. 输出位置

每次运行使用新目录：

```text
data_local/staging/ai-radar/online-catalog-refresh-v01/<run-id>/
```

需要保留并复核的主要文件：

```text
summary.json
source-fetch/summary.json
source-fetch/<source>/*.jsonl
source-fetch/<source>/*summary.json
discovery-plan/summary.json
discovery-plan/candidate-plan/discovered-work-candidate-plan-v01-summary.json
```

`data_local` 为本地 staging，不应提交真实抓取结果、凭据或受限数据。

## 9. 安全边界

始终保持：

```text
Payload read: allowed
Payload write: forbidden in current stage
PostgreSQL direct write: forbidden
humanAssessment mutation: forbidden
radarAssessment mutation: forbidden in current stage
automatic title merge: forbidden
credentials in output: forbidden
```

在 checkpoint、批次确认、dry-run、API 回读和索引重建未接入前，不开放 `--apply`。
