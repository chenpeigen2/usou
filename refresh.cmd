@echo off
rem 工作台刷新入口：重新扫描本机数据并打开工作台页面
cd /d "%~dp0"
echo 正在扫描本机数据（全量约 3-8 分钟，与仓库大小相关；想快可手动跑 scan.ps1 -Fast），完成后将自动打开工作台...
where pwsh >nul 2>nul && (pwsh -NoProfile -ExecutionPolicy Bypass -File "scan.ps1") || (powershell -NoProfile -ExecutionPolicy Bypass -File "scan.ps1")
start "" "workbench.html"
