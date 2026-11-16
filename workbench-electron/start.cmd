@echo off
rem 工作台管理软件启动入口（使用内置 Electron 运行时，无需安装任何依赖）
rem 防御：某些终端环境（VS Code / DSH）会注入 ELECTRON_RUN_AS_NODE，导致 Electron 被当作纯 Node 运行
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0runtime\electron\electron.exe" "%~dp0."
