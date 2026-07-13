@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pg_dump.ps1" %*
exit /b %ERRORLEVEL%
