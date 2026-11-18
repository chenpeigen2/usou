'use strict';
process.env.UV_THREADPOOL_SIZE = '16'; // fs stat/readdir 并发容量，性能关键（必须在首次 IO 前）
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const scanner = require('./src/scanner');
const store = require('./src/store');

let win = null;
let tray = null;
let forceQuit = false; // 真退出标志：托盘「退出」/ before-quit 置真，放行 close
let scanning = false;
let analyzing = false;
let qaShotDir = '';   // QA 钩子：--qashot=<目录> → 主进程逐视图截图（不受桌面焦点抢占影响）

/* 文件日志：stdout 管道可能随启动器退出失效，落盘更可靠 */
const fs = require('fs');
const logFile = path.join(store.dataDir(), 'main.log');
function log(msg) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, new Date().toISOString().slice(11, 19) + ' ' + msg + '\n');
  } catch (_e) { /* ignore */ }
}

if (!app.requestSingleInstanceLock()) { app.quit(); }

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

/* ---------- 窗口状态记忆（move/resize/maximize 防抖 600ms，close 时立即落盘） ---------- */

function saveWinState() {
  if (!win || win.isDestroyed()) return;
  try {
    // 最大化/最小化时 getBounds() 返回最大化尺寸或系统最小化坐标(-32000)，
    // 这两种情况取「正常态」边界，避免下次启动窗口跑偏
    const b = (win.isMaximized() || win.isMinimized()) ? win.getNormalBounds() : win.getBounds();
    const cur = store.getSettings(); // 先取全量再合并，避免覆盖 renderer 保存的其他字段
    cur.winBounds = b;
    cur.winMaximized = win.isMaximized();
    store.setSettings(cur);
  } catch (e) { log('saveWinState ERROR ' + ((e && e.stack) || e)); }
}
let winStateTimer = null;
function scheduleSaveWinState() {
  if (winStateTimer) clearTimeout(winStateTimer);
  winStateTimer = setTimeout(() => { winStateTimer = null; saveWinState(); }, 600);
}

function showMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- 托盘常驻 ---------- */

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')).resize({ width: 16, height: 16 });
  if (icon.isEmpty()) log('tray icon EMPTY: renderer/icon.png 缺失或不可读');
  tray = new Tray(icon);
  tray.on('double-click', showMainWindow);
  log('tray created');
  refreshTrayMenu('启动', { force: true });
  // 定时重建：让「上次扫描 X 前」不冻结成假信息（原生菜单的 label 是构建那一刻定死的）。
  // 60s 粒度足够（label 只在分钟级变化），且只在 label 真的变了才动手重建。
  trayMenuTimer = setInterval(() => { refreshTrayMenu('定时'); }, 60 * 1000);
  runTrayQa();
}

/* ---------- 托盘动态信息（v1.7.11） ----------
   托盘菜单是**原生 OS 菜单**：label 在 Menu.buildFromTemplate 那一刻即被固化，此后不再变化。
   旧实现只在「切换开机自启」时重建一次 ⇒ 菜单里的信息长期是过期的（甚至陈旧到与缓存矛盾）。
   现在两条重建路径：
     ① 数据/设置变化：扫描完成（scan:done）、设置变更（settings:set）、开机自启切换 → 立即重建；
     ② 时间推进：60s 定时器，仅当 label 列表真的变化时才动手（无变化直接跳过）。
   文案口径：相对时间（"3 小时前"）+ 绝对时间（"（13:03）"）并列 ——
   相对值可能因重建滞后而不够准，但绝对时间永远与缓存严格一致，用户可自行校正。 */
const TRAY_MENU_HOLD = 3;               // 保留最近几个 Menu 对象：避免菜单仍打开时被 GC 销毁原生菜单
const trayMenuHistory = [];
let trayMenuTimer = null;
let lastTrayLabels = [];
let trayQaSpec = '';

/* v1.7.18：失效项目集合 —— 供托盘「未提交」口径剔除**已删除目录**的项目。
   背景：v1.7.15 已给失效项目行去掉「未提交 ●N」标记（目录都没了还标未提交 = 陈述不成立的事实），
   但托盘 L128 的「未提交：N 个仓库 / M 个文件」仍在算它们 ⇒ 实测本机 `某已删除目录` / `某已删除目录`
   各带 dirty=1 ⇒ 托盘播报「5 个仓库 / 8 个文件」，真实应为「3 个仓库 / 6 个文件」，
   与同一屏上真正带标记的 3 行自相矛盾。
   设计（见 DECISIONS 第二十八轮 Q2）：
     · 通道复用**既有同步** `pathExists()`（= `path:exists` 内部同一个 `existsSync` 判定）⇒ **零新增 IPC**、
       且与渲染层 `PROJ_DEAD` **同源同判定** ⇒ 两个进程不可能给出两种答案；
     · **只查 isGit 且 dirty>0 的项目**（其余项目根本不影响「未提交」口径）⇒ 本机实际 5 次 existsSync，不是 59 次；
     · 按 `scanTime` 做键 + 5 秒 TTL 的 memo：启动/扫描完成/定时刷新可能同秒连发，TTL 内复用；
       用 TTL 而非永久缓存 ⇒ 用户刚删掉目录时最多 5 秒托盘就跟着变（永久缓存会一直骗人到下次扫描）。 */
