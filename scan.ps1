# ============================================================
#  工作台数据扫描器  scan.ps1
#  扫描本机磁盘 / 项目群 / 最近动态，生成 data.json，
#  并把数据注入 workbench.template.html 生成自包含的 workbench.html。
#
#  用法:  pwsh -NoProfile -ExecutionPolicy Bypass -File scan.ps1 [-Fast]
#          -Fast : 跳过项目体量统计（更快）
#  兼容 Windows PowerShell 5.1 与 PowerShell 7+。
# ============================================================
param([switch]$Fast)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

$wbDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$tplPath  = Join-Path $wbDir 'workbench.template.html'
$jsonPath = Join-Path $wbDir 'data.json'
$htmlPath = Join-Path $wbDir 'workbench.html'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$gitExe = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path -LiteralPath $gitExe)) { $gitExe = 'git' }

function Write-Step([string]$msg) { Write-Host ("[扫描] {0}" -f $msg) -ForegroundColor Cyan }

# ---------- 1) 项目体量: robocopy /L 只列表不复制，排除重目录 ----------
$sizeExclude = @(
  'node_modules','build','.gradle','.git','dist','.next','target','__pycache__',
  '.venv','venv','.idea','.kotlin','.tmp','uvcache','obj','bin','.codegraph',
  '.dart_tool','Pods','.pnpm-store','.turbo','coverage','.cache'
)

function Get-DirSize([string]$path) {
  $out = robocopy $path NULL /L /E /BYTES /XJ /NFL /NDL /NJH /NP /R:0 /W:0 /XD @($sizeExclude) 2>$null
  $bytes = 0L; $files = 0
  foreach ($l in $out) {
    if ($l -match '^\s*Bytes\s*:\s+(\d+)') { $bytes = [long]$Matches[1] }
    if ($l -match '^\s*Files\s*:\s+(\d+)') { $files = [int]$Matches[1] }
  }
  [PSCustomObject]@{ bytes = $bytes; files = $files }
}

# ---------- 2) git 元数据: 分支 / 最近提交 / 未提交改动(tracked) ----------
function Get-GitInfo([string]$path) {
  $branch = & $gitExe -C $path rev-parse --abbrev-ref HEAD 2>$null
  if (-not $branch) { return $null }
  $log = & $gitExe -C $path log -1 --format='%ci|%s' 2>$null
  $ct = ''; $cs = ''
  if ($log) {
    $idx = $log.IndexOf('|')
    if ($idx -gt 0) { $ct = $log.Substring(0, $idx); $cs = $log.Substring($idx + 1) }
  }
  $st = & $gitExe -C $path status --porcelain -uno 2>$null
  $dirty = @($st | Where-Object { $_ -and $_.Trim() }).Count
  [PSCustomObject]@{ branch = [string]$branch; commitTime = $ct; commitSubject = $cs; dirty = $dirty }
}

# ---------- 3) 项目类型识别 ----------
function Get-ProjectType([string]$path) {
  if (Test-Path -LiteralPath (Join-Path $path 'settings.gradle'))     { return 'Android' }
  if (Test-Path -LiteralPath (Join-Path $path 'settings.gradle.kts')) { return 'Android' }
  if (Test-Path -LiteralPath (Join-Path $path 'build.gradle'))        { return 'Android' }
  if (Test-Path -LiteralPath (Join-Path $path 'build.gradle.kts'))    { return 'Android' }
  if (Test-Path -LiteralPath (Join-Path $path 'package.json'))        { return 'Web' }
  if (Test-Path -LiteralPath (Join-Path $path 'pom.xml'))             { return 'Java' }
  if (Test-Path -LiteralPath (Join-Path $path 'Cargo.toml'))          { return 'Rust' }
  if (Test-Path -LiteralPath (Join-Path $path 'go.mod'))              { return 'Go' }
  if ((Test-Path -LiteralPath (Join-Path $path 'pyproject.toml')) -or
      (Test-Path -LiteralPath (Join-Path $path 'requirements.txt')))  { return 'Python' }
  $mds = @(Get-ChildItem -LiteralPath $path -Filter '*.md' -File -EA SilentlyContinue)
  if ($mds.Count -ge 3) { return '文档' }
  return '其他'
}

