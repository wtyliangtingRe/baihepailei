param(
    [string]$BackupDir = "E:\baihepaileiwikiR\backup\baihepailei_data_backup",
    [string]$OutDir = "E:\baihepaileiwikiR\backup\baihepailei_audit_out",
    [switch]$NoExportPages
)

$ErrorActionPreference = "Stop"

$DumpPath = Join-Path $BackupDir "baihepailei_data.sql.gz"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonScript = Join-Path $ScriptDir "analyze_xwiki_dump.py"

if (-not (Test-Path $DumpPath)) {
    throw "SQL dump not found: $DumpPath"
}

if (-not (Test-Path $PythonScript)) {
    throw "Python analyzer not found: $PythonScript"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$args = @(
    $PythonScript,
    "--dump", $DumpPath,
    "--out", $OutDir
)

if (-not $NoExportPages) {
    $args += "--export-pages"
}

Write-Host "Running XWiki audit..." -ForegroundColor Cyan
Write-Host "Dump: $DumpPath"
Write-Host "Out : $OutDir"

python @args

Write-Host "Done. Open this directory:" -ForegroundColor Green
Write-Host $OutDir