const TRAY_DEAD_TTL = 5000;
let trayDeadMemo = { key: '', at: 0, set: null };
function trayDeadDirtySet(ps, scanTime) {
  const key = String(scanTime) + '|' + ps.length;
  const now = Date.now();
  if (trayDeadMemo.set && trayDeadMemo.key === key && (now - trayDeadMemo.at) < TRAY_DEAD_TTL) return trayDeadMemo.set;
  const set = new Set();
  for (const p of ps) {
    if (!p || !p.isGit || !(Number(p.dirty) > 0)) continue;
    if (!pathExists(p.path)) set.add(p.path);
  }
  trayDeadMemo = { key: key, at: now, set: set };
  return set;
}

function trayStatus() {
  const out = { hasCache: false, scanTime: '', clock: '', ageText: '暂无数据', ageMinutes: null, projectCount: 0, dirtyProjects: 0, dirtyFiles: 0 };
  let cache = null;
  try { cache = store.getScan(); } catch (_e) { cache = null; }
  if (!cache || !cache.meta || !cache.meta.scanTime) return out;
  const s = String(cache.meta.scanTime);
  out.hasCache = true;
  out.scanTime = s;
  out.clock = s.length >= 16 ? s.slice(11, 16) : s;
  const t = new Date(s.slice(0, 19).replace(' ', 'T')).getTime();
  if (Number.isFinite(t)) {
    let d = Math.round((Date.now() - t) / 60000);
    if (d < 0) d = 0;
    out.ageMinutes = d;
    // 与渲染层 freshness() 同口径的相对时长（托盘是快照文案，不带"数据…更新"前缀）
    out.ageText = d < 1 ? '刚刚'
      : d < 60 ? d + ' 分钟前'
      : d < 1440 ? Math.floor(d / 60) + ' 小时前'
      : d < 43200 ? Math.floor(d / 1440) + ' 天前'
      : Math.floor(d / 43200) + ' 个月前';
  }
  const ps = Array.isArray(cache.projects) ? cache.projects : [];
  out.projectCount = ps.length;
  // v1.7.18：剔除「磁盘上已不存在」的项目 —— 目录都没了还标未提交 = 陈述不成立的事实
  //（与渲染层 PROJ_DEAD 同源同判定，见 trayDeadDirtySet 注释）
  const deadDirty = trayDeadDirtySet(ps, s);
  for (const p of ps) {
    // 口径与渲染层（数字条「个仓库未提交」）严格一致：必须是 git 仓库、有未提交改动、且目录仍存在
    if (p && deadDirty.has(p.path)) continue;
    const n = (p && p.isGit) ? (Number(p.dirty) || 0) : 0;
    if (n > 0) { out.dirtyProjects++; out.dirtyFiles += n; }
  }
  return out;
}

/* 菜单模板（纯函数）：QA 钩子据此序列化取证，refreshTrayMenu 据此构建原生菜单 */
function trayMenuTemplate(st) {
  const status = st || trayStatus();
  const login = app.getLoginItemSettings().openAtLogin;
  const hours = Number(store.getSettings().autoScanHours);
  return [
    { label: '显示工作台', click: showMainWindow },
    { type: 'separator' },
    { label: '上次扫描：' + (status.hasCache ? status.ageText + '（' + status.clock + '）' : '暂无数据'), enabled: false },
    { label: '未提交：' + status.dirtyProjects + ' 个仓库 / ' + status.dirtyFiles + ' 个文件', enabled: false },
    { label: '立即扫描', click: () => { showMainWindow(); startScanRun({ extraRoots: store.getSettings().extraRoots }); } },
    { label: '自动扫描：' + (hours > 0 ? '每 ' + hours + ' 小时' : '关'), enabled: false },
    { type: 'separator' },
    { label: (login ? '✓ ' : '') + '开机自启', click: () => {
        const next = !app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: next });
        log('login-item toggled -> ' + next);
        refreshTrayMenu('开机自启切换');
      } },
    { type: 'separator' },
    { label: '退出', click: () => { forceQuit = true; app.quit(); } }
  ];
}

function trayMenuLabels(tpl) {
  return (tpl || []).map(x => (x && typeof x.label === 'string') ? x.label : '----');
}

/* 重建托盘菜单：构建 + 挂载 + 更新 tooltip + 写日志（label 无变化则跳过，避免无谓的原生菜单重建） */
function refreshTrayMenu(reason, opts) {
  if (!tray) return null;
  const status = trayStatus();
  const tpl = trayMenuTemplate(status);
  const labels = trayMenuLabels(tpl);
  if (!(opts && opts.force) && labels.join('\u0001') === lastTrayLabels.join('\u0001')) return null;
  const menu = Menu.buildFromTemplate(tpl);
  tray.setContextMenu(menu);
  lastTrayMenu = menu;
  tray.setToolTip('工作台 v' + app.getVersion() + ' · 上次扫描 ' + status.ageText +
    ' · 未提交 ' + status.dirtyProjects + ' 仓库 / ' + status.dirtyFiles + ' 文件');
  lastTrayLabels = labels;
  trayMenuHistory.push(menu);
  while (trayMenuHistory.length > TRAY_MENU_HOLD) trayMenuHistory.shift();
  log('tray menu rebuilt (' + reason + '): ' + JSON.stringify(labels));
  return menu;
}

/* QA 钩子（--trayqa=popup[,<json文件>]）：托盘菜单是原生 OS 菜单，CDP 截不到、也点不开 ——
   ① 把 label 列表 + 缓存快照序列化成 JSON（可与 scan-cache.json 逐项核对）；
   ② popup 模式弹出真实原生菜单，供 Win32 枚举 #32768 窗口做精确裁剪截图。
   popup 变体：'popup' = 走真实用户路径 tray.popUpContextMenu()；'popupmenu' = Menu.popup() 兜底。 */