# ---------- 4) 枚举项目根 ----------
Write-Step '枚举项目根...'
$roots = New-Object System.Collections.Generic.List[string]

# 4.1 D:\code 全部子目录（排除隐藏/临时/自身）
Get-ChildItem -LiteralPath 'D:\code' -Directory -Force -EA SilentlyContinue | Where-Object {
  $_.Name -notmatch '^[\._]' -and $_.Name -ne '新建文件夹' -and $_.Name -ne 'usou'
} | ForEach-Object { $roots.Add($_.FullName) }

# 4.2 D:\ 根: 含 .git 或项目标记文件的目录
$markers = @('settings.gradle','settings.gradle.kts','build.gradle','build.gradle.kts',
             'package.json','pom.xml','pyproject.toml','requirements.txt','Cargo.toml','go.mod')
$dRootSkip = @(
  '.gradle','.pnpm-store','uvcache','gradle','node_modules','Temp','tmp','download','code',
  'tools','work','skills','Users','platform-tools','Snipaste-2.11.3-x64','proguard-7.9.1',
  'dagger-dagger-2.60.1','nextjs','android-studio-quail4-windows','GradleUserHome',
  'GradleCache-TclLauncher','归档整理_20261105','Program Files','Program Files (x86)'
)
Get-ChildItem -LiteralPath 'D:\' -Directory -Force -EA SilentlyContinue | Where-Object {
  ($_.Name -notmatch '^(\$|Config\.Msi|System Volume)') -and ($dRootSkip -notcontains $_.Name)
} | ForEach-Object {
  $isGit = Test-Path -LiteralPath (Join-Path $_.FullName '.git')
  $hasMarker = $false
  foreach ($m in $markers) { if (Test-Path -LiteralPath (Join-Path $_.FullName $m)) { $hasMarker = $true; break } }
  if ($isGit -or $hasMarker) { $roots.Add($_.FullName) }
}

# 4.3 强制纳入的工作区（Launcher 主战场，内部还有嵌套 git 工作副本）
$force = @('D:\CLAUNCER2','D:\CLauncher','D:\BBKLauncher','D:\VClauncher',
           'D:\oppo_a6_launcher','D:\LauncherSwipeDetect','D:\TclLauncher')
foreach ($f in $force) {
  if ((Test-Path -LiteralPath $f) -and -not $roots.Contains($f)) { $roots.Add($f) }
  Get-ChildItem -LiteralPath $f -Directory -Force -EA SilentlyContinue | ForEach-Object {
    $sub = $_.FullName
    if ((Test-Path -LiteralPath (Join-Path $sub '.git')) -and -not $roots.Contains($sub)) { $roots.Add($sub) }
  }
}

# 4.4 E:\workspace 与 AndroidStudioProjects
Get-ChildItem -LiteralPath 'E:\workspace' -Directory -Force -EA SilentlyContinue |
  ForEach-Object { $roots.Add($_.FullName) }
Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE 'AndroidStudioProjects') -Directory -Force -EA SilentlyContinue |
  ForEach-Object { $roots.Add($_.FullName) }

$roots = @($roots | Select-Object -Unique)
Write-Step ("共识别 {0} 个项目/工作区" -f $roots.Count)

