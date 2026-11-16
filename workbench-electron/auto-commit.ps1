# 迭代提交（PM agent 每轮收尾调用）—— 默认只 commit，不 push
# 用法: pwsh -NoProfile -File "D:\code\usou\workbench-electron\auto-commit-push.ps1" -Message "<本轮摘要>"
# 行为:
#   1. 若工作区有变更 → 自动 add -A + commit（消息含版本号与变更文件数）
#   2. 报告本地待推送 commit 数；**默认不推送**（用户自行 push）
#      仅当显式加 -Push 时才探测通路并尝试推送
# 退出码: 0 = 提交成功（或无变更）; 1 = 提交失败
param(
  [string]$Message = '',
  [switch]$Push
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
- 自动提交: workbench-electron/auto-commit-push.ps1（只 commit，push 由用户自行执行）
"@
  $r = Git @('add', '-A')
  if ($r.code -ne 0) { Write-Host "✘ git add 失败:`n$($r.out)" -ForegroundColor Red; exit 1 }
  $r = Git @('commit', '-q', '-m', $body)
  if ($r.code -ne 0) { Write-Host "✘ git commit 失败:`n$($r.out)" -ForegroundColor Red; exit 1 }
  Write-Host "✔ 已提交: $(& $git log --oneline -1)" -ForegroundColor Green
} else {
  Write-Host "· 工作区无变更，跳过提交" -ForegroundColor DarkGray
}

# ---------- 2. 统计待推送 ----------
$localCount = [int]((& $git rev-list --count HEAD 2>$null) -as [int])
$remoteCount = 0
$rc = & $git rev-list --count 'origin/main' 2>$null
if ($LASTEXITCODE -eq 0 -and $rc) { $remoteCount = [int]($rc -as [int]) }
$ahead = [Math]::Max(0, $localCount - $remoteCount)

if (-not $Push) {
  Write-Host ("· 按策略只提交不推送 —— 本地待推送 commit: {0}（本地 {1} / 远端 {2}）" -f $ahead, $localCount, $remoteCount) -ForegroundColor Yellow
  Write-Host "  需要推送时由你自行执行： cd D:\code\usou; git push -u origin main" -ForegroundColor DarkGray
  exit 0
}

# ---------- 3. 仅在显式 -Push 时探测并推送 ----------
function Test-Net([string]$host_, [int]$port, [int]$timeoutMs = 4000) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect($host_, $port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne($timeoutMs)) { $c.Close(); return $false }
    $c.EndConnect($ar); $c.Close(); return $true
  } catch { return $false }
}

$proxyPort = 7897
$proxyAlive = Test-Net '127.0.0.1' $proxyPort

$sshOk = $false
try {
  $probe = & 'C:\Program Files\Git\usr\bin\ssh.exe' -T -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new git@github.com 2>&1
  $probeTxt = ($probe -join ' ')
  $sshOk = ($probeTxt -match 'successfully authenticated|Welcome to GitHub') -and ($probeTxt -notmatch 'exchange identification|reset by peer|Connection refused|timed out')
} catch { $sshOk = $false }

$httpsOk = $false
if (-not $sshOk) {
  try {
    $env:GIT_TERMINAL_PROMPT = '0'
    $t = & $git -c http.proxy= -c https.proxy= ls-remote https://github.com/chenpeigen2/usou.git 2>&1
    $httpsOk = ($LASTEXITCODE -eq 0)
  } catch { $httpsOk = $false }
}

Write-Host "── 推送通路探测 ──" -ForegroundColor Cyan
Write-Host ("  SSH(22/443)  : {0}" -f $(if ($sshOk) { '可用' } else { '不可用' }))
Write-Host ("  HTTPS(443)   : {0}" -f $(if ($httpsOk) { '可用' } else { '不可用' }))
Write-Host ("  本地代理:{0} : {1}" -f $proxyPort, $(if ($proxyAlive) { '在线' } else { '离线' }))

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
  $r = Git @('push', '-u', 'https://github.com/chenpeigen2/usou.git', 'main')
  if ($r.code -eq 0) { Write-Host "✔ 推送成功（HTTPS）" -ForegroundColor Green; & $git remote set-url origin 'git@github.com:chenpeigen2/usou.git' 2>$null; exit 0 }
  Write-Host "✘ HTTPS 推送失败:`n$($r.out)" -ForegroundColor Red
}
Write-Host "⚠ 网络不可达，commit 已留在本地 main（未推送）" -ForegroundColor Yellow
exit 0