let lastTrayMenu = null;
function runTrayQa() {
  if (!trayQaSpec) return;
  const parts = String(trayQaSpec).split(',').map(s => s.trim()).filter(Boolean);
  const wantPopup = parts.indexOf('popup') >= 0;
  const wantPopupMenu = parts.indexOf('popupmenu') >= 0;
  const outFile = parts.filter(p => p !== 'popup' && p !== 'popupmenu')[0] || '';
  const status = trayStatus();
  const labels = trayMenuLabels(trayMenuTemplate(status));
  // 直接读**挂到托盘上的那个 Menu 实例**的 items（不是模板的复刻）——
  // 这才是用户真正看到的菜单结构（label / type / enabled）。
  let liveItems = null;
  try {
    if (lastTrayMenu && Array.isArray(lastTrayMenu.items)) {
      liveItems = lastTrayMenu.items.map(it => ({
        label: it.label == null ? null : String(it.label),
        type: it.type || 'normal',
        enabled: it.enabled !== false,
        visible: it.visible !== false
      }));
    }
  } catch (e) { liveItems = null; }
  // liveItems 是「真正挂在托盘上的那个 Menu 实例」的 items（不是模板复刻）——
  // 逐项与模板 label 对齐，分隔符在实例里 label 为空、类型为 separator。
  let liveMatch = null;
  if (liveItems) {
    liveMatch = liveItems.length === labels.length;
    for (let i = 0; liveMatch && i < labels.length; i++) {
      const it = liveItems[i];
      const expectSep = labels[i] === '----';
      if (expectSep) { if (it.type !== 'separator') liveMatch = false; }
      else if (it.label !== labels[i]) liveMatch = false;
    }
  }
  const payload = {
    labels: labels,
    liveItems: liveItems,
    liveItemsMatchLabels: liveMatch,
    status: status,
    cacheSource: 'store.getScan()（与菜单同一份缓存，结构上必然一致）',
    at: new Date().toISOString()
  };
  if (outFile) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
      fs.writeFileSync(path.resolve(outFile), JSON.stringify(payload, null, 2), 'utf8');
      log('trayQA -> ' + path.resolve(outFile) + ' (' + labels.length + ' labels)');
    } catch (e) { log('trayQA ERROR ' + ((e && e.stack) || e)); }
  }
  if (wantPopup || wantPopupMenu) {
    setTimeout(() => {
      try {
        // 原生菜单需要窗口在前台才会真正弹出并被截图工具抓到（否则弹出即被别的应用抢焦点关闭）
        if (win && !win.isDestroyed()) {
          try { win.show(); win.setAlwaysOnTop(true, 'screen-saver'); win.focus(); } catch (_e) { /* ignore */ }
        }
        try { if (typeof app.focus === 'function') app.focus({ steal: true }); } catch (_e) { /* ignore */ }
      } catch (_e) { /* ignore */ }
      setTimeout(() => {
        try {
          if (wantPopupMenu) {
            const m = lastTrayMenu || Menu.buildFromTemplate(trayMenuTemplate(trayStatus()));
            m.popup({ window: win || undefined, x: 200, y: 200 });
            log('trayQA popup shown (Menu.popup)');
          } else {
            tray.popUpContextMenu();
            log('trayQA popup shown (tray.popUpContextMenu)');
          }
        } catch (e) { log('trayQA popup ERROR ' + ((e && e.stack) || e)); }
      }, 900);
    }, 1200);
  }
}

