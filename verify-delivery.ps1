# 工作台交付态验收（lead 专用 · 硬门禁）
# 用法: pwsh -NoProfile -File verify-delivery.ps1
# 返回: 退出码 0 = 全过；1 = 有失败项
# 每次发版后跑一次，把「日志绿≠应用好」变成可复现的数字。
param([int]$TimeoutSec = 20)

$ErrorActionPreference = 'SilentlyContinue'
# 路径从脚本自身位置推导，不写死任何本机目录
$APP  = $PSScriptRoot   # 脚本已在仓库根
$ROOT = $APP            # 仓库根即脚本所在目录
$PM   = Join-Path $APP 'pm'
$OUT  = Join-Path $APP 'out'
$APPD = Join-Path $env:APPDATA '工作台'
$fail = @()
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  $color = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1}{2}" -f $mark, $name, $(if ($detail) { "  — $detail" } else { '' })) -ForegroundColor $color
  if (-not $ok) { $script:fail += $name }
}

Write-Host "`n== 1. 交付态 ==" -ForegroundColor Cyan
$ver = (Get-Content (Join-Path $APP 'package.json') -Raw | ConvertFrom-Json).version
$procs = @(Get-Process -Name '工作台' -EA SilentlyContinue)
Check '打包版运行中' ($procs.Count -ge 3) "$($procs.Count) 进程"
$exe = Join-Path $OUT 'win-unpacked\工作台.exe'
Check 'win-unpacked 存在' (Test-Path $exe) $exe
if (Test-Path $exe) {
  $pv = (Get-Item $exe).VersionInfo.ProductVersion
  Check 'exe 版本与 package.json 一致' ($pv -like "$ver*") "exe=$pv pkg=$ver"
}

Write-Host "`n== 2. 产物（out\ 只应保留当前版本）==" -ForegroundColor Cyan
$files = @(Get-ChildItem $OUT -File -EA SilentlyContinue | Where-Object { $_.Name -notlike 'builder-debug*' })
$stale = @($files | Where-Object { $_.Name -notmatch [regex]::Escape($ver) })
Check '无旧版本残留产物' ($stale.Count -eq 0) ("残留: " + (($stale | Select-Object -ExpandProperty Name) -join ', '))
$setup = Join-Path $OUT "Workbench-Setup-$ver.exe"
$zip   = Join-Path $OUT "Workbench-$ver-portable.zip"
Check 'NSIS 安装包存在' (Test-Path $setup) $(if (Test-Path $setup) { "{0:N1} MB" -f ((Get-Item $setup).Length/1MB) } else { '缺失' })
Check '便携 zip 存在'    (Test-Path $zip)   $(if (Test-Path $zip)   { "{0:N1} MB" -f ((Get-Item $zip).Length/1MB) }   else { '缺失' })

Write-Host "`n== 3. 日志 ==" -ForegroundColor Cyan
$log = Join-Path $APPD 'main.log'
if (Test-Path $log) {
  # v1.7.37：main.js 的 console-message 事件不区分 level，所有渲染层 console（含 [pal] open 等
  #   正常调试 log）都被记为 [renderer] 行 ⇒ 旧逻辑把它整类当「错误行」会误判健康交付态 FAIL。
  #   改为按内容判错：只认真正的错误信号，普通 console.log 不算。
  $bad = @(Select-String -Path $log -Pattern '\[renderer\].*(Error|error|Uncaught|TypeError|ReferenceError|SyntaxError)|ERROR|tray icon EMPTY|FAILED|EXCEPTION' -EA SilentlyContinue)
  Check '日志无错误行' ($bad.Count -eq 0) "$($bad.Count) 条"
  $tail = @(Get-Content $log -Tail 40 -EA SilentlyContinue)
  Check '最近启动三标志齐' (($tail -match 'app ready').Count -ge 1 -and ($tail -match 'tray created').Count -ge 1 -and ($tail -match 'pulse started').Count -ge 1) ''
} else {
  Check 'main.log 存在' $false '未找到'
}

Write-Host "`n== 4. 治理文件洁净度（硬门禁）==" -ForegroundColor Cyan
$govOk = @('BACKLOG.md','PM.md','PROMPT.md','STATE.md')
$pmFiles = @(Get-ChildItem $PM -EA SilentlyContinue)
$junk = @($pmFiles | Where-Object { $govOk -notcontains $_.Name })
Check 'pm\ 只含 4 个治理文件' ($junk.Count -eq 0) ("残留: " + (($junk | Select-Object -ExpandProperty Name) -join ', '))
$stray = @(Get-ChildItem $ROOT -File -EA SilentlyContinue | Where-Object { $_.Name -match '^(pm-|lead-|qa-)' })
Check '工作区根目录无临时文件' ($stray.Count -eq 0) ("残留: " + (($stray | Select-Object -ExpandProperty Name) -join ', '))

Write-Host "`n== 5. 源码一致性 ==" -ForegroundColor Cyan
# 动态枚举全部 JS（renderer 下平铺模块随时增减，无需改门禁清单）
$jsFiles = @('main.js','preload.js','run-scan.js','src\scanner.js','src\store.js') +
  @(Get-ChildItem (Join-Path $APP 'renderer') -Filter '*.js' -EA SilentlyContinue | ForEach-Object { 'renderer\' + $_.Name })
$syn = 0
foreach ($f in $jsFiles) {
  node --check (Join-Path $APP $f) 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { $syn++ }
}
Check '全部 JS 语法正确' ($syn -eq 0) "$syn 个文件有错"
$srcFiles = @('main.js','preload.js','run-scan.js','src\scanner.js','src\store.js','renderer\style.css','renderer\index.html','package.json') +
  @($jsFiles) | ForEach-Object { Join-Path $APP $_ } | Where-Object { Test-Path $_ } | Select-Object -Unique
$newest = ($srcFiles | Get-Item | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
$built = (Get-Item $exe -EA SilentlyContinue).LastWriteTime
Check '源码不新于打包产物' ($newest -le $built) ("最新源码 $newest / 打包 $built")
# v1.7.47：机器特异性硬门禁——第 81 轮花了大量工作消除硬编码，加此检查防止未来回归
$machineHits = @()
$badPatterns = 'SZ-13041587|TCT-HQ|peigen1|D:\\code\\usou|D:\\wt-|TclLauncher|3d娃娃|fcm-helper'
foreach ($sf in @($jsFiles) + @('scan.ps1','workbench.html','workbench.template.html')) {
  $fp = Join-Path $APP $sf
  if (-not (Test-Path $fp)) { continue }
  $m = Select-String -Path $fp -Pattern $badPatterns -EA SilentlyContinue
  if ($m) { $machineHits += "$sf($($m.Count))" }
}
Check '源码无机器特异性硬编码' ($machineHits.Count -eq 0) ($(if ($machineHits.Count) { $machineHits -join ', ' } else { '' }))

Write-Host ""
if ($fail.Count -eq 0) {
  Write-Host "✔ 交付态验收全过（v$ver）" -ForegroundColor Green
  exit 0
} else {
  Write-Host ("✘ 失败 {0} 项: {1}" -f $fail.Count, ($fail -join ', ')) -ForegroundColor Red
  exit 1
}
