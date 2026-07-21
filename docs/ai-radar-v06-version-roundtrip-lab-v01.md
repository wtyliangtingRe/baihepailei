# AI Radar v0.6 版本回环实验室 v0.1

## 背景

单条真实 canary 已证明：在已有 newer draft 的 Work 上执行部分 PATCH，并设置 `_status: "published"`，Payload 会把 latest draft 中未出现在 PATCH 请求体里的字段一并带入 published/main。

因此旧的：

```text
partial PATCH + _status=published
```

路线已经永久禁用，不能再次对正式数据库执行。

Payload 官方草稿语义说明：

- `draft=true` 且状态为 draft，只写 versions table；
- `_status=published` 会执行正式发布；
- `draft=true` 读取返回最新版本；
- Admin 的“恢复到已发布”会保留旧草稿历史，并建立一个反映当前 published 状态的新版本。

本实验只在从发布前 checkpoint 恢复出的临时 PostgreSQL 数据库中验证以下回环：

```text
恢复与当前 published 完全相同的历史 published version
→ 确认 latest version 已变成干净 published 基线
→ 发布 Radar 白名单补丁
→ 确认 published 无关字段和人工轨道不变
→ 恢复原 latest draft version
→ 确认 published 仍保留 Radar，latest draft 恢复原状
```

实验成功也不代表允许直接批量发布；它只证明后续可继续设计新的单条正式 canary。

## 安全边界

实验器：

```text
scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs
```

强制要求：

- URL 必须是 loopback；
- 端口必须是 `3100`；
- 临时数据库名必须匹配 `baihepailei_radar_lab_*`；
- 正式数据库连接数必须为 0；
- 临时数据库必须存在至少一个应用连接；
- 数据库证明文件不得超过 30 分钟；
- 临时库来源 dump SHA-256 必须与 candidate checkpoint 绑定值一致；
- 写入模式需要 `RADAR_VERSION_ROUNDTRIP_LAB=YES`；
- 写入模式需要精确确认字符串；
- 最多三次 Payload 写请求；
- 不直接写 PostgreSQL 数据表；
- 不向 API 发送整份 draft 文档。

旧执行器：

```text
scripts/radar/run-ai-radar-v06-single-targeted-publication-once-v01.mjs
```

已替换为无条件退出脚本，不再包含 PATCH 逻辑。

## 代码检查

```powershell
node --check scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs
node --check scripts/radar/run-ai-radar-v06-single-targeted-publication-once-v01.mjs
node --test tests/ai-radar-v06-version-roundtrip-lab.test.mjs
```

这些检查不读取或写入 Payload。

## 1. 固定 candidate 和发布前 checkpoint

```powershell
$CandidateManifest = Join-Path `
  (Get-Location) `
  "data_local\staging\ai-radar\v06-single-targeted-publication-v01\rc-v06-single-cab8a120e61ea9f8f26e\candidate-manifest.json"

$PreWriteCheckpoint = `
  "D:\Baihepailei-backups\Baihepailei-20260721-165805"

$PreWriteDump = Join-Path `
  $PreWriteCheckpoint `
  "payload-postgresql.dump"

$Candidate = Get-Content `
  -LiteralPath $CandidateManifest `
  -Raw `
  -Encoding UTF8 |
  ConvertFrom-Json -Depth 100

$ExpectedDumpHash = `
  ([string]$Candidate.files.checkpointDump.sha256).ToLowerInvariant()

$ActualDumpHash = `
  (Get-FileHash $PreWriteDump -Algorithm SHA256).Hash.ToLowerInvariant()

if ($ExpectedDumpHash -ne $ActualDumpHash) {
  throw "candidate 与发布前 dump 的哈希不一致"
}
```

## 2. 停止正式站点

在运行 `pnpm dev` 的窗口按 `Ctrl+C`。

确认 3000 和 3100 都未监听：

```powershell
foreach ($Port in @(3000, 3100)) {
  if (Test-NetConnection 127.0.0.1 -Port $Port -InformationLevel Quiet) {
    throw "端口 $Port 仍在监听"
  }
}
```

## 3. 建立临时数据库

```powershell
$PgContainer = "baihepailei-postgres"
$PgUser = (docker exec $PgContainer printenv POSTGRES_USER | Out-String).Trim()
$MainDb = (docker exec $PgContainer printenv POSTGRES_DB | Out-String).Trim()

if ([string]::IsNullOrWhiteSpace($PgUser)) { $PgUser = "postgres" }
if ([string]::IsNullOrWhiteSpace($MainDb)) { $MainDb = $PgUser }

$MaintenanceDb = $(if ($MainDb -eq "postgres") {
  "template1"
} else {
  "postgres"
})

$LabDb = (
  "baihepailei_radar_lab_" +
  (Get-Date -Format "yyyyMMddHHmmss")
).ToLowerInvariant()

$ContainerDump = `
  "/tmp/$LabDb-$([guid]::NewGuid().ToString('N')).dump"