function createWindow() {
  // v1.7.8：窗口底色随已持久化的主题取深/浅，避免浅色主题启动瞬间的黑闪
  const bgColor = store.getSettings().theme === 'light' ? '#eef3f9' : '#0a0e14';
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    backgroundColor: bgColor,
    title: '工作台 · ' + os.hostname(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.removeMenu();
  const sendWinState = () => send('win:state', win.isMaximized() ? 'max' : 'normal');
  win.on('maximize', () => { sendWinState(); scheduleSaveWinState(); });
  win.on('unmaximize', () => { sendWinState(); scheduleSaveWinState(); });
  win.on('move', scheduleSaveWinState);
  win.on('resize', scheduleSaveWinState);
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    log('[renderer] ' + message + '  (' + path.basename(String(sourceId)) + ':' + line + ')');
    console.log('[renderer] ' + message);
  });
  const q = {};
  if (process.argv.includes('--pal')) q.pal = '1';
  const viewArg = process.argv.find(a => a.startsWith('--view='));
  if (viewArg) q.view = viewArg.split('=')[1];
  const detailArg = process.argv.find(a => a.startsWith('--detail='));
  if (detailArg) q.detail = detailArg.split('=')[1];
  const briefArg = process.argv.find(a => a.startsWith('--brief='));
  if (briefArg) q.brief = briefArg.split('=')[1];
  const favQaArg = process.argv.find(a => a.startsWith('--favqa='));
  if (favQaArg) q.favqa = favQaArg.slice('--favqa='.length);
  const saveQaArg = process.argv.find(a => a.startsWith('--saveqa='));
  if (saveQaArg) q.saveqa = saveQaArg.slice('--saveqa='.length);
  const scanErrQaArg = process.argv.find(a => a.startsWith('--scanerrqa='));
  if (scanErrQaArg) q.scanerrqa = scanErrQaArg.slice('--scanerrqa='.length);
  const dirsQaArg = process.argv.find(a => a.startsWith('--dirsqa='));
  if (dirsQaArg) q.dirsqa = dirsQaArg.slice('--dirsqa='.length);
  const freshQaArg = process.argv.find(a => a.startsWith('--freshqa='));
  if (freshQaArg) q.freshqa = freshQaArg.slice('--freshqa='.length);
  const ringQaArg = process.argv.find(a => a.startsWith('--ringqa='));
  if (ringQaArg) q.ringqa = ringQaArg.slice('--ringqa='.length);
  const briefQaArg = process.argv.find(a => a.startsWith('--briefqa='));
  if (briefQaArg) q.briefqa = briefQaArg.slice('--briefqa='.length);
  const themeQaArg = process.argv.find(a => a.startsWith('--themeqa='));
  if (themeQaArg) q.themeqa = themeQaArg.slice('--themeqa='.length);
  const searchQaArg = process.argv.find(a => a.startsWith('--searchqa='));
  if (searchQaArg) q.searchqa = searchQaArg.slice('--searchqa='.length);
  const histQaArg = process.argv.find(a => a.startsWith('--histqa='));
  if (histQaArg) q.histqa = histQaArg.slice('--histqa='.length);
  const dayQaArg = process.argv.find(a => a.startsWith('--dayqa='));
  if (dayQaArg) q.dayqa = dayQaArg.slice('--dayqa='.length);
  const timeQaArg = process.argv.find(a => a.startsWith('--timeqa='));
  if (timeQaArg) q.timeqa = timeQaArg.slice('--timeqa='.length);
  const palQaArg = process.argv.find(a => a.startsWith('--palqa='));
  if (palQaArg) q.palqa = palQaArg.slice('--palqa='.length);
  const histDiffQaArg = process.argv.find(a => a.startsWith('--histdiffqa='));
  if (histDiffQaArg) q.histdiffqa = histDiffQaArg.slice('--histdiffqa='.length);
  const deadBriefQaArg = process.argv.find(a => a.startsWith('--deadbriefqa='));
  if (deadBriefQaArg) q.deadbriefqa = deadBriefQaArg.slice('--deadbriefqa='.length);
  const actRootQaArg = process.argv.find(a => a.startsWith('--actrootqa='));
  if (actRootQaArg) q.actrootqa = actRootQaArg.slice('--actrootqa='.length);
  const briefSyncQaArg = process.argv.find(a => a.startsWith('--briefsync='));
  if (briefSyncQaArg) q.briefsync = briefSyncQaArg.slice('--briefsync='.length);
  const histLegacyQaArg = process.argv.find(a => a.startsWith('--histlegacyqa='));
  if (histLegacyQaArg) q.histlegacyqa = histLegacyQaArg.slice('--histlegacyqa='.length);
  const weekQaArg = process.argv.find(a => a.startsWith('--weekqa='));
  if (weekQaArg) q.weekqa = weekQaArg.slice('--weekqa='.length);
  const compareQaArg = process.argv.find(a => a.startsWith('--compareqa='));
  if (compareQaArg) q.compareqa = compareQaArg.slice('--compareqa='.length);
  const favDeadQaArg = process.argv.find(a => a.startsWith('--favdeadqa='));
  if (favDeadQaArg) q.favdeadqa = favDeadQaArg.slice('--favdeadqa='.length);
  const qaShotArg = process.argv.find(a => a.startsWith('--qashot='));
  if (qaShotArg) qaShotDir = qaShotArg.slice('--qashot='.length); // 目录由主进程直接消费，不透传渲染层
  const trayQaArg = process.argv.find(a => a.startsWith('--trayqa='));
  if (trayQaArg) trayQaSpec = trayQaArg.slice('--trayqa='.length); // 目录/文件由主进程直接消费，不透传渲染层
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), Object.keys(q).length ? { query: q } : undefined);
  log('window created, query=' + JSON.stringify(q));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  // 恢复上次窗口状态：边界可信（≥500×400）才恢复，最大化状态最后套用
  const st = store.getSettings();
  const b = st.winBounds;
  if (b && typeof b.width === 'number' && typeof b.height === 'number' && b.width >= 500 && b.height >= 400) {
    win.setBounds(b);
  }
  if (st.winMaximized) win.maximize();
  win.on('close', (e) => {
    if (winStateTimer) { clearTimeout(winStateTimer); winStateTimer = null; }
    saveWinState();
    if (store.getSettings().trayMinimize && !forceQuit) {
      e.preventDefault(); // 隐藏到托盘，进程常驻
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  if (qaShotDir) setTimeout(() => { runQaShot(qaShotDir).catch(e => log('qaShot ERROR ' + ((e && e.stack) || e))); }, 2500);
}

/* QA 钩子（--qashot=<目录>）：主进程内逐视图切视图 + capturePage 落盘。
   为什么不用 CDP Page.captureScreenshot：本机桌面有其他应用抢焦点，渲染进程被判定为不可见时
   该命令会无限挂起（实测 30s timeout）；capturePage 走主进程合成器，不受桌面焦点/遮挡影响。 */
async function runQaShot(dir) {
  const views = ['overview', 'projects', 'recent', 'disk', 'system', 'settings'];
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) { /* ignore */ }
  const rep = { views: [], theme: '', at: new Date().toISOString() };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(2500);
  // 窗口可能被最小化/隐藏/被其他窗口完全遮挡 → 还原 + 置顶，否则 capturePage 返回空图（0 字节）
  try {
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
    win.setSkipTaskbar(false);
    log('qaShot winState visible=' + win.isVisible() + ' minimized=' + win.isMinimized() + ' bounds=' + JSON.stringify(win.getBounds()));
  } catch (e) { log('qaShot winState ERROR ' + ((e && e.stack) || e)); }
  await sleep(1500);
  rep.theme = await win.webContents.executeJavaScript(`document.documentElement.getAttribute('data-theme')`);
  for (const v of views) {
    await win.webContents.executeJavaScript(`(function(){ if (typeof setView === 'function') setView('${v}', true); })()`);
    await sleep(1400);
    const img = await win.webContents.capturePage();
    const file = path.join(dir, 'pm-r62-view-' + v + '.png');
    const buf = img.toPNG();
    fs.writeFileSync(file, buf);
    const audit = await win.webContents.executeJavaScript(`(function(){
      if (typeof auditContrast !== 'function') return { err: 'auditContrast 未定义' };
      var r = auditContrast();
      return { total: r.total, min: Number(r.min.toFixed(2)), failCount: r.fail.length,
               fails: r.fail.slice(0,6).map(f => f.sel + ' ' + f.ratio.toFixed(2) + ':1(需' + f.need + ') fg=' + f.fg + ' bg=' + f.bg),
               bodyColor: r.bodyColor, bodyBg: r.bodyBg };
    })()`);
    rep.views.push({ view: v, file: file, bytes: buf.length, audit: audit });
    log('qaShot ' + v + ' -> ' + file + ' (' + buf.length + ' B) audit=' + JSON.stringify(audit));
  }
  fs.writeFileSync(path.join(dir, 'pm-r62-audit.json'), JSON.stringify(rep, null, 2));
  try { win.setAlwaysOnTop(false); } catch (_e) { /* ignore */ }
  log('qaShot DONE');
}

if (app.requestSingleInstanceLock()) {
  app.whenReady().then(() => {
    log('app ready');
    createWindow();
    createTray();
    setupAutoScan('启动');
    app.on('second-instance', showMainWindow);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
} else {
  app.quit();
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { forceQuit = true; });
app.on('will-quit', () => {
  if (trayMenuTimer) { clearInterval(trayMenuTimer); trayMenuTimer = null; }
  if (tray) { try { tray.destroy(); } catch (_e) { /* ignore */ } tray = null; }
});

/* ---------- 机器脉搏（1s 采样 CPU/内存，窗口最小化时暂停推送） ---------- */

let pulseTimer = null;
let pulsePrev = null;
function samplePulse() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const k in c.times) { total += c.times[k]; if (k === 'idle') idle += c.times[k]; }
  }
  let cpu = 0;
  if (pulsePrev) {
    const di = idle - pulsePrev.idle, dt = total - pulsePrev.total;
    if (dt > 0) cpu = Math.min(100, Math.max(0, Math.round((1 - di / dt) * 100)));
  }
  pulsePrev = { idle, total };
  const mem = Math.min(100, Math.max(0, Math.round((1 - os.freemem() / os.totalmem()) * 100)));
  if (win && !win.isDestroyed() && !win.isMinimized()) send('pulse', { cpu, mem, t: Date.now() });
}
ipcMain.on('pulse:start', () => {
  if (pulseTimer) return;
  samplePulse();
  pulseTimer = setInterval(samplePulse, 1000);
  log('pulse started');
});
ipcMain.on('pulse:stop', () => {
  if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; pulsePrev = null; log('pulse stopped'); }
});