# ---------- 5) 逐项目采集 ----------
$projects = foreach ($r in $roots) {
  $gi   = Get-GitInfo $r
  $size = [PSCustomObject]@{ bytes = 0L; files = 0 }
  if (-not $Fast) { $size = Get-DirSize $r }
  $item = [PSCustomObject]@{
    name              = Split-Path -Leaf $r
    path              = $r
    type              = Get-ProjectType $r
    isGit             = [bool]$gi
    branch            = $(if ($gi) { $gi.branch } else { '' })
    lastCommitTime    = $(if ($gi) { $gi.commitTime } else { '' })
    lastCommitSubject = $(if ($gi) { $gi.commitSubject } else { '' })
    dirty             = $(if ($gi) { $gi.dirty } else { 0 })
    sizeMB            = [math]::Round($size.bytes / 1MB, 1)
    fileCount         = $size.files
    rootMTime         = (Get-Item -LiteralPath $r -Force -EA SilentlyContinue).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
  }
  $tag = ''
  if ($item.isGit) { $tag = "  git:{0}  dirty:{1}" -f $item.branch, $item.dirty }
  Write-Host ("  · {0}  [{1}]  {2:N1}MB{3}" -f $item.name, $item.type, $item.sizeMB, $tag) -ForegroundColor DarkGray
  $item
}

# ---------- 6) 磁盘 ----------
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -ne 'Temp' -and ($_.Used -or $_.Free) } |
  ForEach-Object {
    [PSCustomObject]@{
      name    = $_.Name
      root    = $_.Root
      usedGB  = [math]::Round($_.Used / 1GB, 1)
      freeGB  = [math]::Round($_.Free / 1GB, 1)
      totalGB = [math]::Round(($_.Used + $_.Free) / 1GB, 1)
    }
  }

# ---------- 7) 最近动态（限深遍历，避免全盘慢扫） ----------
Write-Step '收集最近动态...'
$recent = New-Object System.Collections.Generic.List[object]
function Add-Files([string]$dir, [int]$levels) {
  Get-ChildItem -LiteralPath $dir -File -Force -EA SilentlyContinue | ForEach-Object {
    $recent.Add([PSCustomObject]@{
      name   = $_.Name
      dir    = Split-Path -Parent $_.FullName
      path   = $_.FullName
      sizeKB = [math]::Round($_.Length / 1KB, 1)
      mtime  = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    })
  }
  if ($levels -gt 0) {
    Get-ChildItem -LiteralPath $dir -Directory -Force -EA SilentlyContinue |
      ForEach-Object { Add-Files $_.FullName ($levels - 1) }
  }
}
Add-Files (Join-Path $env:USERPROFILE 'Desktop')   1
Add-Files (Join-Path $env:USERPROFILE 'Documents') 1
Add-Files (Join-Path $env:USERPROFILE 'Downloads') 0
Add-Files 'D:\code'      1
Add-Files 'E:\workspace' 1
$recent = @($recent | Sort-Object mtime -Descending | Select-Object -First 60)

# ---------- 8) 用户三大文件夹概览 ----------
$uf = @{}
foreach ($n in 'Desktop','Documents','Downloads') {
  $p = Join-Path $env:USERPROFILE $n
  $items = Get-ChildItem -LiteralPath $p -Force -EA SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 15 |
    ForEach-Object {
      [PSCustomObject]@{
        name   = $_.Name
        path   = $_.FullName
        isDir  = $_.PSIsContainer
        sizeKB = $(if ($_.PSIsContainer) { $null } else { [math]::Round($_.Length / 1KB, 1) })
        mtime  = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
      }
    }
  $count = @(Get-ChildItem -LiteralPath $p -Force -EA SilentlyContinue).Count
  $uf[$n] = [PSCustomObject]@{ count = $count; items = @($items) }
}

# ---------- 9) 工具链 ----------
$tools = foreach ($t in 'git','node','npm','pnpm','python','java','adb') {
  $cmd = Get-Command $t -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) {
    $v = ''
    if ($t -eq 'adb')     { $v = (& $cmd.Source version 2>$null  | Select-Object -First 1) }
    elseif ($t -eq 'java'){ $v = (& $cmd.Source -version 2>&1    | Select-Object -First 1) }
    else                  { $v = (& $cmd.Source --version 2>$null | Select-Object -First 1) }
    [PSCustomObject]@{ name = $t; version = [string]$v; path = $cmd.Source }
  }
}