docker cp "$PreWriteDump" "${PgContainer}:$ContainerDump"
if ($LASTEXITCODE -ne 0) { throw "复制 dump 失败" }

docker exec $PgContainer createdb `
  "--username=$PgUser" `
  "--maintenance-db=$MaintenanceDb" `
  "--owner=$PgUser" `
  "--template=template0" `
  $LabDb
if ($LASTEXITCODE -ne 0) { throw "创建临时数据库失败" }

docker exec $PgContainer pg_restore `
  "--username=$PgUser" `
  "--dbname=$LabDb" `
  --no-owner `
  --no-privileges `
  --single-transaction `
  --exit-on-error `
  $ContainerDump
if ($LASTEXITCODE -ne 0) { throw "恢复临时数据库失败" }

docker exec $PgContainer rm -f $ContainerDump
```

确认临时库与正式库都存在：

```powershell
$Databases = @(
  docker exec $PgContainer psql `
    "--username=$PgUser" `
    "--dbname=$MaintenanceDb" `
    --tuples-only `
    --no-align `
    --command "SELECT datname FROM pg_database;"
) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ }

if ($LabDb -notin $Databases) { throw "临时数据库不存在" }
if ($MainDb -notin $Databases) { throw "正式数据库不存在" }
```

## 4. 派生临时 DATABASE_URI

只在当前 PowerShell 内存中解析 `.env`，不要打印 URI：

```powershell
$DatabaseUriLine = Get-Content -LiteralPath ".env" |
  Where-Object { $_ -match '^\s*DATABASE_URI=' } |
  Select-Object -First 1

if (-not $DatabaseUriLine) {
  throw ".env 中没有 DATABASE_URI"
}

$BaseDatabaseUri = `
  $DatabaseUriLine.Split('=', 2)[1].Trim().Trim('"').Trim("'")

$LabDatabaseUri = node --input-type=module -e @'
const url = new URL(process.argv[1]);
url.pathname = `/${process.argv[2]}`;
process.stdout.write(url.toString());
'@ "$BaseDatabaseUri" "$LabDb"

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($LabDatabaseUri)) {
  throw "无法派生临时 DATABASE_URI"
}

$BaseDatabaseUri = $null
```

不要输出 `$LabDatabaseUri`。

## 5. 在单独窗口启动临时站点

打开新的 PowerShell 窗口，只在该窗口执行：

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"

$env:DATABASE_URI = "<从操作窗口安全传入的 LabDatabaseUri>"
$env:NEXT_PUBLIC_SERVER_URL = "http://127.0.0.1:3100"

pnpm exec next dev --port 3100
```

不要把 URI 粘贴到聊天或日志。可在操作窗口中启动新进程并传递环境，避免手动复制：

```powershell
$LabCommand = @"
Set-Location 'D:\0GitHubtest\Baihepailei'
`$env:DATABASE_URI = '$($LabDatabaseUri.Replace("'", "''"))'
`$env:NEXT_PUBLIC_SERVER_URL = 'http://127.0.0.1:3100'
pnpm exec next dev --port 3100
"@

$LabProcess = Start-Process `
  pwsh `
  -ArgumentList @('-NoExit', '-Command', $LabCommand) `
  -PassThru