/* ---------- 窗口控制（无边框标题栏） ---------- */

ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('win:close', () => { if (win) win.close(); });

/* ---------- IPC ---------- */

ipcMain.handle('state:get', async () => {
  log('state:get invoked');
  return ({
    cache: store.getScan(),
    settings: store.getSettings(),
    caps: await scanner.capabilities(),
    history: store.getHistory(),
    scanErrors: store.getScanErrors(),
    autoCheck: lastAutoCheck,          // v1.7.10：最近一次自动扫描到期检查（渲染层兜底取回，避免启动即检事件早于订阅丢失）
    loginItem: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion()
  });
});

/* 扫描/分析失败原因持久化：写入 scan-errors.json，并把最新全量列表推给渲染层即时刷新 */
function pushScanError(kind, msg) {
  let arr = [];
  try { arr = store.appendScanError(kind, msg); }
  catch (e) { log('appendScanError ERROR ' + ((e && e.stack) || e)); }
  send('scan-errors:changed', arr);
}

/* 扫描执行主体：手动 scan:start 与自动扫描共用（scanning 互斥、进度日志、落盘、收尾推送） */
function startScanRun(opts) {
  if (scanning) return { started: false, reason: '扫描已在进行中' };
  scanning = true;
  const s = store.getSettings();
  const merged = {
    skipSizes: !!(opts && opts.skipSizes),
    extraRoots: (opts && opts.extraRoots) || s.extraRoots || [],
    scanRoots: s.scanRoots || [],   // 要扫描的根目录（本机值在 settings.json，源码通用）
    forceDirs: s.forceDirs || [],   // 强制纳入的目录
    links: s.links || []            // 快捷入口（用户目录之外的）
  };
  scanner.runScan(merged, p => {
    if (p.phase === 'projects') log('scan ' + p.current + '/' + p.total + ' ' + p.name);
    send('scan:progress', p);
  })
    .then(data => {
      // v1.7.31：区分「扫描失败」与「持久化失败」—— 此前 setScan 无 try/catch，
      //   写盘失败（缓存只读/文件被锁/磁盘满）会落入 .catch 被误报为「扫描失败」，
      //   而实际数据已成功扫描、只是没存下 ⇒ 陈述与事实不符（同款第 7 例）。
      //   现在：扫描成功 = runScan 返回 data；持久化单独处理，不再与扫描失败混淆。
      scanning = false;
      let persisted = false;
      try {
        store.setScan(data);
        persisted = true;
      } catch (e) {
        const msg = String((e && e.stack) || e);
        log('persist scan-cache ERROR ' + msg);
        pushScanError('持久化', '主数据保存失败（扫描已完成）：' + msg);
        send('scan:persist-error', '扫描已完成，但数据保存失败（请检查缓存目录写权限/磁盘空间）');
      }
      if (persisted) {
        // 历史摘要非主数据：写入失败记入诊断，但不阻断主数据的 scan:done
        try { store.appendHistory(data); }
        catch (e) { pushScanError('持久化', '历史摘要保存失败：' + String((e && e.message) || e)); }
        log('scan DONE ' + data.projects.length + ' projects, ' + data.meta.durationSec + 's');
        send('scan:done', { scanTime: data.meta.scanTime, durationSec: data.meta.durationSec });
        // v1.7.11：数据变了 → 托盘菜单必须立刻重建（「上次扫描」「未提交」不能停留在旧值）
        refreshTrayMenu('扫描完成');
        if (tray) {
          try { tray.displayBalloon({ title: '工作台', content: '扫描完成：简报与项目数据已更新', iconType: 'info' }); } catch (_e) { /* 仅 Windows 生效，其余忽略 */ }
        }
      }
    })
    .catch(err => {
      scanning = false;
      const msg = String((err && err.stack) || err);
      log('scan ERROR ' + msg);
      console.error('[scan:error] ' + msg);
      pushScanError('扫描', msg);
      send('scan:error', msg);
    });
  return { started: true };
}

