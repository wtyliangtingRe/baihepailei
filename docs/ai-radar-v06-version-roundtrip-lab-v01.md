# AI Radar v0.6 版本回环实验室 v0.1

## 背景

单条真实 canary 已证明：在已有 newer draft 的 Work 上执行部分 PATCH，并设置 `_status: "published"`，Payload 会把 latest draft 中未出现在 PATCH 请求体里的字段一并带入 published/main。

旧执行器已永久禁用。本实验只在从发布前 checkpoint 恢复出的临时 PostgreSQL 数据库中验证：

```text
恢复与当前 published 完全相同的历史 published version
→ 确认 latest version 已变成干净 published 基线
→ 发布 Radar 白名单补丁
→ 确认 published 无关字段和人工轨道不变
→ 恢复原 latest draft version
→ 确认 published 保留 Radar，latest draft 恢复原状
```

Payload 官方文档说明：`draft=true` 的普通 draft 更新只写 versions table；`_status=published` 会执行正式发布；读取 `draft=true` 返回最新版本；恢复版本操作可通过 REST 或 Local API 调用。

实验成功也只允许继续设计新的单条正式 canary，不允许直接批量发布。

## 安全边界

实验器：

```text
scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs
```

强制要求：

- URL 必须是 loopback 且端口必须为 `3100`；
- 临时数据库名必须匹配 `baihepailei_radar_lab_*`；
- 正式数据库连接数必须为 0；
- 临时数据库必须有应用连接；
- 数据库证明文件不得超过 30 分钟；
- 临时库来源 dump 哈希必须与 candidate 绑定值一致；
- 写模式要求 `RADAR_VERSION_ROUNDTRIP_LAB=YES` 和精确确认字符串；
- 最多三次 Payload 写请求；
- 不直接写 PostgreSQL 表；
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

## 固定输入

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

## 停止正式站点

在运行 `pnpm dev` 的窗口按 `Ctrl+C`，然后确认：

```powershell
foreach ($Port in @(3000, 3100)) {
  if (Test-NetConnection 127.0.0.1 -Port $Port -InformationLevel Quiet) {
    throw "端口 $Port 仍在监听"
  }
}
```

## 建立临时数据库

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

## 派生临时 URI，不打印凭据

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

## 安全启动 3100 临时站点

URI 只通过子进程继承，不放入命令行参数：

```powershell
$env:RADAR_LAB_DATABASE_URI = $LabDatabaseUri

$LabProcess = Start-Process `
  pwsh `
  -ArgumentList @(
    '-NoExit',
    '-File',
    (Join-Path (Get-Location) `
      'scripts\radar\start-ai-radar-v06-version-roundtrip-lab-v01.ps1')
  ) `
  -WorkingDirectory (Get-Location) `
  -PassThru

Remove-Item Env:RADAR_LAB_DATABASE_URI -ErrorAction SilentlyContinue
$LabDatabaseUri = $null
```

等待端口：

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

## 建立短时数据库证明

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

if ($MainConnections -ne 0) { throw "正式数据库仍有应用连接" }
if ($LabConnections -lt 1) { throw "临时数据库没有应用连接" }

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

## 只读发现版本

```powershell
node --env-file=.env `
  scripts/radar/lab-ai-radar-v06-version-roundtrip-v01.mjs `
  --candidate-manifest "$CandidateManifest" `
  --url "http://127.0.0.1:3100"
```

必须得到：

```text
inspect_ready_for_lab_execution
payloadWriteRequests: 0
matchingPublishedVersions: >= 1
matchingDraftVersions: >= 1
```

## 执行临时数据库回环

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

成功必须同时满足：

```text
status: version_roundtrip_lab_verified
payloadWriteRequests: 3
final.patchMatched: true
final.unrelatedPublishedStateSha256 == baseline.unrelatedPublishedStateSha256
final.humanStateSha256 == baseline.humanStateSha256
final.draftStateSha256 == baseline.draftStateSha256
final.publishedStateSha256 == afterRadar.publishedStateSha256
```

## 清理临时环境

先关闭 3100 窗口，或：

```powershell
if ($LabProcess -and -not $LabProcess.HasExited) {
  Stop-Process -Id $LabProcess.Id
}

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

Remove-Item Env:RADAR_VERSION_ROUNDTRIP_LAB -ErrorAction SilentlyContinue
```

最后重新用普通 `.env` 启动 3000 正式本地站点，并只读运行发布差距审计。正式数据库必须仍保持：

```text
publishedMatchesV06: 2
draftOnlyV06Matches: 9361
latestDraftHasOtherFormalConclusion: 1
missing / needsReview / artifact issues: 0
```