```

等待 3100 启动：

```powershell
$LabReady = $false
for ($Attempt = 1; $Attempt -le 60; $Attempt += 1) {
  if (Test-NetConnection 127.0.0.1 -Port 3100 -InformationLevel Quiet) {
    $LabReady = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $LabReady) { throw "临时站点没有启动" }
```

## 6. 建立数据库连接证明

确认正式数据库无连接，临时数据库有连接：

```powershell
function Get-DatabaseConnectionCount([string]$DatabaseName) {
  $Escaped = $DatabaseName.Replace("'", "''")
  return [int]((
    docker exec $PgContainer psql `
      "--username=$PgUser" `
      "--dbname=$MaintenanceDb" `
      --tuples-only `
      --no-align `
      --command "SELECT count(*) FROM pg_stat_activity WHERE datname = '$Escaped';" |
    Out-String
  ).Trim())
}

$MainConnections = Get-DatabaseConnectionCount $MainDb
$LabConnections = Get-DatabaseConnectionCount $LabDb

[pscustomobject]@{
  MainDatabase = $MainDb
  MainConnections = $MainConnections
  LabDatabase = $LabDb
  LabConnections = $LabConnections
}

if ($MainConnections -ne 0) {
  throw "正式数据库仍有应用连接"
}
if ($LabConnections -lt 1) {
  throw "临时数据库没有应用连接"
}
```

生成短时证明文件：

```powershell
$ProofDir = Join-Path `
  "data_local\staging\ai-radar\v06-version-roundtrip-lab-proof-v01" `
  (Get-Date -Format "yyyyMMddHHmmss")

New-Item -ItemType Directory -Force -Path $ProofDir | Out-Null

$ProofFile = Join-Path $ProofDir "lab-database-proof.json"

[ordered]@{
  generatedAt = [datetimeoffset]::Now.ToString('o')
  version = 'ai-radar-v06-lab-database-proof-v0.1'
  serverUrl = 'http://127.0.0.1:3100'
  databaseName = $LabDb
  mainDatabase = $MainDb
  mainDatabaseConnections = $MainConnections
  labDatabaseConnections = $LabConnections
  sourceDumpSha256 = $ActualDumpHash
} | ConvertTo-Json -Depth 5 | Set-Content `
  -LiteralPath $ProofFile `
  -Encoding UTF8
```

## 7. 只读发现版本

确保当前 PowerShell 仍有 Payload 临时密码，然后执行：

```powershell
node --env-file=.env `
  scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs `
  --candidate-manifest "$CandidateManifest" `
  --url "http://127.0.0.1:3100"
```

预期状态：

```text
inspect_ready_for_lab_execution
payloadWriteRequests: 0
matchingPublishedVersions: >= 1
matchingDraftVersions: >= 1
```

找不到与当前 published 或 latest draft 完全匹配的版本时，实验器会停止，不允许写入。

## 8. 执行临时数据库版本回环

这里只写临时数据库，最多三次 Payload 写请求：

```powershell
$env:RADAR_VERSION_ROUNDTRIP_LAB = "YES"

node --env-file=.env `
  scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs `
  --candidate-manifest "$CandidateManifest" `
  --url "http://127.0.0.1:3100" `
  --lab-database "$LabDb" `
  --database-proof "$ProofFile" `
  --confirmation "EXECUTE-V06-VERSION-ROUNDTRIP-LAB-ONLY" `
  --execute-lab

if ($LASTEXITCODE -ne 0) {
  throw "版本回环实验失败；正式数据库未参与"
}
```

成功状态必须是：

```text
version_roundtrip_lab_verified
payloadWriteRequests: 3
final.patchMatched: true
final.unrelatedPublishedStateSha256 == baseline.unrelatedPublishedStateSha256
final.humanStateSha256 == baseline.humanStateSha256
final.draftStateSha256 == baseline.draftStateSha256
final.publishedStateSha256 == afterRadar.publishedStateSha256
```

任一步不满足都会停止。临时数据库可以直接删除后重建，不需要回滚正式库。

## 9. 清理临时环境

先关闭 3100 的临时站点窗口，或：

```powershell
if ($LabProcess -and -not $LabProcess.HasExited) {
  Stop-Process -Id $LabProcess.Id
}
```

确认 3100 已关闭：

```powershell
Start-Sleep -Seconds 2
if (Test-NetConnection 127.0.0.1 -Port 3100 -InformationLevel Quiet) {
  throw "3100 端口仍然开放"
}
```

删除临时数据库：

```powershell
$EscapedLabDb = $LabDb.Replace("'", "''")

docker exec $PgContainer psql `
  "--username=$PgUser" `
  "--dbname=$MaintenanceDb" `
  --set=ON_ERROR_STOP=1 `
  --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$EscapedLabDb' AND pid <> pg_backend_pid();"

docker exec $PgContainer dropdb `
  "--username=$PgUser" `
  "--maintenance-db=$MaintenanceDb" `
  $LabDb

if ($LASTEXITCODE -ne 0) { throw "删除临时数据库失败" }
```

清理内存变量：

```powershell
$LabDatabaseUri = $null
$LabCommand = $null
Remove-Item Env:RADAR_VERSION_ROUNDTRIP_LAB -ErrorAction SilentlyContinue
```

## 10. 重新启动正式站点并只读复核

```powershell
Set-Location "D:\0GitHubtest\Baihepailei"
pnpm dev
```

然后重新运行发布差距审计。正式数据库预期仍保持：

```text
publishedMatchesV06: 2
draftOnlyV06Matches: 9361
latestDraftHasOtherFormalConclusion: 1
missing / needsReview / artifact issues: 0
```

## 判定

只有实验状态为 `version_roundtrip_lab_verified`，才进入下一 PR：

1. 重新建立正式单条 canary 执行器；
2. 仍然要求新 checkpoint；
3. 先恢复匹配的 published version；
4. 发布 Radar；
5. 恢复原 latest draft；
6. 每一步都回读 published、latest draft、人工轨道和无关字段哈希；
7. 任一步失败立即恢复数据库 checkpoint。

若实验失败，则删除临时数据库，保留证据，并根据失败阶段调整方案。不得退回旧的部分发布路径。