ipcMain.handle('scan:start', (_e, opts) => {
  log('scan:start invoked, scanning=' + scanning);
  return startScanRun(opts);
});

/* ---------- 自动扫描（settings.autoScanHours>0 启用，每 15 分钟检查一次缓存新鲜度） ----------
   v1.7.10「启动即检」：以前只有 15 分钟粒度的定时器，冷启动后最长 15 分钟内看板仍显示过期数据
   （实测缓存 age 可达 20 小时，而自动扫描明明开着）—— 即「一天第一次打开」这个最典型的场景里
   自动扫描不生效。现在启动后延迟 3 秒先做一次到期检查（3s 让渲染层先把缓存渲染出来并挂好
   scan:progress 订阅，避免扫描进度早于订阅到达而丢失），与定时器共用同一判定函数，
   保证「启动即检」与「定时检查」语义完全一致。 */

let autoScanTimer = null;
let autoScanStartTimer = null;
let lastAutoCheck = null;          // 最近一次到期检查的判定结果（供 state:get 兜底取回）
const AUTO_SCAN_START_DELAY = 3000;

/* 判定缓存是否到期：与扫描间隔同语义（含 1 分钟余量），返回可记录、可展示的判定明细 */
function autoScanDueState(hours) {
  const cache = store.getScan();
  if (cache && cache.meta && cache.meta.scanTime) {
    // meta.scanTime 为 'YYYY-MM-DD HH:mm:ss'，补 'T' 后按本地时区解析
    const last = new Date(String(cache.meta.scanTime).replace(' ', 'T')).getTime();
    if (Number.isFinite(last)) {
      const ageMs = Date.now() - last;
      if (ageMs < hours * 3600000 - 60000) return { due: false, ageMs: ageMs, why: '数据仍新鲜' };
      return { due: true, ageMs: ageMs, why: '数据已过期' };
    }
  }
  return { due: true, ageMs: null, why: '无扫描缓存' };
}

/* 统一入口：定时检查与启动即检都走这里（reason 仅用于日志与 UI 区分，不影响判定） */
function runAutoScanCheck(reason) {
  const hours = Number(store.getSettings().autoScanHours);
  if (!(hours > 0)) { log('autoScan check skipped (' + reason + '): 自动扫描已关闭'); return; }
  if (scanning) { log('autoScan check skipped (' + reason + '): 扫描已在进行中'); return; }
  const st = autoScanDueState(hours);
  const ageTxt = st.ageMs == null ? '无缓存' : (Math.round(st.ageMs / 60000) + ' 分钟前');
  log('autoScan check (' + reason + '): ' + st.why + ' · 数据年龄=' + ageTxt + ' · 间隔=' + hours + 'h · due=' + st.due);
  lastAutoCheck = { reason: reason, due: st.due, ageMs: st.ageMs, intervalHours: hours, why: st.why, at: Date.now() };
  // 把判定结果推给渲染层（设置页常驻可见）：让用户知道「自动扫描到底有没有在管事」
  send('scan:auto', lastAutoCheck);
  if (!st.due) return;
  log('autoScan triggered (' + reason + ', 间隔 ' + hours + 'h)');
  startScanRun({ extraRoots: store.getSettings().extraRoots });
}