# ---------- 10) AI CLI 痕迹 ----------
$aiCandidates = @(
  '.claude','.codex','.codebuddy','.codebuddycn','.cursor','.qoder','.qoder-cn',
  '.kimi-code','.kimi-work','.kimi-webbridge','.trae-cn','.zcode','.copilot','.minimax',
  '.qwenworkcn','.jugg','.pi','.mavis','.workbuddy','.workbuddy-ai','.qmind','.codegraph',
  '.tlink','.tmeet','.loongsuite-pilot','.agent-browser','.dsh','.qoderwork'
)
$aiTools = @($aiCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $env:USERPROFILE $_) })

# ---------- 11) 快速入口 ----------
$linkPaths = @(
  @{ name = '桌面';                    path = (Join-Path $env:USERPROFILE 'Desktop') },
  @{ name = '文档';                    path = (Join-Path $env:USERPROFILE 'Documents') },
  @{ name = '下载';                    path = (Join-Path $env:USERPROFILE 'Downloads') },
  @{ name = 'D:\code 项目群';          path = 'D:\code' },
  @{ name = 'TclLauncher 主仓库';      path = 'D:\TclLauncher' },
  @{ name = 'CLAUNCER2 工作区';        path = 'D:\CLAUNCER2' },
  @{ name = 'D:\tools 工具';           path = 'D:\tools' },
  @{ name = 'D:\download 下载';        path = 'D:\download' },
  @{ name = '归档整理_20261105';       path = 'D:\归档整理_20261105' },
  @{ name = 'E:\workspace';            path = 'E:\workspace' },
  @{ name = 'E:\launcher_hprof 内存分析'; path = 'E:\launcher_hprof' },
  @{ name = 'E:\android-development-docs'; path = 'E:\android-development-docs' },
  @{ name = 'E:\WorkBuddy Worksapace 日报'; path = 'E:\WorkBuddy Worksapace' },
  @{ name = 'F:\TCL_Layout_Toolv0.6';  path = 'F:\TCL_Layout_Toolv0.6' },
  @{ name = 'F:\CDriveData C盘迁移数据'; path = 'F:\CDriveData' },
  @{ name = 'C:\TCL';                  path = 'C:\TCL' }
)
$links = @($linkPaths | Where-Object { Test-Path -LiteralPath $_.path } |
  ForEach-Object { [PSCustomObject]@{ name = $_.name; path = $_.path } })

# ---------- 12) 系统元信息 ----------
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$meta = [PSCustomObject]@{
  host       = $env:COMPUTERNAME
  user       = "$env:USERDOMAIN\$env:USERNAME"
  os         = $os.Caption
  arch       = $os.OSArchitecture
  cpu        = $cpu
  ramTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  ramFreeGB  = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  bootTime   = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')
  scanTime   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  durationSec= [math]::Round($sw.Elapsed.TotalSeconds, 1)
  fast       = [bool]$Fast
}

# ---------- 13) 汇总输出 ----------
$data = [PSCustomObject]@{
  meta        = $meta
  drives      = @($drives)
  projects    = @($projects)
  recent      = $recent
  userFolders = $uf
  tools       = @($tools)
  aiTools     = $aiTools
  links       = $links
}
$json = $data | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Step ("已写出 {0} ({1:N0} KB)" -f $jsonPath, ((Get-Item -LiteralPath $jsonPath).Length / 1KB))

if (Test-Path -LiteralPath $tplPath) {
  $tpl  = [System.IO.File]::ReadAllText($tplPath)
  $safe = $json.Replace('</', '<\/')
  $html = $tpl.Replace('__WB_DATA__', $safe)
  [System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding($false)))
  Write-Step ("已生成 {0} ({1:N0} KB)" -f $htmlPath, ((Get-Item -LiteralPath $htmlPath).Length / 1KB))
} else {
  Write-Warning "模板缺失: $tplPath （只输出了 data.json）"
}

Write-Host ''
Write-Host ('✔ 扫描完成: {0} 个项目, {1} 条最近动态, 耗时 {2}s' -f
  @($projects).Count, @($recent).Count, $meta.durationSec) -ForegroundColor Green
