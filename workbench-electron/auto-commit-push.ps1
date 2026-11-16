# 迭代提交与推送（PM agent 每轮收尾调用）
# 用法: pwsh -NoProfile -File "D:\code\usou\auto-commit-push.ps1" -Message "<本轮摘要>"
# 行为:
#   1. 若工作区有变更 → 自动 add -A + commit（带版本号与摘要）
#   2. 探测推送通路（SSH / HTTPS / 本地代理 7897）→ 可用则 push；不可用则把 commit 留在本地并明确报告
# 退出码: 0 = 提交成功（push 成功或已排队待网络恢复）; 1 = 提交失败
param(
  [string]$Message = '',
  [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
$git = 'C:\Program Files\Git\cmd\git.exe'
$ROOT = 'D:\code\usou'
Set-Location $ROOT

function Git([string[]]$a) { $out = & $git @a 2>&1; return @{ out = ($out -join "`n"); code = $LASTEXITCODE } }

# ---------- 1. 有变更则提交 ----------
$st = Git @('status', '--porcelain')
$changed = @($st.out -split "`n" | Where-Object { $_.Trim() })
$pkgVer = '?'
try { $pkgVer = (Get-Content (Join-Path $ROOT 'workbench-electron\package.json') -Raw | ConvertFrom-Json).version } catch {}

if ($changed.Count -gt 0) {
  $msg = if ($Message.Trim()) { $Message.Trim() } else { "chore: 工作台 v$pkgVer 迭代更新" }
  $body = @"
$msg

- 版本: v$pkgVer
- 变更文件: $($changed.Count) 个
- 自动提交: workbench-electron/auto-commit-push.ps1
"@
  $r = Git @('add', '-A')
  if ($r.code -ne 0) { Write-Host "✘ git add 失败:`n$($r.out)" -ForegroundColor Red; exit 1 }
  $r = Git @('commit', '-q', '-m', $body)
  if ($r.code -ne 0) { Write-Host "✘ git commit 失败:`n$($r.out)" -ForegroundColor Red; exit 1 }
  Write-Host "✔ 已提交: $(& $git log --oneline -1)" -ForegroundColor Green
} else {
  Write-Host "· 工作区无变更，跳过提交" -ForegroundColor DarkGray
}

if ($NoPush) { Write-Host "· 按要求跳过 push"; exit 0 }

# ---------- 2. 探测推送通路 ----------
function Test-Net([string]$host_, [int]$port, [int]$timeoutMs = 4000) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect($host_, $port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne($timeoutMs)) { $c.Close(); return $false }
    $c.EndConnect($ar); $c.Close(); return $true
  } catch { return $false }
}

$proxyPort = 7897   # 注册表里的 Clash/Mihomo 混合端口
$proxyAlive = Test-Net '127.0.0.1' $proxyPort

# SSH 必须**真握手**才算可用（TCP 端口通 ≠ SSH 可用：网关可能接受连接后 reset）
$sshOk = $false
try {
  $env:GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes'
  $probe = & 'C:\Program Files\Git\usr\bin\ssh.exe' -T -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new git@github.com 2>&1
  $probeTxt = ($probe -join ' ')
  # GitHub 认证成功会回 "successfully authenticated"（带 -T 时是欢迎语）；连接被拦则是 reset/exchange failure
  $sshOk = ($probeTxt -match 'successfully authenticated|Welcome to GitHub') -and ($probeTxt -notmatch 'exchange identification|reset by peer|Connection refused|timed out')
} catch { $sshOk = $false }

$httpsOk = $false
if (-not $sshOk) {
  try {
    $code = (& curl.exe -s -o NUL -w '%{http_code}' --max-time 8 https://github.com 2>$null)
    $httpsOk = ($code -eq '200')
  } catch { $httpsOk = $false }
}

Write-Host "── 推送通路探测 ──" -ForegroundColor Cyan
Write-Host ("  SSH(22/443)  : {0}" -f $(if ($sshOk) { '可用' } else { '不可用' }))
Write-Host ("  HTTPS(443)   : {0}" -f $(if ($httpsOk) { '可用' } else { '不可用' }))
Write-Host ("  本地代理:{0} : {1}" -f $proxyPort, $(if ($proxyAlive) { '在线' } else { '离线' }))

$ahead = 0
Write-Host "  待推送 commit: 待计算"

# ---------- 3. 推送 ----------
# 待推送数量：远程追踪分支可能不存在（从未 push 过），此时全部本地 commit 都是待推送
$localCount = [int]((& $git rev-list --count HEAD 2>$null) -as [int])
$remoteCount = 0
$rc = & $git rev-list --count 'origin/main' 2>$null
if ($LASTEXITCODE -eq 0 -and $rc) { $remoteCount = [int]($rc -as [int]) }
$ahead = [Math]::Max(0, $localCount - $remoteCount)
Write-Host ("  待推送 commit: {0}（本地 {1} / 远端 {2}）" -f $ahead, $localCount, $remoteCount)

$env:GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10'
if ($sshOk) {
  Write-Host "→ 通过 SSH 推送…" -ForegroundColor Cyan
  $r = Git @('push', '-u', 'origin', 'main')
  if ($r.code -eq 0) { Write-Host "✔ 推送成功" -ForegroundColor Green; exit 0 }
  Write-Host "✘ SSH 推送失败:`n$($r.out)" -ForegroundColor Red
}
if ($httpsOk -or $proxyAlive) {
  if ($proxyAlive) { $env:HTTPS_PROXY = "http://127.0.0.1:$proxyPort"; $env:HTTP_PROXY = $env:HTTPS_PROXY }
  Write-Host "→ 通过 HTTPS 推送…" -ForegroundColor Cyan
  # 强制走 HTTPS（remote 已是 SSH 地址，这里用显式 URL 覆盖）
  $r = Git @('push', '-u', 'https://github.com/chenpeigen2/usou.git', 'main')
  if ($r.code -eq 0) {
    Write-Host "✔ 推送成功（HTTPS）" -ForegroundColor Green
    # 顺手把 remote 改回 SSH 地址
    & $git remote set-url origin 'git@github.com:chenpeigen2/usou.git' 2>$null
    exit 0
  }
  Write-Host "✘ HTTPS 推送失败:`n$($r.out)" -ForegroundColor Red
}

Write-Host ""
Write-Host "⚠ 网络不可达，commit 已安全留在本地 main 分支（未推送）" -ForegroundColor Yellow
Write-Host "  原因: GitHub TLS 被网络策略拦截 / SSH 22 被阻断 / 本地代理 $proxyPort 离线" -ForegroundColor Yellow
Write-Host "  恢复方式（任选其一）:" -ForegroundColor Yellow
Write-Host "    1) 启动本机代理客户端（Clash/Mihomo，监听 127.0.0.1:$proxyPort）后重跑本脚本" -ForegroundColor Yellow
Write-Host "    2) 手动执行: git push -u origin main" -ForegroundColor Yellow
exit 0