function setupAutoScan(reason) {
  if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; } // 先清旧定时器，settings:set 后重建
  if (autoScanStartTimer) { clearTimeout(autoScanStartTimer); autoScanStartTimer = null; }
  const hours = Number(store.getSettings().autoScanHours);
  if (!(hours > 0)) { log('autoScan off (autoScanHours=' + store.getSettings().autoScanHours + ')'); return; }
  log('autoScan on: 每 ' + hours + ' 小时（15 分钟粒度检查 + 启动即检）');
  autoScanTimer = setInterval(() => { runAutoScanCheck('定时'); }, 15 * 60 * 1000);
  // 启动即检：延迟 3s —— 让渲染层先渲染出缓存内容并挂好事件订阅，避免扫描进度先于订阅到达而丢失
  autoScanStartTimer = setTimeout(() => { autoScanStartTimer = null; runAutoScanCheck(reason || '启动'); }, AUTO_SCAN_START_DELAY);
}

ipcMain.handle('disk:analyze', (_e, root, force) => {
  if (!root || typeof root !== 'string') return { started: false, reason: '路径无效' };
  const cache = dirsCacheData();
  const hit = cache[root];
  if (!force && hit && (Date.now() - hit.savedAt) < DIRS_TTL) {
    const res = { root, totalSize: hit.totalSize, items: hit.items, cached: true, cachedAt: hit.savedAt };
    // v1.7.27：缓存命中分支**绝不能**清 `analyzing` —— 它属于当前正在进行的另一次分析。
    // 旧代码在这里写 `analyzing = false`，导致「分析 A 进行中 → 命中缓存 B → 再启动分析 C」
    // 时互斥锁被 B 清掉、C 与 A 并发跑同一份 dirsCache（EBUSY/结果互相覆盖）。
    // 互斥锁只能由**真正启动的分析**在 .then/.catch 的终态里清除。
    send('analyze:done', res);
    return { started: true, cached: true };
  }
  if (analyzing) return { started: false, reason: '分析已在进行中' };
  analyzing = true;
  scanner.analyze(root, p => send('analyze:progress', p))
    .then(res => {
      analyzing = false;
      cache[root] = { savedAt: Date.now(), totalSize: res.totalSize, items: res.items };
      saveDirsCache();
      send('analyze:done', res);
    })
    .catch(err => {
      analyzing = false;
      const msg = String((err && err.message) || err);
      pushScanError('空间分析', msg);
      send('analyze:error', msg);
    });
  return { started: true };
});

/* ---------- 失效路径保护（v1.7.13） ----------
   实测基线（Electron 33.4.11，独立探针进程实测，详见 DECISIONS.md 第二十三轮）：
     · shell.openPath(<不存在的路径>) → 返回的 Promise **永不落地**（5/5 用例 25s 超时未 settle），
       且 Windows 会弹出**模态原生错误对话框**（窗口标题 = 那个缺失路径）——
       渲染层 await 永远挂着 ⇒ 用户「点了没反应」+ 莫名弹窗挡住工作台窗口；
     · 但主进程事件循环**没有被挂起**（25s 内心跳 230~231 次、最长间隔 0~7ms）⇒ 不是主进程冻结，
       而是「IPC Promise 悬空」；
     · shell.showItemInFolder(<不存在的路径>) → 同步返回、什么都不做（不弹窗、不报错）⇒ 100% 静默失败。
   根因同构：扫描缓存里存着已被删除的路径，而打开前从不判存在性。
   修法：**先判存在性，不存在直接返回错误信息、根本不调 shell**（⇒ 既不悬空也不弹原生对话框），
   再给仍然调用的 openPath 加 Promise.race 超时兜底（路径存在但系统打不开时的防御）。 */
function pathExists(p) {
  try { return typeof p === 'string' && !!p && fs.existsSync(p); } catch (_e) { return false; }
}
const OPEN_PATH_TIMEOUT = 15000;   // 存在但打不开（网络盘掉线/文件被独占/默认程序卡死）时的兜底上限

ipcMain.handle('path:open', async (_e, p) => {
  if (typeof p !== 'string' || !p) return '路径无效';
  if (!pathExists(p)) {
    log('path:open skipped (missing): ' + p);
    return '路径已不存在（可能已被删除或移动）';
  }
  let timer = null;
  try {
    const r = await Promise.race([
      shell.openPath(p),
      new Promise(res => { timer = setTimeout(() => res('__TIMEOUT__'), OPEN_PATH_TIMEOUT); })
    ]);
    if (r === '__TIMEOUT__') { log('path:open TIMEOUT ' + p); return '打开超时（系统无响应）'; }
    return r || '';   // 成功 = 空串（沿用 Electron 既有语义）；失败 = 错误串
  } catch (e) {
    log('path:open ERROR ' + ((e && e.stack) || e));
    return '打开失败';
  } finally {
    if (timer) clearTimeout(timer);
  }
});
ipcMain.handle('path:show', (_e, p) => {
  if (typeof p !== 'string' || !p) return { ok: false, reason: '路径无效' };
  if (!pathExists(p)) {
    log('path:show skipped (missing): ' + p);
    return { ok: false, reason: '路径已不存在，无法打开所在目录' };
  }
  try {
    shell.showItemInFolder(p);
    return { ok: true };
  } catch (e) {
    log('path:show ERROR ' + ((e && e.stack) || e));
    return { ok: false, reason: '无法打开所在目录' };
  }
});
/* 批量存在性检查（新增通道，只增不改名）：渲染层给一串路径，主进程一次循环判定并回传映射。
   用途：给「最近动态」里已失效的条目打「已删除」标记（避免 60 次 IPC 风暴）。
   上限 500 条 —— 单次往返足够覆盖最近列表（60 条）+ 总览 Top9 + 命令面板索引。 */
ipcMain.handle('path:exists', (_e, paths) => {
  const list = Array.isArray(paths) ? paths : [];
  const out = {};
  for (const p of list.slice(0, 500)) {
    if (typeof p === 'string' && p) out[p] = pathExists(p);
  }
  return out;
});
ipcMain.handle('open:in', async (_e, p, mode) => await scanner.openIn(p, mode));
ipcMain.handle('git:detail', async (_e, p) => await scanner.gitDetail(p));
// settings:set 返回合并后的完整 settings 对象（历史 bug：曾返回布尔 true，
// renderer 严格模式下把 true 赋给 SETTINGS 再写属性会抛 TypeError 且丢失成功 toast）。
ipcMain.handle('settings:set', (_e, s) => { const next = store.setSettings(s); setupAutoScan('设置变更'); refreshTrayMenu('设置变更'); return next; });
// 清空持久化的扫描/分析错误诊断（设置页「清空错误日志」按钮）
ipcMain.handle('scan-errors:clear', () => store.clearScanErrors());

/* ---------- 简报导出（v1.7.7） ----------
   复制与导出共用渲染层生成的同一份 Markdown 文本，两条通道内容必然一致。
   剪贴板走主进程 Electron clipboard：与窗口焦点无关（渲染层 navigator.clipboard 需文档焦点，
   本机桌面常被其他应用抢焦点 → 自动化/托盘态下会失败），并可立即 readText() 回读自证。 */
ipcMain.handle('brief:copy', (_e, text) => {
  const s = String(text == null ? '' : text);
  if (!s) return { ok: false, reason: '内容为空' };
  try {
    clipboard.writeText(s);
    const back = clipboard.readText();          // 回读自证：写入是否真的落到系统剪贴板
    log('brief copied, chars=' + s.length + ', readback=' + back.length);
    return { ok: true, chars: s.length, readback: back.length, head: back.slice(0, 60) };
  } catch (e) {
    log('brief:copy ERROR ' + ((e && e.stack) || e));
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

/* 导出 Markdown：落到 Documents\工作台\（不存在则回落应用数据目录），文件名带时间戳不覆盖历史 */
ipcMain.handle('brief:export', (_e, md, prefix) => {
  const safePrefix = (typeof prefix === 'string' && /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,12}$/.test(prefix)) ? prefix : '简报';
  const s = String(md == null ? '' : md);
  if (!s) return { ok: false, reason: '内容为空' };
  try {
    let dir = '';
    try {
      const docs = app.getPath('documents');
      if (docs && fs.existsSync(docs)) dir = path.join(docs, '工作台');
    } catch (_e) { dir = ''; }
    if (!dir) dir = path.join(store.dataDir(), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
    const file = path.join(dir, safePrefix + '-' + stamp + '.md');
    fs.writeFileSync(file, s, 'utf8');
    const bytes = fs.statSync(file).size;
    log('brief exported -> ' + file + ' (' + bytes + ' bytes)');
    return { ok: true, path: file, bytes, chars: s.length };
  } catch (e) {
    log('brief:export ERROR ' + ((e && e.stack) || e));
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

/* ---------- 项目详情（git 深信息 + README 摘要 / 目录体量分析） ---------- */

const README_CANDIDATES = ['README.md', 'readme.md', 'Readme.md', 'README.TXT', 'readme.txt'];

ipcMain.handle('project:detail', async (_e, p) => {
  try {
    if (typeof p !== 'string' || !p) throw new Error('路径无效');
    const readme = { exists: false };
    for (const name of README_CANDIDATES) {
      const full = path.join(p, name);
      if (!fs.existsSync(full)) continue;
      readme.exists = true;
      readme.name = name;
      readme.text = fs.readFileSync(full, 'utf8').slice(0, 8000);
      break;
    }
    return { git: await scanner.gitDetail(p), readme };
  } catch (e) {
    return { error: String(e) };
  }
});

/* ---------- 目录构成（结果缓存 6 小时，可强制重算） ---------- */

const DIRS_TTL = 6 * 3600e3;
let dirsBusy = false;
let dirsCache = null;
function dirsCacheData() {
  if (dirsCache) return dirsCache;
  try { dirsCache = JSON.parse(fs.readFileSync(path.join(store.dataDir(), 'dirs-cache.json'), 'utf8')); }
  catch (_e) { dirsCache = {}; }
  return dirsCache;
}
function saveDirsCache() {
  try { fs.writeFileSync(path.join(store.dataDir(), 'dirs-cache.json'), JSON.stringify(dirsCache)); } catch (_e) { /* ignore */ }
}
ipcMain.handle('project:dirs', async (_e, p, force) => {
  if (typeof p !== 'string' || !p) throw new Error('路径无效');
  const cache = dirsCacheData();
  const hit = cache[p];
  if (!force && hit && (Date.now() - hit.savedAt) < DIRS_TTL) {
    return { root: p, totalSize: hit.totalSize, items: hit.items, cached: true, cachedAt: hit.savedAt };
  }
  if (dirsBusy) throw new Error('目录分析已在进行中');
  dirsBusy = true;
  try {
    const res = await scanner.analyze(p, () => {});
    cache[p] = { savedAt: Date.now(), totalSize: res.totalSize, items: res.items };
    saveDirsCache();
    return { root: res.root, totalSize: res.totalSize, items: res.items, cached: false };
  } finally {
    dirsBusy = false;
  }
});

/* ---------- 开机自启 ---------- */

ipcMain.handle('login-item:set', (_e, open) => {
  app.setLoginItemSettings({ openAtLogin: !!open });
  refreshTrayMenu('开机自启切换');
  return app.getLoginItemSettings().openAtLogin;
});
