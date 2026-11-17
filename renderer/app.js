'use strict';
/* 工作台 v1.6 渲染进程 —— 全部通过 preload 暴露的 window.wb 与主进程通信 */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let DATA = null, SETTINGS = { skipSizes: false, extraRoots: [] }, CAPS = { vscode: false, wt: false }, HISTORY = [], LOGINITEM = false, VERSION = '';
let view = localStorage.getItem('wb.view') || 'overview';
let filterType = '全部', q = '', sortBy = 'mtime';
let rq = '';     // v1.7.12：最近视图搜索词（与项目视图的 q 分开保存，互不干扰）
let lastAnalysis = null;
let QA_DETAIL = '';   // QA 钩子：URL ?detail=项目名，renderProjects 末尾消费
let detailSeq = 0;    // 项目详情弹窗序号：接口慢返回时不覆盖已关闭/已切换的弹窗
let currentDetail = null; // 当前详情弹窗 { root, stack, loadDirs }，供目录构成下钻 / 返回 / 重算使用
let FAVS = [];        // 收藏项目绝对路径数组（settings.favorites 镜像；置顶 / Ctrl+K / 数字条共用）
let SCAN_ERRORS = []; // 持久化的扫描/分析错误诊断（state:get 带回；设置页展示，重启后仍在）
let AUTO_CHECK = null; // v1.7.10：最近一次「自动扫描到期检查」判定（state:get.autoCheck 兜底 + scan:auto 事件实时更新）
/* v1.7.13 失效路径保护：扫描缓存里存着已被删除的路径（实测 60 条中 36 条已失效），
   打开它们会让 shell.openPath 的 Promise 永不落地（并弹出原生模态错误框），
   showItemInFolder 则 100% 静默失败 ⇒ 主进程侧已改为「先判存在性」。
   渲染层再把失效条目**显式标出来**（置灰 + 划线 + 「已删除」角标），用户不再对着空气点击。 */
let RECENT_DEAD = new Set();  // 已确认磁盘上不存在的路径（批量存在性检查的结果）
let recentCheckKey = '';      // 已检查过的路径集合（同一批路径不重复发 IPC）
let recentCheckToken = 0;     // 竞态令牌：只采纳最后一次检查的结果
/* v1.7.15 项目雷达失效标注：项目视图此前**完全没有**存在性标注 ——
   v1.7.13 只给「最近动态」加了「已删除」角标，导致磁盘上已不存在的项目
   （本机真实数据：D:\wt-demo / D:\wt-prev）仍完整显示在雷达里
   （头像/分支/提交/未提交/体量一应俱全），用户要点按钮才知道它没了。
   现在复用**既有** path:exists 批量通道（零新增 IPC）给项目行也加标注。 */
let PROJ_DEAD = new Set();     // 已确认磁盘上不存在的项目路径
let projCheckKey = '';         // 已检查过的项目路径集合（同一批不重复发 IPC）
let projCheckToken = 0;        // 竞态令牌：只采纳最后一次检查的结果
let winStateBootstrapped = false; // v1.7.28：标题栏最大化图标启动兜底一次性标记（仅首次 refreshState 消费 SETTINGS.winMaximized）

const PHASES = { drives: '磁盘', projects: '项目', activity: '活动统计', recent: '最近动态', folders: '常用文件夹', tools: '工具链' };
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EXT_COLOR = {
  pdf: '#f87171', doc: '#60a5fa', docx: '#60a5fa', xls: '#34d399', xlsx: '#34d399',
  ppt: '#fbbf24', pptx: '#fbbf24', png: '#c084fc', jpg: '#c084fc', jpeg: '#c084fc',
  gif: '#c084fc', webp: '#c084fc', svg: '#c084fc', mp4: '#f472b6', mov: '#f472b6',
  mp3: '#f472b6', zip: '#fbbf24', rar: '#fbbf24', '7z': '#fbbf24', exe: '#93a4bd',
  msi: '#93a4bd', apk: '#34d399', hprof: '#f87171', log: '#93a4bd', md: '#60a5fa',
  json: '#a3e635', csv: '#34d399', jsh: '#a3e635', txt: '#8fa1bd', caj: '#f87171'
};
/* v1.7.8 浅色主题：canvas 与 JS 内联颜色不吃 CSS 变量 → 这里提供浅色映射 + 同源读取 */
const EXT_COLOR_LIGHT = {
  pdf: '#c43b3b', doc: '#175bb8', docx: '#175bb8', xls: '#0b7a55', xlsx: '#0b7a55',
  ppt: '#8f5708', pptx: '#8f5708', png: '#7b34c9', jpg: '#7b34c9', jpeg: '#7b34c9',
  gif: '#7b34c9', webp: '#7b34c9', svg: '#7b34c9', mp4: '#b83280', mov: '#b83280',
  mp3: '#b83280', zip: '#8f5708', rar: '#8f5708', '7z': '#8f5708', exe: '#5b6b82',
  msi: '#5b6b82', apk: '#0b7a55', hprof: '#c43b3b', log: '#5b6b82', md: '#175bb8',
  json: '#4d7c0f', csv: '#0b7a55', jsh: '#4d7c0f', txt: '#5b6b82', caj: '#c43b3b'
};
/* 从 CSS 变量取色（canvas / 需要跟随主题的 JS 绘制） */
function cssVar(name, fallback) {
  let v = '';
  try { v = getComputedStyle(document.documentElement).getPropertyValue(name); } catch (_e) { v = ''; }
  v = String(v || '').trim();
  return v || (fallback || '');
}
function themeIsLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }

/* 搜索内核已按 nodebestpractices 1.3 抽为独立文件 renderer/search.js（v1.7.40）。
   两个文件同为普通 <script> 顺序加载，搜索函数在同一全局作用域直接可见，
   下方所有调用点与 QA 钩子（--searchqa）零改动。 */



/* ---------- 头像首字母墨色（v1.7.9 深色主题对比度修复） ----------
   头像底色按项目名哈希出色相（hsl(hue,52%,46%)），首字母恒为白色。
   但该色域里白字最低只有 2.25:1（黄相 60°）—— 属真实可读性缺陷（首字母是文字，不是装饰）。
   故逐色相实算：① 白墨达标 → 用白墨（保持原观感）；
                 ② 白墨不足但深墨达标 → 用深墨（保留色相辨识度）；
                 ③ 两者都不达标（如蓝相 205° 附近白墨 4.33 / 深墨 4.32 几乎持平）→ 逐级微降亮度，
                    让白墨过线（实测 72 个色相里 37 个需降亮，亮度落在 31%~46%）。
   纯函数，零外部依赖；与 WCAG 相对亮度公式一致。 */
function _hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function avatarInk(hue) {
  const INK = [11, 18, 32];        // 深墨 #0b1220（与 --on-grad 同源）
  const WHITE = [255, 255, 255];
  for (let L = 46; L >= 28; L--) {
    const bg = _hslToRgb(hue, 52, L);
    const w = _contrast(WHITE, bg);   // 白墨对比度
    const k = _contrast(INK, bg);     // 深墨对比度
    if (w >= 4.5 && w >= k) return { l: L, ink: '#ffffff' };
    if (k >= 4.5) return { l: L, ink: '#0b1220' };
  }
  return { l: 28, ink: '#ffffff' };
}
/* 头像 inline style（背景 + 墨色），供 4 处头像渲染复用 */
function avatarStyle(hue, extra) {
  const a = avatarInk(hue);
  return (extra ? extra + ';' : '') + 'background:hsl(' + hue + ',52%,' + a.l + '%);color:' + a.ink;
}


/* ---------- 通用工具 ---------- */

function base() {
  return (DATA && DATA.meta && DATA.meta.scanTime) ? new Date(DATA.meta.scanTime.replace(' ', 'T')) : new Date();
}
function relTime(s) {
  if (!s) return '—';
  const t = new Date(String(s).slice(0, 19).replace(' ', 'T'));
  if (isNaN(t)) return s;
  let d = Math.round((base() - t) / 60000);
  if (d < 0) d = 0;
  if (d < 1) return '刚刚';
  if (d < 60) return d + ' 分钟';
  if (d < 1440) return Math.floor(d / 60) + ' 小时';
  if (d < 43200) return Math.floor(d / 1440) + ' 天';
  return Math.floor(d / 43200) + ' 个月';
}
/* 数据新鲜度（v1.7.5）：以「当前时刻」为基准，返回完整「数据…更新」文案。
   relTime(scanTime) 的 base() 本身就是扫描时刻 → self 比较恒为 0 → 永远「刚刚」，
   故标题栏 / 侧栏 / 概览的「数据…更新」不能复用 relTime，必须走本函数（以 Date.now() 为基准）。
   顺带修掉「刚刚前更新」病句（<1 分钟时返回「数据 刚刚更新」）。
   提交 / 文件修改时间的 relTime 仍以扫描时刻为基准（快照语义，DECISIONS D8），不受影响。 */
function freshness(s) {
  if (!s) return '数据 —';
  const t = new Date(String(s).slice(0, 19).replace(' ', 'T'));
  if (isNaN(t)) return '数据 —';
  let d = Math.round((Date.now() - t) / 60000);
  if (d < 0) d = 0;
  if (d < 1) return '数据 刚刚更新';
  if (d < 60) return '数据 ' + d + ' 分钟前更新';
  if (d < 1440) return '数据 ' + Math.floor(d / 60) + ' 小时前更新';
  if (d < 43200) return '数据 ' + Math.floor(d / 1440) + ' 天前更新';
  return '数据 ' + Math.floor(d / 43200) + ' 个月前更新';
}
/* 格式化工具（fmtMB/fmtSizeKB/fmtBytes/hueOf/shortPath/greet）已按 nodebestpractices 1.3
   抽为平铺文件 renderer/format.js（v1.7.41），同为普通 <script> 加载、全局直接可见。 */

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'ok');
  el.textContent = msg;
  $('#toast-wrap').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2200);
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('已复制', 'ok'); }
  catch (_e) {
    const ta = document.createElement('textarea');
    ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制', 'ok'); } catch (_e2) { toast('复制失败', 'err'); }
    ta.remove();
  }
}
function tbStatus(s) { $('#tb-status').textContent = s; }
function idleStatus() {
  if (DATA && DATA.meta) tbStatus(freshness(DATA.meta.scanTime) + (DATA.meta.fast ? ' · 快速模式' : ''));
  else tbStatus('');
}
function logLine(s) {
  const el = $('#scan-log');
  if (el) { el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; }
}

/* ---------- 主题引擎（v1.7.8 浅色主题） ----------
   深色为默认；浅色靠 <html data-theme="light"> + CSS 语义变量整体换肤。
   主题状态落 settings.theme（走既有 settings:set，不新增 IPC）。 */
function applyTheme(t, opts) {
  const th = t === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  // 主题切换期间冻结过渡：整页换肤有 40+ 处 transition:all .13s，
  // 不冻结则切换是「逐元素渐变」而非瞬时换肤；且窗口被遮挡时 Chromium 会冻结动画，
  // 导致部分元素颜色停留在旧主题值（实测侧栏选中项仍为深色主题的 #8fa1bd）。
  root.classList.add('theme-swap');
  root.setAttribute('data-theme', th);
  const btn = $('#tb-theme');
  if (btn) {
    btn.textContent = th === 'light' ? '🌙' : '☀️';
    btn.title = th === 'light' ? '切换到深色主题' : '切换到浅色主题';
    btn.setAttribute('aria-label', btn.title);
  }
  // 必须重渲染：部分颜色由 JS 按主题生成（如最近视图的文件类型徽标 EXT_COLOR_LIGHT），
  // 只换 CSS 变量不会让它们跟着变 —— 实测打包版浅色下徽标仍是深色系配色，对比度仅 2.55:1。
  if (!(opts && opts.silent)) render();
  // 下一帧移除冻结（双 rAF：确保新主题样式已提交后再恢复过渡）
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-swap')));
  return th;
}
async function setTheme(t) {
  const th = applyTheme(t);   // 立即重渲染 → 主题相关颜色同步生效
  try {
    const res = await window.wb.saveSettings({ theme: th });
    // settings:set 返回合并后的完整对象（v1.7.2 起）；非对象则保留原对象合并 patch，绝不整体覆盖
    SETTINGS = (res && typeof res === 'object') ? res : Object.assign({}, SETTINGS, { theme: th });
    SETTINGS.theme = th;
  } catch (e) {
    toast('主题保存失败：' + String((e && e.message) || e), 'err');
  }
  toast(th === 'light' ? '已切换到浅色主题' : '已切换到深色主题', 'ok');
}
function toggleTheme() { setTheme(themeIsLight() ? 'dark' : 'light'); }

/* 对比度审计已按 nodebestpractices 1.3 抽为平铺文件 renderer/contrast.js（v1.7.41）。
   _contrast / auditContrast / CONTRAST_TARGETS 在同一全局作用域直接可见，
   avatarInk（上文）、QA 钩子、qashot 调用点零改动。 */
function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const t0 = performance.now(), dur = 750;
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* 内联 SVG 图标（stroke=currentColor · viewBox 24），替代数字条/标题栏 emoji */
const ICON_PATHS = {
  projects: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  git: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  dirty: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  size: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  recent: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
};
function ico(name, size) {
  const s = size || 16;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
}

/* ---------- 状态与初始化 ---------- */

async function refreshState() {
  const st = await window.wb.getState();
  DATA = st.cache;
  SETTINGS = st.settings || {};
  SETTINGS.autoScanHours = Number(SETTINGS.autoScanHours) || 0; // 0=关闭
  FAVS = Array.isArray(SETTINGS.favorites) ? SETTINGS.favorites.filter(x => typeof x === 'string') : [];
  CAPS = st.caps;
  HISTORY = st.history || [];
  SCAN_ERRORS = Array.isArray(st.scanErrors) ? st.scanErrors : [];
  // v1.7.10：自动扫描到期检查结果兜底取回（启动即检可能早于本页订阅而丢事件）
  if (st.autoCheck) AUTO_CHECK = st.autoCheck;
  const acEl = document.getElementById('auto-check');
  if (acEl && AUTO_CHECK) acEl.innerHTML = autoCheckHtml();
  LOGINITEM = !!st.loginItem;
  VERSION = st.version || '';
  $('#tb-host').textContent = (DATA && DATA.meta) ? DATA.meta.host : '';
  // v1.7.8：主题随 settings.theme 恢复（深色为默认；旧配置无该键即回落深色）
  applyTheme(SETTINGS.theme, { silent: true });
  // v1.7.28：修复启动期标题栏最大化图标失同步 —— main.js createWindow() 在渲染层订阅 'win:state'
  // 之前就 win.maximize()，导致 maximize 的 IPC 丢失。此处一次性从 SETTINGS.winMaximized 兜底图标；
  // 该值仅在关窗时持久化，会话内用户手动最大化/还原后会过期，故必须只跑一次 ——
  // 后续 refreshState()（如 scan:done 触发）绝不覆盖 onWinState 的 live 结果。
  if (!winStateBootstrapped) {
    try {
      const maxEl = document.getElementById('win-max');
      if (maxEl) maxEl.textContent = SETTINGS.winMaximized ? '❐' : '☐';
      winStateBootstrapped = true;
    } catch (_e) { /* 缺失 DOM 节点不能打断 refreshState */ }
  }
}

async function init() {
  await refreshState();
  bindNav();
  bindDelegation();
  bindScanEvents();
  bindWinControls();
  bindPalette();
  bindPulse();
  clockTick();
  const qs = new URLSearchParams(location.search);
  if (qs.get('detail')) QA_DETAIL = qs.get('detail').trim(); // QA 钩子：--detail=xxx 透传
  setView(view, true);
  if (qs.get('view')) setView(qs.get('view'), true);
  else if (QA_DETAIL && view !== 'projects') setView('projects', true); // QA：确保项目雷达渲染以触发详情钩子
  if (qs.has('pal')) setTimeout(openPal, 900);
  if (qs.get('brief')) triggerBriefQa(qs.get('brief'));
  if (qs.get('favqa')) triggerFavQa(qs.get('favqa'));
  if (qs.get('saveqa')) triggerSaveQa(qs.get('saveqa'));
  if (qs.get('scanerrqa')) triggerScanErrQa();
  if (qs.get('dirsqa')) triggerDirsQa(qs.get('dirsqa'));
  if (qs.get('freshqa')) triggerFreshQa();
  if (qs.get('ringqa')) triggerRingQa();
  if (qs.get('briefqa')) triggerBriefExportQa(qs.get('briefqa'));
  if (qs.get('themeqa')) triggerThemeQa(qs.get('themeqa'));
  if (qs.get('searchqa')) triggerSearchQa(qs.get('searchqa'));
  if (qs.get('histqa')) triggerHistoryQa();
  if (qs.get('dayqa')) triggerDayQa();
  if (qs.get('timeqa')) triggerTimeQa();
  if (qs.get('palqa')) triggerPalQa(); // v1.7.22：命令面板点击索引修复的零副作用取证
  if (qs.get('histdiffqa')) triggerHistDiffQa(); // v1.7.23：name-key→path-key 混合快照 diff 匹配修复取证
  if (qs.get('deadbriefqa')) triggerDeadBriefQa(); // v1.7.24：buildBrief 未提交条目剔除失效项目取证
  if (qs.get('actrootqa')) triggerActRootQa(); // v1.7.25：简报活动条目两根目录归属修复取证
  if (qs.get('briefsync')) triggerBriefSyncQa(); // v1.7.26：长开窗口简报文案漂移修复取证
  if (qs.get('histlegacyqa')) triggerHistLegacyQa(); // v1.7.29：旧格式快照标注取证（纯只读）
  if (qs.get('weekqa')) triggerWeekQa(); // v1.7.35：周报纯生成器取证（零副作用）
  if (qs.get('compareqa')) triggerCompareQa(); // v1.7.36：项目对比纯生成器取证（零副作用）
  if (qs.get('favdeadqa')) triggerFavDeadQa(); // v1.7.37：失效项目不占收藏置顶取证（纯只读）
  idleStatus();
  if (!DATA) startScan({});
  // v1.7.10：启动即检在主进程启动后 3s 触发 —— 页面若因加载慢错过该事件，
  // 这里补一次 state:get 把判定结果兜底取回（否则设置页会停在「尚未执行到期检查」）。
  setTimeout(() => { refreshState().catch(() => {}); }, 5000);
}

/* QA 钩子（22 个 triggerXxxQa + pollQa/qaNote）已按 nodebestpractices 1.3 抽为平铺文件 renderer/qa.js（v1.7.41）。在 app.js 之前加载、全局直接可见，init 里的派发调用点零改动。 */

function setView(v, silent) {
  view = v;
  localStorage.setItem('wb.view', v);
  $$('#nav button').forEach(x => x.classList.toggle('on', x.dataset.view === v));
  render();
  if (!silent) $('#main').scrollTop = 0;
}

function bindWinControls() {
  $('#tb-refresh').innerHTML = ico('refresh', 14);
  $('#tb-refresh').onclick = () => startScan({ extraRoots: SETTINGS.extraRoots });
  // v1.7.8：标题栏主题切换按钮（🌙 深色 / ☀️ 浅色），点击即换并落盘
  const tbTheme = $('#tb-theme');
  if (tbTheme) tbTheme.onclick = () => toggleTheme();
  $('#win-min').onclick = () => window.wb.winMin();
  $('#win-max').onclick = () => window.wb.winMax();
  $('#win-close').onclick = () => window.wb.winClose();
  window.wb.onWinState(m => { $('#win-max').textContent = m === 'max' ? '❐' : '☐'; });
}

function clockTick() {
  const n = new Date();
  const p = x => String(x).padStart(2, '0');
  $('#tb-clock').textContent = (n.getMonth() + 1) + '月' + n.getDate() + '日 ' + p(n.getHours()) + ':' + p(n.getMinutes()) + ' · ' + WD[n.getDay()];
  // 长开窗口也要显示真实「距今」时长：每 30s 空闲态重算标题栏新鲜度（不覆盖扫描进度/完成态）
  const st = $('#tb-status');
  if (st && DATA && DATA.meta && !/^[⏳✔✘]/.test(st.textContent)) idleStatus();
  // v1.7.26：长开窗口每 30s 顺带同步简报文案（签名门控，仅 #daily-list 变）；
  // 任何 DOM 异常都不能打断 30s 定时器 —— setTimeout 调度保持原样。
  if (view === 'overview' && DATA) {
    try { refreshBrief(); } catch (_e) { /* 同步失败不影响标题栏时钟 */ }
  }
  setTimeout(clockTick, 30000 - (Date.now() % 30000) + 500);
}

function bindScanEvents() {
  window.wb.on('scan:progress', p => {
    const label = (PHASES[p.phase] || p.phase) + (p.total > 1 ? ' ' + p.current + '/' + p.total : '') + (p.name ? ' · ' + p.name : '');
    tbStatus('⏳ ' + label);
    logLine('· ' + label);
  });
  window.wb.on('scan:done', async d => {
    tbStatus('✔ 扫描完成 ' + d.durationSec + 's');
    setTimeout(idleStatus, 2500);
    toast('扫描完成，耗时 ' + d.durationSec + 's', 'ok');
    logLine('✔ 扫描完成，耗时 ' + d.durationSec + 's');
    await refreshState();
    render();
  });
  window.wb.on('scan:error', e => {
    tbStatus('✘ 扫描失败');
    toast('扫描失败：' + e, 'err');
    logLine('✘ ' + e);
    if (!DATA) renderNoData('扫描失败：' + e);
  });
  // v1.7.31：扫描成功但持久化失败 —— 与「扫描失败」分开呈现，不再误导用户去排查扫描本身
  window.wb.on('scan:persist-error', msg => {
    tbStatus('⚠ 数据未保存');
    toast(String(msg || '扫描已完成，但数据保存失败'), 'err');
    logLine('⚠ 持久化失败：' + String(msg || ''));
  });
  window.wb.on('analyze:progress', p => {
    if (view !== 'disk') return;
    const el = $('#anprogress');
    if (el) el.innerHTML = '<div class="chips"><span class="chip"><b>分析中</b> ' + p.done + '/' + p.total + ' · ' + esc(p.name) + '</span></div>';
  });
  window.wb.on('analyze:done', res => { lastAnalysis = res; if (view === 'disk') render(); });
  window.wb.on('analyze:error', e => toast('分析失败：' + e, 'err'));
  // 主进程持久化错误后推来的全量列表：只局部刷新诊断容器（不重建整页、不丢 textarea 内容）
  window.wb.on('scan-errors:changed', arr => {
    SCAN_ERRORS = Array.isArray(arr) ? arr : [];
    const el = document.getElementById('scan-errors');
    if (el) el.innerHTML = scanErrorsHtml();
  });
  // v1.7.10「自动扫描启动即检」：主进程把到期判定结果推来 —— 设置页常驻可见（自动扫描在不在管事），
  // 到期时额外给一条 toast + 标题栏状态，让用户知道「这次扫描不是自己按的」。
  window.wb.on('scan:auto', info => {
    if (!info) return;
    AUTO_CHECK = info;
    const el = document.getElementById('auto-check');
    if (el) el.innerHTML = autoCheckHtml();
    const ageTxt = info.ageMs == null ? '无缓存' : (Math.round(info.ageMs / 60000) + ' 分钟前');
    logLine('⟳ 自动扫描检查(' + info.reason + '): ' + info.why + ' · 数据年龄=' + ageTxt +
      ' · 间隔=' + info.intervalHours + 'h · ' + (info.due ? '已启动刷新' : '未到期待刷新'));
    if (info.due) { tbStatus('⏳ 自动扫描启动…'); toast('自动扫描：数据已过期，正在刷新', 'ok'); }
  });
}

async function startScan(opts) {
  const r = await window.wb.startScan(opts);
  if (!r.started) { toast(r.reason, 'err'); return; }
  tbStatus('⏳ 扫描启动…');
}

/* ---------- 机器脉搏 ---------- */

const PULSE = { samples: [], max: 120, started: false };

function bindPulse() {
  window.wb.onPulse(s => {
    PULSE.samples.push(s);
    if (PULSE.samples.length > PULSE.max) PULSE.samples.shift();
    drawPulse();
  });
  window.wb.pulseStart();
  PULSE.started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.wb.pulseStop();
    else window.wb.pulseStart();
  });
}
function pathOf(ctx, key, w, h) {
  const arr = PULSE.samples;
  const stepX = w / (PULSE.max - 1);
  arr.forEach((s, i) => {
    const x = w - (arr.length - 1 - i) * stepX;
    const y = h - (s[key] / 100) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
}
function drawPulse() {
  const cv = document.getElementById('pulse-cv');
  const last = PULSE.samples[PULSE.samples.length - 1];
  const c1 = document.getElementById('pn-cpu'), c2 = document.getElementById('pn-mem');
  if (c1) {
    c1.textContent = last ? last.cpu + '%' : '--%';
    c1.style.color = last && last.cpu > 80 ? 'var(--red)' : '';
  }
  if (c2) {
    c2.textContent = last ? last.mem + '%' : '--%';
    c2.style.color = last && last.mem > 85 ? 'var(--red)' : '';
  }
  if (!cv || !cv.clientWidth || !PULSE.samples.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = cssVar('--canvas-grid', 'rgba(255,255,255,.05)');
  ctx.lineWidth = 1;
  [25, 50, 75].forEach(p => {
    const y = h * p / 100;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const x = w * p / 100;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  });
  const arr = PULSE.samples;
  const stepX = w / (PULSE.max - 1);
  // CPU：渐变填充 + 线（颜色取自 CSS 变量，随主题切换）
  ctx.beginPath();
  pathOf(ctx, 'cpu', w, h);
  ctx.strokeStyle = cssVar('--acc', '#4d9fff'); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(w - (arr.length - 1) * stepX, h);
  ctx.closePath();
  ctx.fillStyle = cssVar('--canvas-fill', 'rgba(77,159,255,.13)');
  ctx.fill();
  // 内存：纯线
  ctx.beginPath();
  pathOf(ctx, 'mem', w, h);
  ctx.strokeStyle = cssVar('--acc2', '#a78bfa'); ctx.lineWidth = 1.6; ctx.stroke();
  // 最新点
  const lx = w, ly = h - (last.mem / 100) * (h - 8) - 4;
  ctx.beginPath(); ctx.arc(lx - 2, ly, 2.5, 0, Math.PI * 2); ctx.fillStyle = cssVar('--acc2', '#a78bfa'); ctx.fill();
}

/* ---------- 今日简报 ---------- */

/* v1.7.20：活动桶日期键 → 相对标签（今天/昨天/本月 MM-DD/跨年完整 YYYY-MM-DD）。
   纯函数；now 缺省 new Date()。所有日期键以本地时间 padStart(2,'0') 生成。
   昨天用日历法 new Date(y, m, d-1)（而非减 86400000ms），在 DST/月末边界仍准确。
   对任意畸形输入均不抛异常，兜底返回 '当日'。 */
function activityDayLabel(dateStr, now) {
  try {
    const p2 = x => String(x).padStart(2, '0');
    const d = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
    const todayKey = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const yesterdayKey = y.getFullYear() + '-' + p2(y.getMonth() + 1) + '-' + p2(y.getDate());
    const s = (typeof dateStr === 'string') ? dateStr : '';
    if (!s) return '当日';
    if (s === todayKey) return '今天';
    if (s === yesterdayKey) return '昨天';
    if (s.indexOf(String(d.getFullYear()) + '-') === 0) return s.slice(5);
    return s;
  } catch (e) {
    return '当日';
  }
}

/* v1.7.21：简报「最近提交」的时间标签。
   根因：relTime() 的 base() 恒为 DATA.meta.scanTime（快照语义，DECISIONS D8，不得改动），
   数据陈旧时「12 分钟前」是「提交距扫描 12 分钟」而非「距此刻 12 分钟」→ 读者误读为假事实。
   修法：只把扫描时刻距此刻 ≤1h 的**新鲜快照**继续交给 relTime（零回归）；
   陈旧快照改用绝对时间「于 MM-DD HH:mm 」（跨年补 YYYY-）。纯函数，不改 DATA / relTime / base。 */
function commitWhenLabel(commitTime, scanTime, now) {
  const p2 = x => String(x).padStart(2, '0');
  const toDate = v => {
    if (v == null || v === '') return new Date(NaN);
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return new Date(v);
    return new Date(String(v).slice(0, 19).replace(' ', 'T'));
  };
  try {
    const n = toDate(now == null ? new Date() : now);
    const s = toDate(scanTime);
    if (!isNaN(s) && !isNaN(n) && (n - s) <= 3600000) return relTime(commitTime) + '前';
    const c = toDate(commitTime);
    if (isNaN(c)) return String(commitTime);
    const ymd = (!isNaN(n) && c.getFullYear() !== n.getFullYear() ? c.getFullYear() + '-' : '') +
      p2(c.getMonth() + 1) + '-' + p2(c.getDate());
    return '于 ' + ymd + ' ' + p2(c.getHours()) + ':' + p2(c.getMinutes()) + ' ';
  } catch (e) {
    return String(commitTime);
  }
}

function buildBrief() {
  const projects = DATA.projects || [];
  const out = [];
  // 每条简报携带可操作动作：act/p 走既有 data-act 事件委托；tip 为悬浮提示（渲染时统一 esc）
  // v1.7.7：同时携带纯文本 text —— 复制/导出用 text，不再从 html 反推（HTML 反推会漏标签语义）
  const push = (color, html, text, act, p, tip) => out.push({ color, html, text, act, p, tip });

  projects.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).sort((a, b) => b.dirty - a.dirty).slice(0, 2)
    .forEach(p => push('var(--amber)', '「<b>' + esc(p.name) + '</b>」还有 <span class="warn">' + p.dirty + '</span> 个文件未提交，停在 <b>' + esc(p.branch) + '</b> 分支',
      '「' + p.name + '」还有 ' + p.dirty + ' 个文件未提交，停在 ' + p.branch + ' 分支', 'detail', p.path, '查看「' + p.name + '」项目详情'));

  projects.filter(p => p.isGit && p.lastCommitTime)
    .sort((a, b) => (b.lastCommitTime || '').localeCompare(a.lastCommitTime || ''))
    .slice(0, 2)
    .forEach(p => {
      const label = commitWhenLabel(p.lastCommitTime, DATA.meta && DATA.meta.scanTime);
      push('var(--acc)', '「<b>' + esc(p.name) + '</b>」' + esc(label) + '提交："' + esc((p.lastCommitSubject || '').slice(0, 36)) + '"',
        '「' + p.name + '」' + label + '提交："' + (p.lastCommitSubject || '').slice(0, 36) + '"', 'detail', p.path, '查看「' + p.name + '」项目详情');
    });

  const act = DATA.activity || [];
  const today = act[act.length - 1];
  if (today && today.count > 0) {
    // v1.7.20：桶日期未必是「今天」（autoScan=0 时可能是昨天/更早），标签按真实日期计算
    const dayLabel = activityDayLabel(today.date);
    push('var(--green)', dayLabel + ' D:\\code 与 E:\\workspace 下有 <b>' + today.count + '</b> 个文件在动',
      dayLabel + ' D:\\code 与 E:\\workspace 下有 ' + today.count + ' 个文件在动', 'goto', 'recent', '切到「最近」视图');
  }

  // v1.7.17：**只统计磁盘上仍然存在的文件**。
  // 根因：快照里的失效条目（磁盘上已不存在）保留了「删除前」的 mtime，往往比活文件新
  // ⇒ 实测前 40 条里 36 条已失效、且「D:\code\usou」那 34 条**全部已删除**
  // ⇒ 简报每天播报「最近改动集中在 D:\code\usou（34 个文件）」，而那个目录里**一个活文件都没有**
  //   ⇒ 陈述了一个不成立的事实（与 v1.7.15「目录都没了还标未提交」同款）。
  // 修法：复用 v1.7.13 已有的失效集合 RECENT_DEAD（零新增 IPC、零新增状态）剔除失效条目；
  // 若剔除后没有任何存活文件，则**不播报这一条**（没有事实基础，宁缺毋滥）。
  // 注意顺序：**先剔除失效、再取前 40** —— 反过来的话，死条目会先占满窗口，
  // 把真正的活文件挤到窗口外（实测活文件里 20 条在原下标 40 之后 ⇒ 必须先剔除）。
  const liveRecent = (DATA.recent || []).filter(r => !RECENT_DEAD.has(r.path)).slice(0, 40);
  const dirs = {};
  liveRecent.forEach(r => { dirs[r.dir] = (dirs[r.dir] || 0) + 1; });
  const topDir = Object.entries(dirs).sort((a, b) => b[1] - a[1])[0];
  if (topDir && topDir[1] > 1) push('var(--green)', '最近改动集中在 <b>' + esc(shortPath(topDir[0])) + '</b>（' + topDir[1] + ' 个文件）',
    '最近改动集中在 ' + shortPath(topDir[0]) + '（' + topDir[1] + ' 个文件）', 'goto', 'recent', '切到「最近」视图');

  const tight = (DATA.drives || []).slice().sort((a, b) => a.freeGB - b.freeGB)[0];
  if (tight) {
    const dName = esc(tight.name);
    if (tight.freeGB < 40) push('var(--red)', '<b>' + dName + ':</b> 只剩 <span class="warn">' + tight.freeGB + ' GB</span>，建议清理',
      tight.name + ': 只剩 ' + tight.freeGB + ' GB，建议清理', 'open', tight.root, '打开 ' + tight.root + ' 查看空间');
    else push('var(--muted)', '<b>' + dName + ':</b> 空间充足（剩 ' + tight.freeGB + ' GB）',
      tight.name + ': 空间充足（剩 ' + tight.freeGB + ' GB）', 'open', tight.root, '打开 ' + tight.root);
  }

  const top = [...projects].sort((a, b) => b.sizeMB - a.sizeMB)[0];
  if (top && top.sizeMB) push('var(--purple)', '体量最大的是「<b>' + esc(top.name) + '</b>」（' + (top.sizeMB / 1024).toFixed(1) + ' GB）',
    '体量最大的是「' + top.name + '」（' + (top.sizeMB / 1024).toFixed(1) + ' GB）', 'brief:bysize', '', '项目雷达按体量排序');

  // v1.7.19：历史快照读取归一化（新格式绝对路径键 / 旧格式名称键 / 混合快照）统一在 historyDiffItems 内处理。
  // 命中项目有 path 时一律 byPath 精确匹配，绝不回退 name —— 4 个同名 TclLauncher 曾会被错指到错误项目。
  historyDiffItems(HISTORY, projects).forEach(it => push(it.color, it.html, it.text, it.act, it.p, it.tip));
  // 保留 9 条：确保「详情 / 打开磁盘 / 切最近 / 按体量排序」四类动作都在列表内（列表自带滚动，不撑高卡片）
  return out.slice(0, 9);
}

/* v1.7.26：简报文案长开窗口漂移修复 —— 屏幕与复制/导出共用同一份已计算条目。
   lastBriefItems / lastBriefSig 记录屏幕当前渲染所用条目及其文案签名；
   签名 = 各条目 text 以 '|' 拼接（与 briefMarkdown 的纯文本内容同源）。 */
let lastBriefItems = null, lastBriefSig = '';

// 纯函数：把 buildBrief() 的条目渲染为 .d-item.brief-item 行（逐字等价于原内联渲染）
function briefItemsHtml(items) {
  return items.map(it =>
    '<div class="d-item brief-item" data-act="' + esc(it.act) + '" data-p="' + esc(it.p) + '" title="' + esc(it.tip || '点击查看详情') + '">' +
    '<span class="di" style="background:' + it.color + ';color:' + it.color + '"></span>' +
    '<span class="di-text">' + it.html + '</span>' +
    '<span class="di-go" aria-hidden="true">↗</span></div>').join('');
}

// 签名门控的定向更新：文案真的变了才重绘 #daily-list，不触碰其他 DOM、不触发整页 render()。
function refreshBrief() {
  if (!DATA) return false;
  const items = buildBrief();
  const sig = items.map(i => i.text).join('|');
  if (sig === lastBriefSig) return false;
  lastBriefItems = items;
  lastBriefSig = sig;
  const el = $('#daily-list');
  if (el) el.innerHTML = briefItemsHtml(items);
  return true;
}

/* ---------- 简报导出（v1.7.7） ----------
   复制与导出共用同一份 briefMarkdown() 产物 ⇒ 两条通道内容必然一致。
   · 复制走主进程 clipboard（与窗口焦点无关），主进程写完立即 readText() 回读自证
   · 导出走主进程 fs.writeFileSync，落到 Documents\工作台\简报-YYYYMMDD-HHmm.md
   纯本地文本，无外部依赖、无网络请求。 */
let lastBriefCopy = null, lastBriefExport = null;

// Markdown 特殊字符转义：导出文本里可能出现路径/提交主题中的 * _ ` [ ] 等符号
function mdEsc(s) {
  return String(s == null ? '' : s).replace(/([\\`*_[\]<>#])/g, '\\$1').replace(/\r?\n/g, ' ');
}
// 路径用行内代码包裹（反斜杠在代码段内是字面量，无需转义）
function mdPath(s) {
  return '`' + String(s == null ? '' : s).replace(/`/g, '\\`').replace(/\r?\n/g, ' ') + '`';
}
function briefMarkdown() {
  // v1.7.26：导出前先按当前时刻同步一次缓存，屏幕与导出共用同一份条目（杜绝长开窗口文案漂移）
  refreshBrief();
  const items = lastBriefItems || buildBrief();
  const m = (DATA && DATA.meta) || {};
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const now = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  const lines = [];
  lines.push('# 今日机器简报');
  lines.push('');
  lines.push('- 主机：' + mdEsc(m.host || '') + ' · 扫描时间：' + mdEsc(m.scanTime || '') + ' · 导出时间：' + now);
  lines.push('- 条目数：' + items.length);
  lines.push('');
  items.forEach((it, i) => {
    lines.push((i + 1) + '. ' + mdEsc(it.text));
    // 仅对「可跳转的真实路径」附目标行（视图跳转无路径可附）
    if (it.p && (it.act === 'detail' || it.act === 'open')) lines.push('   - 目标：' + mdPath(it.p));
  });
  lines.push('');
  lines.push('---');
  lines.push('由「工作台」本地生成 · 纯规则推导、无 AI 参与 · 数据只读自本机扫描快照');
  return lines.join('\n');
}
async function copyBrief() {
  const md = briefMarkdown();
  try {
    const r = await window.wb.briefCopy(md);
    lastBriefCopy = r || { ok: false };
    if (r && r.ok) toast('简报已复制（' + r.chars + ' 字符）', 'ok');
    else toast('复制失败：' + ((r && r.reason) || '未知错误'), 'err');
  } catch (e) {
    lastBriefCopy = { ok: false, reason: String((e && e.message) || e) };
    toast('复制失败：' + String((e && e.message) || e), 'err');
  }
}
async function exportBrief() {
  const md = briefMarkdown();
  try {
    const r = await window.wb.briefExport(md);
    if (r && r.ok) {
      lastBriefExport = { path: r.path, bytes: r.bytes, chars: r.chars };
      updateBriefExportTip();
      toast('简报已导出：' + r.path, 'ok');
    } else {
      lastBriefExport = { ok: false, reason: (r && r.reason) || '未知错误' };
      toast('导出失败：' + ((r && r.reason) || '未知错误'), 'err');
    }
  } catch (e) {
    lastBriefExport = { ok: false, reason: String((e && e.message) || e) };
    toast('导出失败：' + String((e && e.message) || e), 'err');
  }
}
/* ---------- 每周开发节奏周报（v1.7.35） ----------
   weeklyMarkdown 是纯函数：只读 DATA.activity / HISTORY，不调用 IPC、不写文件、不改任何全局数据。
   复用 mdEsc 做 Markdown 转义、normHistoryProjects 归一化快照项目键，畸形数据一律降级为零值/「无」，绝不抛异常。 */
function weeklyMarkdown() {
  const m = (DATA && DATA.meta) || {};
  const A = Array.isArray(DATA && DATA.activity) ? DATA.activity : [];
  const days = A.slice(-7); // 最近 7 个活动桶（最旧→最新）
  let activeDays = 0, totalFiles = 0, peak = null, maxCount = 0;
  days.forEach(d => {
    const c = (d && Number(d.count)) || 0;
    if (c > 0) activeDays++;
    totalFiles += c;
    if (c > maxCount) { maxCount = c; peak = d; } // 全 0 时 peak 保持 null
  });
  const weekStart = days.length ? String((days[0] && days[0].date) || '') : '';
  const weekEnd = days.length ? String((days[days.length - 1] && days[days.length - 1].date) || '') : '';

  // 本周快照：time（'YYYY-MM-DD HH:mm:ss'）日期部分落在 [weekStart, weekEnd] 内
  const recentSnaps = (Array.isArray(HISTORY) ? HISTORY : []).filter(h => {
    const t = (h && typeof h.time === 'string') ? h.time.slice(0, 10) : '';
    return !!t && (!weekStart || t >= weekStart) && (!weekEnd || t <= weekEnd);
  });
  const snapCount = recentSnaps.length;
  const firstN = snapCount >= 2 ? Object.keys(normHistoryProjects(recentSnaps[0])).length : null;
  const lastN = snapCount >= 2 ? Object.keys(normHistoryProjects(recentSnaps[snapCount - 1])).length : null;
  const projectDelta = (firstN != null && lastN != null) ? (lastN - firstN) : null;

  const lines = [];
  lines.push('# 每周开发节奏周报');
  lines.push('');
  lines.push('- 统计区间：' + mdEsc(weekStart) + ' ~ ' + mdEsc(weekEnd) + '（近 7 天）');
  lines.push('- 数据截至：' + mdEsc(String(m.scanTime || '')) + '（本机扫描快照）');
  lines.push('- 活跃天数：' + activeDays + '/7 · 变动文件合计：' + totalFiles);
  lines.push('- 峰值日：' + (peak ? mdEsc(String(peak.date)) + '（' + mdEsc(String(peak.count)) + ' 个文件）' : '无'));
  lines.push('- 本周快照：' + snapCount + ' 次' + (projectDelta != null ? ' · 收录项目数变化：' + (projectDelta >= 0 ? '+' : '') + projectDelta : ''));
  lines.push('');
  lines.push('## 每日明细');
  lines.push('');
  lines.push('| 日期 | 变动文件 |');
  lines.push('|---|---|');
  days.forEach(d => {
    lines.push('| ' + mdEsc(String((d && d.date) || '')) + ' | ' + ((d && Number(d.count)) || 0) + ' |');
  });
  lines.push('');
  lines.push('---');
  lines.push('由「工作台」本地生成 · 数据源：近 90 天活动桶 + 扫描历史 · 纯规则推导、无 AI 参与 · 数据只读自本机');
  return lines.join('\n');
}
let lastWeeklyExport = null;
async function exportWeekly() {
  const md = weeklyMarkdown();
  try {
    const r = await window.wb.briefExport(md, '周报');
    if (r && r.ok) {
      lastWeeklyExport = { path: r.path, bytes: r.bytes, chars: r.chars };
      toast('周报已导出：' + r.path, 'ok');
    } else {
      lastWeeklyExport = { ok: false, reason: (r && r.reason) || '未知错误' };
      toast('导出失败：' + ((r && r.reason) || '未知错误'), 'err');
    }
  } catch (e) {
    lastWeeklyExport = { ok: false, reason: String((e && e.message) || e) };
    toast('导出失败：' + String((e && e.message) || e), 'err');
  }
}

// 导出落点提示（常驻在简报卡片内，路径可点 → 复用既有 path:show 打开所在文件夹）
function briefExportTipHtml() {
  if (!lastBriefExport || !lastBriefExport.path) return '';
  return '已导出：<span class="bp">' + esc(lastBriefExport.path) + '</span>' +
    ' · <span class="lk" data-act="show" data-p="' + esc(lastBriefExport.path) + '">📂 打开文件夹</span>';
}
function updateBriefExportTip() {
  const el = document.getElementById('brief-export-tip');
  if (el) el.innerHTML = briefExportTipHtml();
}

/* ---------- 热力图 ---------- */

function heatCard() {
  const act = DATA.activity || [];
  const max = Math.max(1, ...act.map(a => a.count));
  const cells = act.map(a => {
    let cls = '';
    if (a.count > 0) {
      const r = a.count / max;
      cls = r < .25 ? 'l1' : r < .5 ? 'l2' : r < .75 ? 'l3' : 'l4';
    }
    return '<div class="hcell ' + cls + '" title="' + esc(a.date) + ' · ' + a.count + ' 个文件变动"></div>';
  }).join('');
  const active = act.filter(a => a.count > 0).length;
  const busiest = act.slice().sort((a, b) => b.count - a.count)[0];
  return '<div class="b-sec-t"><span>编码节奏<span class="muted small" style="margin-left:6px">近 90 天</span></span>' +
    '<span class="muted small">' + active + ' 天活跃 · 峰值 ' + (busiest ? busiest.count : 0) + '</span></div>' +
    '<div class="heat">' + cells + '</div>' +
    '<div class="heat-legend">少 <div class="hcell"></div><div class="hcell l1"></div><div class="hcell l2"></div><div class="hcell l3"></div><div class="hcell l4"></div> 多</div>';
}

/* ---------- 事件委托 ---------- */

function doAct(act, p) {
  switch (act) {
    case 'open': window.wb.openPath(p).then(r => { if (r && r !== '') toast(String(r), 'err'); }).catch(() => toast('打开失败', 'err')); break;
    // v1.7.13：此前**完全忽略** path:show 的返回值 ⇒ 失效路径点「📂 打开所在目录」是 100% 静默失败
    case 'show': window.wb.showInFolder(p).then(r => { if (r && r.ok === false) toast(String(r.reason || '无法打开所在目录'), 'err'); }).catch(() => toast('无法打开所在目录', 'err')); break;
    // v1.7.14：open:in 现在会先判存在性（缺失 → {ok:false, msg} ⇒ 这里自动弹 toast）；
    // 另补 .catch() 兜底 —— IPC 调用异常时也要有提示，否则 Promise 变成 unhandled rejection =「点了没反应」
    case 'vscode': window.wb.openIn(p, 'vscode').then(r => { if (!r || !r.ok) toast((r && r.msg) || '打开失败', 'err'); }).catch(() => toast('无法用 VS Code 打开', 'err')); break;
    case 'term': window.wb.openIn(p, 'terminal').then(r => { if (!r || !r.ok) toast((r && r.msg) || '打开失败', 'err'); }).catch(() => toast('无法在终端打开', 'err')); break;
    case 'git': case 'detail': openProject(p); break; // 🌿 统一走项目详情弹窗
    case 'redirs': if (currentDetail && curDirsPath() === p) currentDetail.loadDirs(true); break;
    case 'dirsdrill': drillDirs(p); break;
    case 'dirsup': dirsUp(); break;
    case 'copy': copyText(p); break;
    case 'scan': startScan({ skipSizes: !!p, extraRoots: SETTINGS.extraRoots }); break;
    case 'goto': setView(p); break;
    case 'brief:bysize': sortBy = 'size'; setView('projects'); break;
    case 'brief:copy': copyBrief(); break;
    case 'brief:export': exportBrief(); break;
    case 'weekly:export': exportWeekly(); break;
    case 'fav': toggleFav(p); break;
    case 'typefilter': filterType = p; render(); break;
    case 'drill': { const el = $('#an-path'); if (el) { el.value = p; startAnalyze(); } break; }
    case 'analyze': startAnalyze(); break;
    case 'reforce': { if (p) { const el = $('#an-path'); if (el) el.value = p; } startAnalyze(true); break; }
    case 'saveSettings': saveSettings(); break;
    case 'clearScanErrors': clearScanErrors(); break;
    case 'theme:set': setTheme(p); break;
    case 'compare:open': openCompare(); break;
    case 'compare:run': runCompare(); break;
  }
}

function bindDelegation() {
  $('#view').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'typefilter') doAct(a, b.dataset.t);
    else if (a === 'scan') doAct(a, b.dataset.fast || b.dataset.p);
    else doAct(a, b.dataset.p);
  });
  $('#view').addEventListener('input', e => {
    if (e.target.id === 'q') { q = e.target.value.trim(); renderProjectList(); }
    else if (e.target.id === 'rq') { rq = e.target.value; renderRecentList(); }
  });
  $('#view').addEventListener('change', e => { if (e.target.id === 'sort') { sortBy = e.target.value; renderProjectList(); } });
  // v1.7.6 磁盘环 hover 明细：mouseover/mouseout 会冒泡 → 在常驻的 #view 上委托一次即可，无需逐环绑定
  $('#view').addEventListener('mouseover', e => {
    const ring = e.target && e.target.closest ? e.target.closest('svg.donut[data-ring]') : null;
    if (ring) showRingTip(ring);
  });
  $('#view').addEventListener('mouseout', e => {
    const ring = e.target && e.target.closest ? e.target.closest('svg.donut[data-ring]') : null;
    if (!ring) return;
    if (e.relatedTarget && ring.contains(e.relatedTarget)) return; // 环内部元素间移动不隐藏
    hideRingTip();
  });
  $('#main').addEventListener('scroll', hideRingTip);
  // v1.7.6：滚轮也会改变环的视口位置 → 滚动即收起浮层，避免浮层悬挂在旧位置
  $('#main').addEventListener('wheel', hideRingTip, { passive: true });
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal') { closeModal(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'closeModal') closeModal();
    else doAct(b.dataset.act, b.dataset.p); // 弹窗内按钮（目录构成行等）复用全局动作
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closePal(); }
    if (e.key === 'F5') { e.preventDefault(); startScan({ extraRoots: SETTINGS.extraRoots }); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePal();
    }
  });
}

/* ---------- 命令面板 ---------- */

let PAL = [], palActive = 0, palVisible = false;

function palIndex() {
  const items = [];
  const projects = (DATA && DATA.projects || []).slice()
    // v1.7.37：失效项目不参与收藏置顶（否则收藏的已删除项目挤掉真实项目首屏）⇒ 失效恒沉底、层内收藏优先
    .sort((a, b) => {
      const da = PROJ_DEAD.has(a.path) ? 1 : 0, db = PROJ_DEAD.has(b.path) ? 1 : 0;
      if (da !== db) return da - db;
      return (isFav(b.path) ? 1 : 0) - (isFav(a.path) ? 1 : 0);
    }); // 收藏优先（稳定排序）⇒ v1.7.1 立的「收藏恒置顶」约定在存活层内不受破坏
  projects.forEach(p => {
    const fav = isFav(p.path);
    const hue = hueOf(p.name);
    const ico = '<div class="avatar" style="' + avatarStyle(hue, 'width:30px;height:30px;border-radius:8px;font-size:13px') + '">' + esc(p.name.slice(0, 1).toUpperCase()) + '</div>';
    const acts = [['📂', 'open', p.path]];
    if (CAPS.vscode) acts.push(['💻', 'vscode', p.path]);
    acts.push(['⌨️', 'term', p.path]);
    if (p.isGit) acts.push(['🌿', 'detail', p.path]);
    items.push({
      label: (fav ? '★ ' : '') + p.name,
      hint: (fav ? '★ 已收藏 · ' : '') + p.type + (p.isGit ? ' · ' + (p.branch || '') : '') + ' · ' + p.path,
      // v1.7.12：p.branch 可能为 null/undefined —— 旧的字符串拼接会产出字面量 "undefined"，
      // 污染搜索键（搜 "undefined" 会命中所有非 git 项目）。改为显式兜底。
      keys: [p.name, p.path, p.branch || '', p.type || '', fav ? '收藏 置顶 星标 favorite' : ''].join(' ').toLowerCase(),
      ico, acts,
      run: () => doAct('open', p.path)
    });
  });
  ((DATA && DATA.links) || []).forEach(l => {
    items.push({
      label: l.name, hint: l.path, keys: (l.name + ' ' + l.path).toLowerCase(),
      ico: '📁', icoCls: 'g1', acts: [['📂', 'open', l.path]],
      run: () => doAct('open', l.path)
    });
  });
  [['总览', 'overview'], ['项目', 'projects'], ['最近', 'recent'], ['空间', 'disk'], ['系统', 'system'], ['设置', 'settings']]
    .forEach(([lbl, v]) => items.push({
      label: '视图：' + lbl, hint: '切换视图', keys: '视图 ' + lbl + ' view ' + v,
      ico: '↪', icoCls: 'g4', acts: [],
      run: () => setView(v)
    }));
  items.push({
    label: '动作：全量重扫', hint: 'F5 · 约 4 分钟', keys: '动作 重扫 scan full 全量',
    ico: '🔄', icoCls: 'g3', acts: [],
    run: () => startScan({ extraRoots: SETTINGS.extraRoots })
  });
  items.push({
    label: '动作：快速重扫（跳过体量）', hint: '数十秒', keys: '动作 重扫 fast 快速',
    ico: '⚡', icoCls: 'g2', acts: [],
    run: () => startScan({ skipSizes: true, extraRoots: SETTINGS.extraRoots })
  });
  // v1.7.12：最近文件也进命令面板 —— 「万物直达」此前只到项目/目录/视图/动作，到不了文件。
  // 只在有查询词时才会被检索到（空查询时默认清单不变：收藏优先的项目 + 2 个视图）。
  ((DATA && DATA.recent) || []).forEach(r => {
    const nm = String(r.name || '');
    if (!nm) return;
    const dir = String(r.dir || '');
    items.push({
      label: nm, hint: dir + ' · ' + fmtSizeKB(r.sizeKB),
      keys: (nm + ' ' + dir + ' ' + String(r.path || '')).toLowerCase(),
      ico: '📄', icoCls: 'g4',
      acts: [['📂', 'show', r.path], ['📄', 'open', r.path]],
      run: () => doAct('open', r.path)
    });
  });
  return items;
}

function bindPalette() {
  PAL = palIndex();
  $('#palette').addEventListener('click', e => {
    if (e.target.id === 'palette') { closePal(); return; }
    const actB = e.target.closest('[data-act]');
    if (actB) { doAct(actB.dataset.act, actB.dataset.p); closePal(); return; }
    const item = e.target.closest('.pal-item');
    if (item) {
      // v1.7.22：data-i 来自 renderPalList() 里 palFiltered() 的「过滤后」下标，
      // 必须同样用过滤后列表解析（与 Enter 路径一致）。旧代码用 PAL[i] 索引完整清单 ⇒
      // 空查询点「视图：总览」(i=8) 会执行 PAL[8].run()=doAct('open', 错误路径)。
      const list = palFiltered();
      const i = Number(item.dataset.i);
      closePal();
      if (list[i]) list[i].run();
    }
  });
  $('#pal-input').addEventListener('input', e => renderPalList(e.target.value));
  $('#pal-input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palActive = Math.min(palActive + 1, palFiltered().length - 1); renderPalActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palActive = Math.max(palActive - 1, 0); renderPalActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); const list = palFiltered(); closePal(); if (list[palActive]) list[palActive].run(); }
  });
}

function palFiltered() { return palFilteredFor($('#pal-input') ? $('#pal-input').value : ''); }

/* v1.7.12：命令面板过滤重写 —— 分词 AND + 拼音首字母 + 子序列模糊 + 相关性稳定排序。
   旧实现 it.keys.includes(qk) 要求整串连续出现 ⇒「tcl launcher」0 命中（真实缺陷）。 */
function palFilteredFor(query) {
  const tokens = searchTokens(query);
  if (!tokens.length) {
    return PAL.filter(it => !it.label.startsWith('视图：')).slice(0, 8)
      .concat(PAL.filter(it => it.label.startsWith('视图：')).slice(0, 2));
  }
  const hits = [];
  for (let i = 0; i < PAL.length; i++) {
    const it = PAL[i];
    const fields = [
      String(it.label || '').toLowerCase(),
      String(it.hint || '').toLowerCase(),
      String(it.keys || '').toLowerCase()
    ];
    const pyFields = [pyInitials(fields[0]), pyInitials(fields[2])];
    const s = matchFields(fields, pyFields, query);
    if (s >= 0) hits.push({ i: i, it: it, s: s });
  }
  hits.sort((a, b) => (b.s - a.s) || (a.i - b.i));   // 同分保原序 ⇒ 收藏仍恒置顶
  return hits.slice(0, 14).map(h => h.it);
}

function renderPalList(qv) {
  palActive = 0;
  let list = [];
  try { list = palFiltered(); } catch (e) { console.error('[pal] filter error: ' + e); }
  if (!list.length) { $('#pal-list').innerHTML = '<div class="pal-empty">没有匹配的结果</div>'; return; }
  let html = '';
  try {
    html = list.map((it, i) =>
      '<div class="pal-item' + (i === palActive ? ' on' : '') + '" data-i="' + i + '">' +
      '<div class="pi-ico" style="background:var(--panel2)">' + (it.ico || '·') + '</div>' +
      '<div class="pi-main"><div class="pi-label">' + esc(it.label) + '</div>' +
      '<div class="pi-hint">' + esc(it.hint) + '</div></div>' +
      '<div class="pi-acts">' + (it.acts || []).map(a =>
        '<button class="ibtn" data-act="' + a[1] + '" data-p="' + esc(a[2]) + '" title="' + a[0] + '">' + a[0] + '</button>').join('') + '</div>' +
      '</div>').join('');
  } catch (e) { console.error('[pal] render error: ' + e); html = '<div class="pal-empty">渲染出错：' + esc(String(e)) + '</div>'; }
  $('#pal-list').innerHTML = html;
}
function renderPalActive() {
  $$('#pal-list .pal-item').forEach((el, i) => el.classList.toggle('on', i === palActive));
  const el = $$('#pal-list .pal-item')[palActive];
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function openPal() {
  palVisible = true;
  $('#palette').classList.remove('hidden');
  $('#pal-input').value = '';
  PAL = palIndex();
  console.log('[pal] open, PAL=' + PAL.length + ', data=' + !!DATA + ', projects=' + ((DATA && DATA.projects || []).length));
  renderPalList('');
  setTimeout(() => $('#pal-input').focus(), 30);
}
function closePal() { palVisible = false; $('#palette').classList.add('hidden'); }
function togglePal() { palVisible ? closePal() : openPal(); }

/* ---------- 渲染分发 ---------- */

function render() {
  hideRingTip(); // v1.7.6：换视图/重扫后旧浮层位置已失效，先收起
  if (!DATA) { renderNoData(); renderFoot(); return; }
  if (view === 'overview') renderOverview();
  else if (view === 'projects') renderProjects();
  else if (view === 'recent') renderRecent();
  else if (view === 'disk') renderDisk();
  else if (view === 'system') renderSystem();
  else if (view === 'settings') renderSettings();
  // v1.7.13：给「最近动态」里已失效（磁盘上不存在）的条目打标记 —— 一次批量 IPC，
  // 同一批路径只查一次（recentCheckKey 去抖），标记变化时才重绘。
  checkRecentExistence(DATA.recent || []);
  // v1.7.15：同样给「项目雷达」里已失效的项目打标记（复用既有 path:exists 通道，零新增 IPC）
  checkProjectExistence(DATA.projects || []);
  renderFoot();
  // 标题栏状态：扫描进行中（⏳）时不要被「数据 N 前更新」覆盖 —— 否则任何一次重渲染
  // （切视图、圆环收起、命令面板关闭等）都会把扫描进度抹掉，用户以为没在扫。
  // （v1.7.10 巡检发现：自动扫描启动即检后，后台扫描期间切视图即触发此问题）
  // 注意只保护 ⏳：✔（扫描完成）与 ✘（扫描失败）仍按原逻辑回到「数据 N 前更新」
  // （完成态有 2.5s 延时回填，失败原因另有 toast + 扫描日志 + 持久化错误诊断兜底）。
  const st = $('#tb-status');
  if (!st || st.textContent.indexOf('⏳') !== 0) idleStatus();
}

function renderFoot() {
  $('#side-foot').innerHTML = DATA && DATA.meta
    ? '<b>' + esc(DATA.meta.user) + '</b><br>' + (VERSION ? 'v' + esc(VERSION) + ' · ' : '') + esc(freshness(DATA.meta.scanTime)) + ' · ' + (DATA.meta.fast ? '快速' : '全量') + '<br>Ctrl+K 命令面板 · F5 重扫'
    : '<b>工作台 ' + (VERSION ? 'v' + esc(VERSION) : '') + '</b><br>首次扫描进行中…';
}

function renderNoData(errMsg) {
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<div class="greet"><div class="greet-main">' + greet() + '，正在<span class="grad-text">建立本机档案</span></div>' +
    '<div class="greet-sub">首次全量扫描约需 4 分钟（57 个项目，含 20GB+ 大仓库），完成后自动展示。</div></div>' +
    '<div class="bento">' +
    '<div class="b b-pulse"><div class="sk" style="height:130px"></div></div>' +
    '<div class="b b-daily"><div class="sk" style="height:130px"></div></div>' +
    '<div class="b b-heat"><div class="sk" style="height:120px"></div></div>' +
    '<div class="b b-drives"><div class="sk" style="height:110px;width:100%"></div></div>' +
    '</div>' +
    (errMsg
      ? '<div class="hint" style="color:var(--red)">✘ ' + esc(errMsg) + '<br><button class="btn" style="margin-top:10px" data-act="scan">重试扫描</button></div>'
      : '<div class="hint">💡 扫描期间可随时按 <b>Ctrl+K</b>，或在「设置」看实时日志。</div>') +
    '</div>';
}

/* ---------- 总览（Bento） ---------- */

function miniStat(icon, cls, id, val, lbl, goto) {
  return '<div class="mini" data-act="goto" data-p="' + goto + '">' +
    '<div class="ico ' + cls + '">' + icon + '</div>' +
    '<div><div class="big" id="' + id + '">' + val + '</div><div class="lbl">' + lbl + '</div></div></div>';
}

function renderOverview() {
  const briefItems = buildBrief();  // v1.7.26：只算一次；屏幕与复制/导出共用同一份条目
  lastBriefItems = briefItems;
  lastBriefSig = briefItems.map(i => i.text).join('|');
  const m = DATA.meta;
  const projects = DATA.projects || [];
  const gitN = projects.filter(p => p.isGit).length;
  // v1.7.18：剔除失效项目 —— 目录都没了还标未提交 = 陈述不成立的事实（同 renderProjectList/renderTypeChips 口径）
  const dirtyN = projects.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).length;
  const favN = (FAVS || []).length;
  const sizeSum = projects.reduce((s, p) => s + (p.sizeMB || 0), 0);
  const n = new Date();
  const today = (n.getMonth() + 1) + '月' + n.getDate() + '日 · ' + WD[n.getDay()];

  $('#view').innerHTML = '<div class="viewwrap">' +
    '<div class="greet" style="margin-bottom:16px"><div class="greet-main">' + greet() + '，<span class="grad-text">' + esc(m.user.split('\\').pop()) + '</span></div>' +
    '<div class="greet-sub">' + today + ' · <b>' + projects.length + '</b> 个项目 · <b>' + gitN + '</b> 个仓库 · ' + esc(freshness(m.scanTime)) + (m.fast ? '（快速模式）' : '') + ' · 按 <b>Ctrl+K</b> 万物直达</div></div>' +

    '<div class="bento">' +
    '<div class="b b-pulse">' +
    '<div class="b-sec-t"><span>机器脉搏 <span class="live"><span class="live-dot"></span>LIVE</span></span>' +
    '<span class="muted small">1s 采样</span></div>' +
    '<div class="pulse-nums"><div class="pulse-num"><div class="v cpu" id="pn-cpu">--%</div><div class="l">CPU</div></div>' +
    '<div class="pulse-num"><div class="v mem" id="pn-mem">--%</div><div class="l">内存</div></div></div>' +
    '<canvas id="pulse-cv"></canvas></div>' +

    '<div class="b b-daily"><div class="b-sec-t"><span>今日机器简报</span>' +
    '<span class="muted small">' + esc(m.scanTime.slice(5, 16)) + ' 扫描 · 点击条目可跳转' + (HISTORY.length >= 2 ? ' · 已对比上次' : '') + '</span></div>' +
    '<div class="brief-tools">' +
    '<button class="btool" data-act="brief:copy" title="复制今日简报为 Markdown 文本到剪贴板">📋 复制简报</button>' +
    '<button class="btool" data-act="brief:export" title="导出今日简报为 Markdown 文件">⬇ 导出 Markdown</button>' +
    '<button class="btool" data-act="weekly:export" title="导出近 7 天开发节奏周报为 Markdown">📅 导出周报</button>' +
    '<span class="brief-export-tip" id="brief-export-tip">' + briefExportTipHtml() + '</span>' +
    '</div>' +
    '<div class="daily-list" id="daily-list">' + briefItemsHtml(briefItems) +
    '</div></div>' +

    '<div class="b b-heat">' + heatCard() + '</div>' +

    '<div class="b b-drives">' + (DATA.drives || []).map(driveCard).join('') + '</div>' +

    '<div class="b-statrow">' +
    miniStat(ico('projects'), 'g1', 'ms-projects', projects.length, '个项目', 'projects') +
    miniStat(ico('git'), 'g2', 'ms-git', gitN, '个 git 仓库', 'projects') +
    miniStat(ico('dirty'), 'g3', 'ms-dirty', dirtyN, '个仓库未提交', 'projects') +
    miniStat(ico('size'), 'g4', '', fmtMB(sizeSum), '源码总体量', 'projects') +
    miniStat(ico('recent'), 'g5', 'ms-recent', (DATA.recent || []).length, '条最近动态', 'recent') +
    miniStat(ico('star'), 'g6', 'ms-fav', favN, '个收藏项目', 'projects') +
    '</div>' +

    '<div class="b b-recent"><div class="b-sec-t"><span>最近动态</span>' +
    '<span class="muted small" style="cursor:pointer" data-act="goto" data-p="recent">全部 ' + (DATA.recent || []).length + ' 条 →</span></div>' +
    // v1.7.16：总览卡也用同一套「失效沉底」顺序 —— 否则它会长期显示 9 条全是死条目
    '<div class="rlist">' + (recentOrdered(DATA.recent || []).slice(0, 9).map(recentRow).join('') || '<div class="empty">无记录</div>') + '</div></div>' +

    '<div class="b b-links"><div class="b-sec-t"><span>快速入口</span></div>' +
    '<div class="link-grid">' + (DATA.links || []).map(l =>
      '<div class="lcard" data-act="open" data-p="' + esc(l.path) + '"><span>📁 ' + esc(l.name) + '</span><span class="p">' + esc(l.path) + '</span></div>').join('') +
    '</div></div>' +

    '</div></div>';

  animateNum('ms-projects', projects.length);
  animateNum('ms-git', gitN);
  animateNum('ms-dirty', dirtyN);
  animateNum('ms-recent', (DATA.recent || []).length);
  animateNum('ms-fav', favN);
  const msEl = document.getElementById('ms-dirty');
  if (msEl && dirtyN > 0) msEl.style.color = 'var(--amber)';
  requestAnimationFrame(drawPulse);
}

function driveCard(d) {
  const pct = d.totalGB ? Math.round(d.usedGB / d.totalGB * 100) : 0;
  const C = 2 * Math.PI * 30;
  const col = pct > 85 ? 'var(--red)' : pct > 65 ? 'var(--amber)' : 'url(#dg' + d.name + ')';
  // v1.7.6 磁盘环 hover 明细：自定义浮层（立即出现、可截图取证）。
  // 刻意不设原生 title 属性：Chromium 的原生 tooltip 悬停约 0.5s 后弹出，会与自定义浮层
  // 重叠成「双 tooltip」；改用 aria-label 保留可访问名（读屏可读）而不触发原生气泡。
  const ringTitle = d.name + ': 已用 ' + d.usedGB + ' GB · 剩 ' + d.freeGB + ' GB · 共 ' + d.totalGB + ' GB';
  return '<div class="drive" data-act="open" data-p="' + esc(d.root) + '" title="点击打开 ' + esc(d.root) + '">' +
    '<svg class="donut ring" viewBox="0 0 76 76" style="width:72px;height:72px" data-ring="' + esc(d.name) + '" aria-label="' + esc(ringTitle) + '">' +
    '<defs><linearGradient id="dg' + d.name + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#4d9fff"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs>' +
    '<circle cx="38" cy="38" r="30" fill="none" stroke="#223047" stroke-width="8"/>' +
    '<circle cx="38" cy="38" r="30" fill="none" stroke="' + col + '" stroke-width="8" stroke-linecap="round" ' +
    'stroke-dasharray="' + (pct / 100 * C).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 38 38)"/>' +
    '<text x="38" y="43" text-anchor="middle" class="donut-num" style="font-size:12px">' + pct + '%</text></svg>' +
    '<div class="d-info"><div class="d-name" style="font-size:14px">' + esc(d.name) + ':</div>' +
    '<div class="d-line">已用 ' + d.usedGB + ' GB</div>' +
    '<div class="d-line">剩 <b style="color:var(--text)">' + d.freeGB + '</b> GB</div></div></div>';
}

/* ---------- 磁盘环 hover 明细（v1.7.6） ----------
   悬停总览的环形图 → 浮层显示「已用 / 剩 / 共 / 使用率」。
   · 事件走 #view 上的 mouseover / mouseout 委托（冒泡事件，容器常驻 → 只绑一次，无重复绑定）
   · 浮层内容从 DATA.drives 按 data-ring（盘符）反查真实数据，不在 DOM 属性里塞数字
   · 动态文本一律 esc()；纯渲染层，零新增 IPC、零外部依赖 */
let RING_TIP = null, RING_TIP_FOR = '';
function showRingTip(ring) {
  if (!ring) return;
  const name = ring.getAttribute('data-ring') || '';
  // 同一环内部元素间移动会重复触发 mouseover → 已在显示则不重复定位（防抖动）
  if (RING_TIP_FOR === name && RING_TIP && !RING_TIP.classList.contains('hidden')) return;
  const d = ((DATA && DATA.drives) || []).find(x => x && x.name === name);
  if (!d) return;
  if (!RING_TIP) {
    RING_TIP = document.createElement('div');
    RING_TIP.id = 'ring-tip';
    RING_TIP.className = 'ring-tip hidden';
    document.body.appendChild(RING_TIP);
  }
  const pct = d.totalGB ? Math.round(d.usedGB / d.totalGB * 100) : 0;
  RING_TIP.innerHTML =
    '<div class="rt-t"><span>' + esc(d.name) + ':</span><span class="rt-pct">' + pct + '%</span></div>' +
    '<div class="rt-row"><span>已用</span><b>' + esc(String(d.usedGB)) + '</b><span class="rt-u">GB</span></div>' +
    '<div class="rt-row"><span>剩余</span><b>' + esc(String(d.freeGB)) + '</b><span class="rt-u">GB</span></div>' +
    '<div class="rt-row"><span>共</span><b>' + esc(String(d.totalGB)) + '</b><span class="rt-u">GB</span></div>' +
    '<div class="rt-foot">点击打开 ' + esc(d.root) + '</div>';
  RING_TIP.classList.remove('hidden');
  RING_TIP_FOR = name;
  const r = ring.getBoundingClientRect();
  const tw = RING_TIP.offsetWidth, th = RING_TIP.offsetHeight;
  let left = r.right + 12, top = r.top + (r.height - th) / 2;
  if (left + tw > window.innerWidth - 10) left = r.left - tw - 12; // 右侧放不下 → 翻到左侧
  if (left < 10) left = 10;
  if (top < 10) top = 10;
  if (top + th > window.innerHeight - 10) top = Math.max(10, window.innerHeight - th - 10);
  RING_TIP.style.left = Math.round(left) + 'px';
  RING_TIP.style.top = Math.round(top) + 'px';
}
function hideRingTip() {
  if (RING_TIP) RING_TIP.classList.add('hidden');
  RING_TIP_FOR = '';
}

/* v1.7.13：批量存在性检查 —— **一次** IPC 传全部路径（主进程一次循环 existsSync），
   避免 60 次 IPC 风暴；结果只用于**视觉标注**，点击时主进程仍会再判一次存在性（双保险）。
   三个防抖：
     ① recentCheckKey —— 同一批路径只查一次（切视图/重绘不会反复发 IPC）；
     ② recentCheckToken —— 只采纳最后一次检查的结果（丢弃过期响应）；
     ③ 只有失效集合**真的变了**才重绘（否则会自激成无限重绘）。 */
async function checkRecentExistence(list) {
  const paths = (list || []).map(r => r && r.path).filter(Boolean);
  if (!paths.length) return;
  const key = paths.join('\u0001');
  if (key === recentCheckKey) return;   // 同一批路径已查过 → 不重复发 IPC
  recentCheckKey = key;
  const token = ++recentCheckToken;
  let res = null;
  try { res = await window.wb.pathExists(paths); } catch (_e) { return; }
  if (token !== recentCheckToken) return;   // 已有更新的检查 → 丢弃过期结果
  const dead = new Set();
  for (const p of paths) if (res && res[p] === false) dead.add(p);
  let changed = dead.size !== RECENT_DEAD.size;
  if (!changed) { for (const p of dead) { if (!RECENT_DEAD.has(p)) { changed = true; break; } } }
  RECENT_DEAD = dead;
  if (!changed) return;
  // v1.7.16：最近视图**只重绘 #recent-list 子容器** —— 本轮的「沉底」效果依赖「检查完成后重排」，
  // 若整页 render() 会重建 #rq 搜索框 ⇒ 用户正在打字时焦点丢失、输入被清空（v1.7.12 同款考量）。
  // 其他视图（总览的「最近动态」卡取前 9 条）仍需整页重绘才能跟着沉底。
  if (view === 'recent') renderRecentList(); else render();
}

/* v1.7.15：项目雷达的失效标注 —— 与 checkRecentExistence **完全同构**，
   但**只重绘 #proj-list 子容器**（不调 render()）——
   原因：render() 在 projects 视图下会重建 #q 搜索框 ⇒ 用户正在打字时焦点丢失、输入被清空
   （v1.7.12 引入搜索框后「最近视图只重绘子容器」正是为此，本轮不能重犯）。
   通道复用**既有** path:exists（v1.7.13 新增）⇒ 零新增 IPC、main.js/preload.js 零改动。
   三个防抖同 checkRecentExistence：
     ① projCheckKey —— 同一批路径只查一次（切视图/重绘不会反复发 IPC）；
     ② projCheckToken —— 只采纳最后一次检查的结果（丢弃过期响应）；
     ③ 只有失效集合**真的变了**才重绘（否则会自激成无限重绘）。 */
async function checkProjectExistence(list) {
  const paths = (list || []).map(p => p && p.path).filter(Boolean);
  if (!paths.length) return;
  const key = paths.join('\u0001');
  if (key === projCheckKey) return;   // 同一批路径已查过 → 不重复发 IPC
  projCheckKey = key;
  const token = ++projCheckToken;
  let res = null;
  try { res = await window.wb.pathExists(paths); } catch (_e) { return; }
  if (token !== projCheckToken) return;   // 已有更新的检查 → 丢弃过期结果
  const dead = new Set();
  for (const p of paths) if (res && res[p] === false) dead.add(p);
  let changed = dead.size !== PROJ_DEAD.size;
  if (!changed) { for (const p of dead) { if (!PROJ_DEAD.has(p)) { changed = true; break; } } }
  PROJ_DEAD = dead;
  // v1.7.18：失效集合变化后**所有视图**都要收敛 —— 原实现只在 projects 视图重绘，
  // ⇒ 总览数字条（`ms-dirty`）永远停在首帧的 5（首帧时 PROJ_DEAD 还是空集），
  //   或用户从项目视图切回总览时看到「5 → 3」的跳变。
  // 按视图分流（与 checkRecentExistence L1665 完全同构）：
  //   · projects —— 只重绘两个子容器（#type-chips + #proj-list），**不碰 #q 搜索框** ⇒ 零失焦、零布局位移；
  //   · 其余视图 —— 走 render()（总览视图内零 <input>，全量重绘不会丢焦点）。
  if (!changed) return;
  if (view === 'projects') { renderTypeChips(); renderProjectList(); }
  else render();
}

/* v1.7.16：失效条目**沉底** —— 把「磁盘上已不存在」的条目排到列表末尾。
   根因：两个列表都按**快照里的 mtime** 排序，而失效条目保留了「删除前」的 mtime
   （往往比活文件新）⇒ 实测 60 条「最近动态」里 36 条失效条目占据前 37 位，
   24 条真实文件**全被挤出首屏**（用户要滚过 36 行灰条目才看到一个活文件）。
   v1.7.13/v1.7.15 只解决了「**标出来**」，本轮补上「**排序**」这最后一块。
   纯函数：保持各自原序（活条目之间、失效条目之间的相对顺序都不变）。 */
function partitionDead(list, deadSet) {
  const live = [], dead = [];
  (list || []).forEach(x => (deadSet && deadSet.has(x.path) ? dead : live).push(x));
  return { live: live, dead: dead };
}
/* v1.7.16：总览卡与最近视图**共用**同一套顺序（否则同一个「最近动态」概念在两个地方给出两种答案） */
function recentOrdered(list) {
  const p = partitionDead(list, RECENT_DEAD);
  return p.live.concat(p.dead);
}

function recentRow(r) {
  const ext = ((r.name || '').split('.').pop() || '').toLowerCase();
  // v1.7.8：文件类型徽标配色随主题切换（浅色下浅色系值在白底不可读）
  const extMap = themeIsLight() ? EXT_COLOR_LIGHT : EXT_COLOR;
  const col = extMap[ext] || (themeIsLight() ? '#5b6b82' : '#8fa1bd');
  // v1.7.13：失效条目（磁盘上已不存在）—— 角标占用「文件类型」那一格 ⇒ 网格列数不变、零布局位移
  const dead = RECENT_DEAD.has(r.path);
  const typeCell = dead
    ? '<span class="deadtag" title="该路径在磁盘上已不存在（可能已被删除或移动）">已删除</span>'
    : '<span class="ext" style="color:' + col + ';border-color:' + col + '55">' + esc(ext.slice(0, 4) || 'file') + '</span>';
  return '<div class="ritem' + (dead ? ' is-dead' : '') + '">' +
    '<span class="t">' + esc((r.mtime || '').slice(5, 16)) + '</span>' +
    typeCell +
    '<span class="name" data-act="open" data-p="' + esc(r.path) + '" title="' + esc(r.path) + '">' + esc(r.name) + '</span>' +
    '<span class="d" title="' + esc(r.dir) + '">' + esc(r.dir) + '</span>' +
    '<span class="s">' + fmtSizeKB(r.sizeKB) + '</span>' +
    '<button class="ibtn' + (dead ? ' dead' : '') + '" data-act="show" data-p="' + esc(r.path) + '" title="' + (dead ? '文件已不存在' : '打开所在目录') + '">📂</button></div>';
}

/* ---------- 项目 ---------- */

function renderProjects() {
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>项目雷达<span class="sub">悬停行显示操作 · Ctrl+K 全局直达</span></h2>' +
    '<div class="toolbar">' +
    '<input id="q" type="search" placeholder="搜索项目 / 路径 / 分支 / 提交…" value="' + esc(q) + '">' +
    '<div class="chips" id="type-chips"></div>' +
    '<select id="sort">' +
    '<option value="mtime"' + (sortBy === 'mtime' ? ' selected' : '') + '>按修改时间</option>' +
    '<option value="commit"' + (sortBy === 'commit' ? ' selected' : '') + '>按最近提交</option>' +
    '<option value="size"' + (sortBy === 'size' ? ' selected' : '') + '>按体量</option>' +
    '<option value="name"' + (sortBy === 'name' ? ' selected' : '') + '>按名称</option></select>' +
    '<button class="btool" data-act="compare:open" title="并排对比两个 git 项目的分支 / 未提交 / 提交 / 体量">⚖ 对比</button>' +
    '</div><div id="proj-list"></div></div>';
  renderTypeChips();
  renderProjectList();
  // QA 钩子：?detail=项目名 → 列表就绪后自动打开项目详情
  if (QA_DETAIL) {
    const name = QA_DETAIL; QA_DETAIL = '';
    const hit = (DATA.projects || []).find(x => x.name === name);
    if (hit) openProject(hit.path);
  }
}
function renderTypeChips() {
  const projects = DATA.projects || [];
  const types = [...new Set(projects.map(p => p.type))];
  const counts = { '全部': projects.length };
  projects.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  // v1.7.18：chip 口径与列表统计行、总览数字条、托盘严格一致 —— 必须剔除失效项目
  counts['未提交'] = projects.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).length;
  const order = ['全部', '未提交'].concat(types);
  $('#type-chips').innerHTML = order.map(t =>
    '<button class="chipbtn' + (t === filterType ? ' on' : '') + '" data-act="typefilter" data-t="' + esc(t) + '">' + esc(t) + ' ' + (counts[t] || 0) + '</button>').join('');
}
/* v1.7.12：项目视图搜索与命令面板共用同一内核（分词 AND + 拼音 + 模糊），
   消除第二处「整串连续子串」同款缺陷（旧：搜索框同样搜不到「tcl launcher」）。 */
function projectHits(query) {
  const projects = DATA.projects || [];
  const tokens = searchTokens(query);
  if (!tokens.length) return projects;
  return projects.filter(p => {
    const fields = [
      String(p.name || '').toLowerCase(),
      String(p.path || '').toLowerCase(),
      String(p.branch || '').toLowerCase(),
      String(p.lastCommitSubject || '').toLowerCase()
    ];
    const pyFields = [pyInitials(fields[0]), pyInitials(fields[0] + ' ' + fields[1])];
    return matchFields(fields, pyFields, query) >= 0;
  });
}
function renderProjectList() {
  const projects = DATA.projects || [];
  const hitSet = new Set(projectHits(q));
  const list = projects.filter(p => {
    // v1.7.18：与 chip「未提交 N」同一口径 —— 失效项目不算未提交（否则 chip 写 3、点进去列 5 行，又一屏内自相矛盾）
    if (filterType === '未提交') { if (!(p.isGit && p.dirty > 0) || PROJ_DEAD.has(p.path)) return false; }
    else if (filterType !== '全部' && p.type !== filterType) return false;
    return hitSet.has(p);
  });
  list.sort((a, b) => {
    // v1.7.37：失效分层优先于收藏 —— 此前收藏判断在前，导致已删除项目（PROJ_DEAD）
    //   被收藏后仍置顶第一位、挤掉真实项目，而失效行置灰后星标不显示、用户不知为何。
    //   新序：存活收藏 > 存活 > 失效收藏 > 失效（失效项仍在失效区沉底，收藏语义在层内保留）。
    const da = PROJ_DEAD.has(a.path) ? 1 : 0, db = PROJ_DEAD.has(b.path) ? 1 : 0;
    if (da !== db) return da - db;
    const fa = isFav(a.path) ? 1 : 0, fb = isFav(b.path) ? 1 : 0;
    if (fa !== fb) return fb - fa; // 层内收藏优先（存活层收藏置顶 / 失效层收藏排在失效项顶部）
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
    if (sortBy === 'size') return (b.sizeMB || 0) - (a.sizeMB || 0);
    if (sortBy === 'commit') return (b.lastCommitTime || '').localeCompare(a.lastCommitTime || '');
    return (b.rootMTime || '').localeCompare(a.rootMTime || '');
  });
  const gitN = list.filter(p => p.isGit).length;
  // v1.7.18：剔除失效项目 —— 屏上真正带「未提交 ●N」标记的只有存活行（prow 里 `!dead && isGit && dirty>0`）
  const dirtyN = list.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).length;
  const favN = list.filter(p => isFav(p.path)).length;
  const deadN = list.filter(p => PROJ_DEAD.has(p.path)).length;
  const sizeSum = list.reduce((s, p) => s + (p.sizeMB || 0), 0);
  $('#proj-list').innerHTML =
    '<div class="stats" style="margin-bottom:8px">' + list.length + ' 项 · git ' + gitN + ' · 未提交 ' + dirtyN + ' · ★ 收藏 ' + favN +
    (deadN ? ' · <span class="deadstat">已删除 ' + deadN + '（已沉底）</span>' : '') +
    ' · 体量 ' + fmtMB(sizeSum) + '</div>' +
    (list.map(prow).join('') || '<div class="empty">无匹配项目</div>');
}
function prow(p) {
  const hue = hueOf(p.name);
  const fav = isFav(p.path);
  // v1.7.15：失效项目（磁盘上已不存在）——
  //   ① 「类型徽标」那一格换成「已删除」角标（复用 v1.7.13 的 .deadtag 视觉语言）⇒ 网格列数不变、零布局位移；
  //   ② 不再显示「未提交 ●N」与琥珀条 —— 失效项目的分支/提交/未提交/体量全是**过期快照**，
  //      目录都没了还标「未提交 1 个」等于陈述一个不成立的事实。
  const dead = PROJ_DEAD.has(p.path);
  const dirty = !dead && p.isGit && p.dirty > 0;
  const sub = dead
    ? '<span class="deadhint">该路径已不存在（可能已被删除或移动）</span>'
    : (p.isGit
      ? '<b>' + esc(p.branch) + '</b>' + (p.dirty ? ' <span class="dmark">●' + p.dirty + '</span>' : '') +
        ' · ' + esc((p.lastCommitSubject || '').slice(0, 70)) + ' · ' + relTime(p.lastCommitTime) + '前'
      : '非 git 目录 · 修改于 ' + relTime(p.rootMTime) + '前');
  const starTip = fav ? '取消收藏' : '收藏并置顶';
  const typeCell = dead
    ? '<span class="deadtag" title="该路径在磁盘上已不存在（可能已被删除或移动）">已删除</span>'
    : '<span class="badge ' + esc(p.type) + '">' + esc(p.type) + '</span>';
  return '<div class="prow' + (dirty ? ' has-dirty' : '') + (fav ? ' is-fav' : '') + (dead ? ' is-dead' : '') + '">' +
    '<div class="avatar" style="' + avatarStyle(hue) + '">' + esc(p.name.slice(0, 1).toUpperCase()) + '</div>' +
    '<div class="p-main" style="min-width:0">' +
    '<div class="p-line"><button class="fav-btn' + (fav ? ' on' : '') + '" data-act="fav" data-p="' + esc(p.path) + '" title="' + esc(starTip) + '" aria-label="' + esc(starTip) + '">' + (fav ? '★' : '☆') + '</button>' +
    '<span class="nm" data-act="open" data-p="' + esc(p.path) + '" title="' + esc(p.path) + '">' + esc(p.name) + '</span>' +
    typeCell + '</div>' +
    '<div class="p-sub">' + sub + '</div></div>' +
    '<div class="p-size"><div class="v">' + (dead ? '—' : fmtMB(p.sizeMB)) + '</div><div class="u">' + (dead ? '已失效' : (p.fileCount ? p.fileCount.toLocaleString() + ' 文件' : '—')) + '</div></div>' +
    '<div class="p-actions">' +
    '<button class="ibtn" data-act="open" data-p="' + esc(p.path) + '" title="资源管理器打开">📂</button>' +
    (CAPS.vscode ? '<button class="ibtn" data-act="vscode" data-p="' + esc(p.path) + '" title="用 VS Code 打开">💻</button>' : '') +
    '<button class="ibtn" data-act="term" data-p="' + esc(p.path) + '" title="在终端打开">⌨️</button>' +
    (p.isGit ? '<button class="ibtn" data-act="detail" data-p="' + esc(p.path) + '" title="项目详情">🌿</button>' : '') +
    '<button class="ibtn" data-act="copy" data-p="' + esc(p.path) + '" title="复制路径">📋</button>' +
    '</div></div>';
}

/* ---------- 最近 ---------- */

/* v1.7.12：最近视图补搜索框（原先 60 条记录只能肉眼扫，而项目视图有搜索 —— 同应用内交互不一致）。
   与项目视图同款做法：搜索框放在 #view 里、结果列表放子容器 #recent-list，
   过滤时只重绘子容器 ⇒ 输入框不会被 innerHTML 重建而失焦。 */
function renderRecent() {
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>最近动态<span class="sub">桌面 / 文档 / 下载 / D:\\code / E:\\workspace 限深扫描 Top 60</span></h2>' +
    '<div class="toolbar"><input id="rq" type="search" placeholder="搜索文件名 / 目录 / 类型…（空格分词）" value="' + esc(rq) + '"></div>' +
    '<div id="recent-list"></div></div>';
  renderRecentList();
}
function recentHits(query) {
  const all = DATA.recent || [];
  const tokens = searchTokens(query);
  if (!tokens.length) return all;
  return all.filter(r => {
    const nm = String(r.name || ''), dir = String(r.dir || ''), path = String(r.path || '');
    const ext = (nm.split('.').pop() || '').toLowerCase();
    const fields = [nm.toLowerCase(), dir.toLowerCase(), path.toLowerCase(), ext];
    const pyFields = [pyInitials(fields[0]), pyInitials(fields[2])];
    return matchFields(fields, pyFields, query) >= 0;
  });
}
function renderRecentList() {
  const all = DATA.recent || [];
  const list = recentHits(rq);
  // v1.7.16：失效条目沉底（活条目在前、失效条目在后，各自保持原序）
  const parts = partitionDead(list, RECENT_DEAD);
  const deadN = parts.dead.length;
  const note = (rq ? ('匹配 ' + list.length + ' / ' + all.length + ' 条') : (all.length + ' 条')) +
    (deadN ? ' · <span class="deadstat">已删除 ' + deadN + '（已沉底）</span>' : '');
  const sep = deadN ? '<div class="deadsep">以下 ' + deadN + ' 条已从磁盘删除（已沉底 · 不再位于首屏）</div>' : '';
  const body = parts.live.map(recentRow).join('') + sep + parts.dead.map(recentRow).join('');
  $('#recent-list').innerHTML =
    '<div class="stats" style="margin-bottom:8px">' + note + '</div>' +
    '<div class="rlist">' + (body || '<div class="empty">' + (rq ? '无匹配文件' : '无记录') + '</div>') + '</div>';
}

/* ---------- 空间分析 ---------- */

function renderDisk() {
  const quick = (DATA.drives || []).map(d => d.root).concat(['D:\\code', 'D:\\TclLauncher', 'D:\\CLAUNCER2']);
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>空间分析<span class="sub">统计子项完整大小找空间大头 · 含 node_modules 等全部内容 · 点击目录下钻</span></h2>' +
    '<div class="toolbar"><input id="an-path" style="width:430px" placeholder="输入要分析的目录，如 D:\\code" value="' + esc(lastAnalysis ? lastAnalysis.root : 'D:\\code') + '">' +
    '<button class="btn" data-act="analyze">📊 分析</button>' +
    '<button class="btn ghost" data-act="reforce">↻ 强制重算</button></div>' +
    '<div class="chips" style="margin-bottom:12px">' + quick.map(p => '<button class="chipbtn link" data-act="drill" data-p="' + esc(p) + '">' + esc(p) + '</button>').join('') + '</div>' +
    '<div id="anprogress"></div><div id="an-result">' + (lastAnalysis ? analysisTable(lastAnalysis) : '<div class="empty">选择目录后点击「分析」</div>') + '</div></div>';
}
function startAnalyze(force) {
  const p = $('#an-path').value.trim();
  if (!p) { toast('请输入目录', 'err'); return; }
  window.wb.analyze(p, !!force).then(r => { if (!r.started) toast(r.reason, 'err'); });
  $('#anprogress').innerHTML = '<div class="chips"><span class="chip"><b>' + (force ? '强制重算中' : '分析中') + '</b> ' + esc(p) + ' …（大目录需要一点时间）</span></div>';
}
function analysisTable(res) {
  const top = res.items.slice(0, 50);
  const total = res.totalSize || 1;
  const cachedNote = res.cached
    ? '<div class="chips" style="margin:4px 0 8px"><span class="chip">来自缓存（' + cacheAge(res.cachedAt) + '）</span>' +
      '<button class="chipbtn link" data-act="reforce" data-p="' + esc(res.root) + '">↻ 强制重算</button></div>'
    : '';
  return cachedNote + '<div style="margin:4px 0 8px" class="small muted">共 ' + res.items.length + ' 项 · 总计 <b style="color:var(--text)">' + fmtBytes(total) + '</b> · 显示前 ' + top.length + ' 大</div>' +
    '<div class="an-row head"><span>名称</span><span>占比</span><span class="num">大小</span><span class="num">文件数</span><span style="text-align:right">操作</span></div>' +
    top.map(it => {
      const pct = total ? (it.size / total * 100) : 0;
      const color = pct > 50 ? 'var(--red)' : pct > 25 ? 'var(--amber)' : 'url(#agrad)';
      return '<div class="an-row">' +
        '<span class="nm" data-act="' + (it.isDir ? 'drill' : 'open') + '" data-p="' + esc(it.path) + '" title="' + esc(it.path) + '">' + (it.isDir ? '📁 ' : '📄 ') + esc(it.name) + (it.reparse ? ' 🔗' : '') + '</span>' +
        '<span class="bar" style="height:7px;background:var(--bar-track);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;border-radius:4px;width:' + Math.min(pct, 100).toFixed(1) + '%;background:' + color + '"></i></span>' +
        '<span class="num" style="color:var(--text)">' + fmtBytes(it.size) + '</span>' +
        '<span class="num">' + (it.files || '—') + '</span>' +
        '<span class="p-actions" style="opacity:1"><button class="ibtn" data-act="open" data-p="' + esc(it.path) + '">📂</button><button class="ibtn" data-act="copy" data-p="' + esc(it.path) + '">📋</button></span>' +
        '</div>';
    }).join('') +
    '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="agrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#4d9fff"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs></svg>';
}

/* ---------- 系统 ---------- */

function renderSystem() {
  const m = DATA.meta;
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>扫描历史趋势<span class="sub">共 ' + HISTORY.length + ' 次扫描快照 · 展示未提交文件总量与项目数变化</span></h2>' +
    historyTrendHtml() +
    '<h2>开发工具链</h2><table class="sys"><tr><th style="width:90px">工具</th><th style="width:320px">版本</th><th>路径</th></tr>' +
    (DATA.tools || []).map(t => '<tr><td><b>' + esc(t.name) + '</b></td><td>' + esc(t.version) + '</td><td class="muted small mono">' + esc(t.path) + '</td></tr>').join('') + '</table>' +
    '<h2>AI CLI / Agent 配置<span class="sub">发现 ' + (DATA.aiTools || []).length + ' 个</span></h2><div class="chips">' +
    (DATA.aiTools || []).map(a => '<span class="chip">' + esc(a) + '</span>').join('') + '</div>' +
    '<h2>常用文件夹</h2><div class="three-col">' + ufCards() + '</div>' +
    '<h2>系统信息</h2><table class="sys">' +
    '<tr><th style="width:150px">主机</th><td>' + esc(m.host) + '</td></tr>' +
    '<tr><th>用户</th><td>' + esc(m.user) + '</td></tr>' +
    '<tr><th>系统</th><td>' + esc(m.os) + ' (' + esc(m.arch) + ')</td></tr>' +
    '<tr><th>CPU</th><td>' + esc(m.cpu) + '</td></tr>' +
    '<tr><th>内存</th><td>' + m.ramTotalGB + ' GB（空闲 ' + m.ramFreeGB + ' GB）</td></tr>' +
    '<tr><th>上次开机</th><td>' + esc(m.bootTime) + '</td></tr>' +
    '<tr><th>VS Code CLI</th><td>' + (CAPS.vscode ? '✔ 可用' : '✘ 未找到') + '</td></tr>' +
    '<tr><th>Windows Terminal</th><td>' + (CAPS.wt ? '✔ 可用' : '✘ 未找到（回退 cmd）') + '</td></tr>' +
    '</table>' +
    '<div class="hint">工作台 <b>v' + esc(VERSION || '?') + '</b> · Electron 桌面版 · 数据仅存本机 · powered by dsh</div></div>';
  requestAnimationFrame(drawTrend);
}

/* 扫描历史趋势：画布折线 + 最近 10 次快照表 */
/* v1.7.19：history.json 快照格式演进 —— 旧快照按「项目名」为键、值 {dirty,sizeMB,commitTime}；
   新快照按「绝对路径」为键、值 {name,dirty,sizeMB,commitTime}。同一 history.json 里两种可共存（混合快照）。
   normHistoryProjects 把任一快照的 projects 统一成 normalizedKey -> {path,name,dirty,sizeMB,commitTime}：
     · 键含 \ 或 / ⇒ 视为路径键：path=键，name=值.name 或路径末段；
     · 否则视为旧名称键：path=值.path 或空，name=值.name 或键本身；
     · normalizedKey 优先用 path，无 path 才用 'name:'+name ⇒ 同名不同路径不会互相覆盖。
   纯函数，畸形条目逐个跳过、绝不抛异常，无历史迁移。 */
function normHistoryProjects(h) {
  const out = {};
  const projects = (h && h.projects) || {};
  let keys = [];
  try { keys = Object.keys(projects); } catch (_e) { keys = []; }
  keys.forEach(k => {
    try {
      const key = String(k);
      const v = projects[k] || {};
      const pathLike = /[\\/]/.test(key);
      const path = pathLike ? key : (v.path ? String(v.path) : '');
      const name = v.name ? String(v.name) : (pathLike ? path.split(/[\\/]/).pop() : key);
      const normalizedKey = path || ('name:' + name);
      out[normalizedKey] = { path: path, name: name, dirty: v.dirty || 0, sizeMB: v.sizeMB || 0, commitTime: v.commitTime || '' };
    } catch (_e) { /* 单块坏数据不影响其余条目：跳过即可 */ }
  });
  return out;
}

/* v1.7.19：快照数组 -> 趋势/QA 共用统计（纯函数）。n=归一化后项目数，dirty=未提交文件数总和。
   v1.7.29：新增 legacy —— 原始快照的项目键若全部为「名称键」（不含 \ 或 /）则为旧格式，
   其 n/dirty 按名去重、可能低于真实值；仅作标注，不改动 n/dirty/totalMB 的计算。 */
function historyStatsFor(hist) {
  return (hist || []).map(h => {
    const norm = normHistoryProjects(h);
    const keys = Object.keys(norm);
    let dirty = 0;
    keys.forEach(k => { dirty += (norm[k].dirty || 0); });
    // 用「原始」快照的 projects 键判定，不能用归一化后的 keys（会把名称键变成 'name:' 前缀）
    let origKeys = [];
    try { origKeys = Object.keys((h && h.projects) || {}); } catch (_e) { origKeys = []; }
    const legacy = origKeys.length > 0 && origKeys.every(k => !/[\\/]/.test(k));
    return { time: (h && h.time) || '', fast: !!(h && h.fast), n: keys.length, dirty, totalMB: (h && h.totalMB) || 0, legacy };
  });
}
function historyStats() {
  return historyStatsFor(HISTORY);
}

/* v1.7.19：前后两次快照的项目差异 -> 简报 push 参数数组（最多 2 条，纯函数）。
   命中项目只要带 path 就只走 byPath 精确匹配，绝不回退 byName（同名项目会错指）。
   v1.7.23：修复 name-key→path-key 过渡期的匹配断裂 —— 归一化条目先按「身份」键化再匹配，
   令旧名称键快照能桥接到当前同路径项目；零/多个同名绝不猜归属，保留 'name:' 键。 */
function historyDiffItems(hist, projects) {
  const out = [];
  const arr = hist || [];
  if (arr.length < 2) return out;
  const prev = normHistoryProjects(arr[arr.length - 2]);
  const cur = normHistoryProjects(arr[arr.length - 1]);
  const list = projects || [];
  const byPath = p => list.find(x => x && x.path === p);
  const byName = n => list.find(x => x && x.name === n);
  // 纯函数身份解析器：有 path 直接用 path；旧名称键桥接到「唯一同名且带路径」的当前项目；
  // 零个或多个同名（如 4 个 TclLauncher）退回 'name:'+name，绝不把变更错指到某个同名项目。
  const identityOf = e => {
    if (!e) return '';
    if (e.path) return e.path;
    const sameName = list.filter(p => p && p.name === e.name && p.path);
    if (sameName.length === 1) return sameName[0].path;
    return 'name:' + e.name;
  };
  const mapById = norm => {
    const m = {};
    Object.values(norm).forEach(e => {
      const id = identityOf(e);
      if (id) m[id] = e;
    });
    return m;
  };
  const prevById = mapById(prev);
  const curById = mapById(cur);
  let diffN = 0;
  Object.keys(curById).forEach(key => {
    if (diffN >= 2) return;
    const pp = prevById[key];
    if (!pp) return;
    const cc = curById[key];
    // 身份为 path（含桥接补出的 path）走 byPath；仅遗留 'name:' 身份保留旧 byName 回退。
    const hit = key.indexOf('name:') === 0 ? byName(cc.name) : byPath(key);
    const hAct = hit ? 'detail' : 'goto';
    const hP = hit ? hit.path : 'projects';
    const hTip = hit ? '查看「' + cc.name + '」项目详情' : '切到「项目」视图';
    // v1.7.17：比上一次的提交时间 pp.commitTime（同维度）；!pp.commitTime 覆盖「上次还没有提交」。
    if (cc.commitTime && (!pp.commitTime || cc.commitTime > pp.commitTime)) {
      out.push({ color: 'var(--acc)', html: '与上次扫描相比，「<b>' + esc(cc.name) + '</b>」有新提交',
        text: '与上次扫描相比，「' + cc.name + '」有新提交', act: hAct, p: hP, tip: hTip }); diffN++;
    } else if (cc.dirty > pp.dirty) {
      out.push({ color: 'var(--amber)', html: '与上次扫描相比，「<b>' + esc(cc.name) + '</b>」未提交 +' + (cc.dirty - pp.dirty),
        text: '与上次扫描相比，「' + cc.name + '」未提交 +' + (cc.dirty - pp.dirty), act: hAct, p: hP, tip: hTip }); diffN++;
    }
  });
  return out;
}
/* v1.7.29：旧格式（按项目名存储）快照提示文案 —— 角标 / 说明 / QA 共用常量，避免文案漂移 */
const HIST_LEGACY_BADGE = '旧格式·名称去重';
const HIST_LEGACY_NOTE = '⚠ 旧格式快照（按项目名存储）的项目数/未提交数可能低于真实值，仅供趋势参考；体量为全量统计。';
function historyTrendHtml() {
  const st = historyStats();
  if (st.length < 2) {
    return '<div class="empty">趋势图需要至少 2 次扫描快照（当前 ' + st.length + ' 次）。<br>' +
      '<span class="muted small">按 F5 全量重扫后，这里会开始画出你的工作节奏。</span></div>';
  }
  const last10 = st.slice(-10).reverse();
  // v1.7.29：只有最近 10 行里出现旧格式快照时才给一条持久说明；列值一律不重算
  const noteHtml = last10.some(s => s.legacy)
    ? '<div class="hint" style="margin:0 0 9px">' + HIST_LEGACY_NOTE + '</div>'
    : '';
  return '<div class="card" style="margin-bottom:13px"><canvas id="trend-cv" style="width:100%;height:120px;display:block"></canvas>' +
    '<div class="chips" style="margin-top:9px">' +
    '<span class="chip"><span class="live-dot" style="background:var(--acc)"></span>未提交文件总量</span>' +
    '<span class="chip"><span class="live-dot" style="background:var(--acc2)"></span>收录项目数</span></div>' +
    noteHtml + '</div>' +
    '<table class="sys"><tr><th>时间</th><th>项目数</th><th>未提交文件</th><th>源码总体量</th><th>模式</th></tr>' +
    last10.map(s => '<tr><td>' + esc(s.time) + (s.legacy ? ' <span class="muted small">' + HIST_LEGACY_BADGE + '</span>' : '') + '</td><td>' + s.n + '</td><td>' + (s.dirty ? '<b style="color:var(--amber)">' + s.dirty + '</b>' : '0') + '</td>' +
      '<td>' + fmtMB(s.totalMB) + '</td><td>' + (s.fast ? '快速' : '全量') + '</td></tr>').join('') + '</table>';
}
function drawTrend() {
  const cv = document.getElementById('trend-cv');
  if (!cv || !cv.clientWidth) return;
  const st = historyStats();
  if (st.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = cssVar('--canvas-grid', 'rgba(255,255,255,.05)');
  [25, 50, 75].forEach(p => { const y = h * p / 100; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
  function line(key, color, fill) {
    const vals = st.map(s => s[key]);
    const max = Math.max(1, ...vals);
    const stepX = w / (st.length - 1);
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = i * stepX, y = h - (v / max) * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
    if (fill) {
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    }
    // 数据点
    vals.forEach((v, i) => {
      const x = i * stepX, y = h - (v / max) * (h - 10) - 5;
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    });
  }
  line('n', cssVar('--acc2', '#a78bfa'), null);
  line('dirty', cssVar('--acc', '#4d9fff'), cssVar('--canvas-fill2', 'rgba(77,159,255,.12)'));
}
function ufCards() {
  const names = { Desktop: '桌面', Documents: '文档', Downloads: '下载' };
  return Object.keys(names).map(k => {
    const uf = (DATA.userFolders || {})[k];
    if (!uf) return '';
    return '<div class="ucard"><h3>' + names[k] + ' <span>' + uf.count + ' 项（前 ' + (uf.items || []).length + '）</span></h3>' +
      (uf.items || []).map(it =>
        '<div class="uitem"><span class="n" data-act="open" data-p="' + esc(it.path) + '" title="' + esc(it.path) + '">' + (it.isDir ? '📁 ' : '📄 ') + esc(it.name) + '</span>' +
        '<span class="m">' + (it.isDir ? '' : fmtSizeKB(it.sizeKB)) + ' · ' + esc(it.mtime) + '</span></div>').join('') +
      '</div>';
  }).join('');
}

/* ---------- 设置 ---------- */

/* 清空持久化的扫描/分析错误诊断（真实 IPC → store.clearScanErrors → 局部刷新） */
async function clearScanErrors() {
  try {
    const arr = await window.wb.scanErrorsClear();
    SCAN_ERRORS = Array.isArray(arr) ? arr : [];
    const el = document.getElementById('scan-errors');
    if (el) el.innerHTML = scanErrorsHtml();
    toast('错误日志已清空', 'ok');
  } catch (e) {
    toast('清空失败：' + String((e && e.message) || e), 'err');
  }
}

/* 错误诊断列表：全部动态文本 esc()，按钮走 data-act 事件委托、无内联 onclick */
function scanErrorsHtml() {
  if (!SCAN_ERRORS || !SCAN_ERRORS.length) {
    return '<div class="err-empty">✔ 暂无错误记录 —— 扫描或空间分析失败时，原因会自动保存到这里（不再只有一闪而过的提示），重启后仍可查看。</div>';
  }
  const rows = SCAN_ERRORS.slice().reverse().map(e =>
    '<div class="err-item">' +
    '<span class="err-t">' + esc(e.time) + '</span>' +
    '<span class="err-k">' + esc(e.kind) + '</span>' +
    '<span class="err-m">' + esc(e.message) + '</span>' +
    '</div>').join('');
  return '<div class="err-head"><span class="muted small">共 ' + SCAN_ERRORS.length + ' 条 · 最多保留 50 条</span>' +
    '<button class="btn ghost" data-act="clearScanErrors">🧹 清空错误日志</button></div>' +
    '<div class="err-list">' + rows + '</div>';
}

/* v1.7.10：自动扫描到期检查的常驻展示（设置页）——「自动扫描在不在管事」要看得见，
   否则用户只能靠翻日志判断；同时区分「已过期→已自动刷新」与「未过期→暂不刷新」两种判定。 */
function autoCheckHtml() {
  const hours = Number(SETTINGS && SETTINGS.autoScanHours) || 0;
  if (!(hours > 0)) return '<span class="muted small">自动扫描已关闭，不会执行到期检查（开启间隔后生效）。</span>';
  if (!AUTO_CHECK) return '<span class="muted small">尚未执行到期检查（启动即检或 15 分钟定时检查触发后在此显示）。</span>';
  const a = AUTO_CHECK;
  const age = a.ageMs == null ? '无缓存' : (Math.round(a.ageMs / 60000) + ' 分钟前');
  const t = a.at ? new Date(a.at).toTimeString().slice(0, 8) : '—';
  return '<span class="muted small">上次检查：' + esc(t) + '（' + esc(a.reason) + '）· 数据 ' + esc(age) +
    ' · 间隔 ' + esc(String(a.intervalHours)) + ' 小时 · ' +
    (a.due ? '<b>已过期，已自动刷新</b>' : '未过期，暂不刷新') + '</span>';
}

function renderSettings() {
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>行为</h2>' +
    '<label class="ckrow"><input type="checkbox" id="ck-tray"' + (SETTINGS.trayMinimize ? ' checked' : '') + '> 关闭按钮最小化到托盘</label>' +
    '<label class="ckrow"><input type="checkbox" id="ck-login"' + (LOGINITEM ? ' checked' : '') + '> 开机自动启动工作台</label>' +
    '<h2>外观<span class="sub">切换即时生效，并跨重启保留</span></h2>' +
    '<div class="field"><label>主题</label><div class="theme-pick">' +
    '<button class="chipbtn' + (themeIsLight() ? '' : ' on') + '" data-act="theme:set" data-p="dark">🌙 深色</button>' +
    '<button class="chipbtn' + (themeIsLight() ? ' on' : '') + '" data-act="theme:set" data-p="light">☀️ 浅色</button>' +
    '</div><div class="hint">浅色主题对六个视图（总览 / 项目 / 最近 / 空间 / 系统 / 设置）整体换肤，含标题栏、侧栏、卡片、弹窗、命令面板与图表。</div></div>' +
    '<h2>扫描设置</h2>' +
    '<div class="field"><label>额外项目根目录（每行一个路径，会纳入项目雷达）</label>' +
    '<textarea id="extra-roots" placeholder="D:\\some\\project">' + esc((SETTINGS.extraRoots || []).join('\n')) + '</textarea></div>' +
    '<div class="field"><label>自动扫描间隔（应用运行期间按间隔自动刷新项目数据）</label>' +
    '<select id="autoscan-hours">' +
    // 选项表里的值之外（如 24 小时）也要能正确回显 —— 此前下拉无匹配项时会回落显示「关闭」，
    // 与实际生效的间隔不符（用户以为自动扫描关着，其实开着）。v1.7.10 巡检发现并修复。
    (function () {
      const cur = Number(SETTINGS.autoScanHours) || 0;
      const base = [[0, '关闭'], [1, '每 1 小时'], [3, '每 3 小时'], [6, '每 6 小时'], [12, '每 12 小时']];
      const opts = base.slice();
      if (cur > 0 && !base.some(o => o[0] === cur)) opts.push([cur, '每 ' + cur + ' 小时']);
      return opts.map(o =>
        '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    })() +
    '</select>' +
    '<div id="auto-check" class="hint">' + autoCheckHtml() + '</div></div>' +
    '<div class="btnrow">' +
    '<button class="btn" data-act="saveSettings">💾 保存设置</button>' +
    '<button class="btn ghost" data-act="scan">🔄 全量重扫</button>' +
    '<button class="btn ghost" data-act="scan" data-fast="1">⚡ 快速重扫（跳过体量）</button>' +
    '</div>' +
    '<h2>扫描错误诊断<span class="sub">扫描 / 空间分析失败原因持久保存，重启后仍可查看</span></h2>' +
    '<div id="scan-errors">' + scanErrorsHtml() + '</div>' +
    '<div class="field" style="margin-top:16px"><label>扫描日志（本次运行）</label><div id="scan-log"></div></div>' +
    '<h2>说明</h2><div class="muted small" style="line-height:2.1">' +
    '· 体量统计排除 node_modules / build / .gradle / .git 等构建产物，代表「源码体量」。<br>' +
    '· 未提交改动数只统计已跟踪文件（git status -uno），不含新增未跟踪文件。<br>' +
    '· 机器脉搏 1s 采样，窗口最小化或切后台自动暂停，不占资源。<br>' +
    '· 今日简报基于扫描快照 + 历史对比（保留最近 60 次）规则生成，纯本地无 AI。<br>' +
    '· 全量重扫约 4 分钟；日常看板读缓存秒开。<br>' +
    '· 自动扫描在应用运行（含托盘）期间按间隔刷新数据，完成后托盘气泡提醒。<br>' +
    '· 应用启动时会立即做一次到期检查：缓存超过设定间隔即自动刷新，不必等满 15 分钟（判定结果见上方）。<br>' +
    '· 所有操作均为只读，不会修改任何项目文件。· powered by dsh</div></div>';
}
async function saveSettings() {
  const roots = $('#extra-roots').value.split('\n').map(s => s.trim()).filter(Boolean);
  const autoScanHours = Number($('#autoscan-hours').value) || 0;
  const patch = { extraRoots: roots, trayMinimize: $('#ck-tray').checked, autoScanHours };
  const res = await window.wb.saveSettings(patch);
  // settings:set 自 v1.7.2 起返回合并后的 settings 对象；历史版本返回布尔 true。
  // 绝不能把返回值整体赋给 SETTINGS（严格模式给布尔赋属性抛 TypeError，且会清空 favorites / winBounds）。
  // 拿到对象就用它同步磁盘态；否则退回「保留现有对象 + 合并本页改动」，两种方式都不会再抛错。
  SETTINGS = (res && typeof res === 'object') ? res : Object.assign({}, SETTINGS, patch);
  SETTINGS.autoScanHours = Number(SETTINGS.autoScanHours) || 0;
  if (window.wb.loginItemSet) await window.wb.loginItemSet($('#ck-login').checked);
  toast('设置已保存，额外目录重扫后生效', 'ok');
}

/* ---------- 项目详情弹窗 ---------- */

function openModal(html) {
  $('#modal-box').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); currentDetail = null; }

/* ---------- 项目对比（v1.7.36）----------
   两个 git 项目并排对比：分支 / 未提交 / 提交 / 体量 / 文件数。
   零新增 IPC（复用 project:detail），弹窗内按钮复用 #modal 的 data-act 委托（bindDelegation 已覆盖，勿重复绑定）。
   compareRows / compareHtml 为纯函数（无 DOM 写入、无 IPC、无文件操作），供 runCompare 与 --compareqa 共用。 */
function compareRows(pa, pb, da, db) {
  pa = pa || {}; pb = pb || {}; da = da || {}; db = db || {};
  const ga = da.git || {}, gb = db.git || {};
  const val = (v, fb) => (v == null || v === '' ? fb : v);
  const s = v => (v == null || v === '' ? '—' : String(v));
  const branchA = s(val(ga.branch, pa.branch)), branchB = s(val(gb.branch, pb.branch));
  // 详情 git.dirty 是数量；缺失时回退 dirtyFiles.length，再回退项目快照的 dirty
  const dirtyA = ga.dirty != null ? ga.dirty : (ga.dirtyFiles ? ga.dirtyFiles.length : pa.dirty);
  const dirtyB = gb.dirty != null ? gb.dirty : (gb.dirtyFiles ? gb.dirtyFiles.length : pb.dirty);
  const timeA = val(ga.commitTime, pa.lastCommitTime), timeB = val(gb.commitTime, pb.lastCommitTime);
  const relA = timeA ? relTime(timeA) : '—', relB = timeB ? relTime(timeB) : '—';
  const subjA = s(val(ga.log && ga.log[0] && ga.log[0].subject, pa.lastCommitSubject));
  const subjB = s(val(gb.log && gb.log[0] && gb.log[0].subject, pb.lastCommitSubject));
  const sizeA = pa.sizeMB ? fmtMB(pa.sizeMB) : '—', sizeB = pb.sizeMB ? fmtMB(pb.sizeMB) : '—';
  const cntA = pa.fileCount ? Number(pa.fileCount).toLocaleString() : '—';
  const cntB = pb.fileCount ? Number(pb.fileCount).toLocaleString() : '—';
  const mk = (label, va, vb) => {
    const a = s(va), b = s(vb);
    return { label: label, va: a, vb: b, diff: a !== b }; // 基于原始值比较，展示时再 esc()
  };
  return [
    mk('项目名', pa.name, pb.name),
    mk('路径', pa.path, pb.path),
    mk('类型', pa.type, pb.type),
    mk('分支', branchA, branchB),
    mk('未提交文件数', dirtyA, dirtyB),
    mk('最近提交时间', relA, relB),
    mk('提交主题', subjA, subjB),
    mk('体量', sizeA, sizeB),
    mk('文件数', cntA, cntB)
  ];
}

function compareHtml(rows) {
  // 差异单元格带 cmp-diff 类；因仅允许改 app.js，视觉高亮用内联样式落地（等价的细琥珀底）
  const cell = (v, diff) => '<td class="' + (diff ? 'cmp-diff' : '') + '"' +
    (diff ? ' style="background:rgba(255,184,36,.16);color:var(--amber);font-weight:600"' : '') +
    '>' + esc(v) + '</td>';
  return '<div class="cmp-wrap" style="overflow:auto">' +
    '<table class="cmp-table" style="width:100%;border-collapse:collapse;line-height:1.7">' +
    '<thead><tr style="border-bottom:1px solid var(--line2)">' +
    '<th style="text-align:left;padding:5px 8px">对比项</th>' +
    '<th style="text-align:left;padding:5px 8px">项目 A</th>' +
    '<th style="text-align:left;padding:5px 8px">项目 B</th>' +
    '</tr></thead><tbody>' +
    (rows || []).map(r => '<tr style="border-top:1px solid var(--line2)">' +
      '<td class="muted" style="padding:5px 8px;white-space:nowrap">' + esc(r.label) + '</td>' +
      cell(r.va, r.diff) + cell(r.vb, r.diff) + '</tr>').join('') +
    '</tbody></table></div>';
}

async function openCompare() {
  const projects = ((DATA && DATA.projects) || []).filter(p => p && p.isGit);
  const opts = projects.map(p =>
    '<option value="' + esc(p.path) + '">' + esc(p.name) + ' — ' + esc(shortPath(p.path)) + '</option>').join('');
  const few = projects.length < 2
    ? '<div class="hint" style="color:var(--amber)">可对比的 git 项目不足 2 个（当前 ' + projects.length + ' 个），请先扫描更多 git 项目。</div>'
    : '';
  const picker = (id) => '<select id="' + id + '"' + (projects.length < 2 ? ' disabled' : '') + '>' + opts + '</select>';
  openModal(
    '<button class="close" data-act="closeModal">✕</button>' +
    '<div class="m-head"><h3>⚖ 项目对比</h3></div>' +
    few +
    '<div class="small muted" style="margin:8px 0">选择两个 git 项目，并排对比分支 / 未提交 / 提交 / 体量等信息。</div>' +
    '<div class="cmp-picker" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0">' +
    picker('cmp-a') + '<span class="muted">vs</span>' + picker('cmp-b') +
    '<button class="btool" data-act="compare:run"' + (projects.length < 2 ? ' disabled' : '') + '>对比</button>' +
    '</div>' +
    '<div id="cmp-result"></div>'
  );
  const a = $('#cmp-a'), b = $('#cmp-b');
  if (a && projects[0]) a.value = projects[0].path; // 默认 A=第一个
  if (b && projects[1]) b.value = projects[1].path; // 默认 B=第二个
}

async function runCompare() {
  const res = $('#cmp-result');
  if (!res) return;
  const ea = $('#cmp-a'), eb = $('#cmp-b');
  const a = ea ? ea.value : '', b = eb ? eb.value : '';
  if (!a || !b || a === b) {
    res.innerHTML = '<div class="hint" style="color:var(--amber)">请选择两个不同的 git 项目后再对比。</div>';
    return;
  }
  res.innerHTML = '<div class="hint">对比中…</div>';
  // 每个请求单独 try/catch：一个项目详情失败不会拖垮另一个
  const safeDetail = (p) => (async () => {
    try { return await window.wb.projectDetail(p); }
    catch (e) { return { __error: String((e && e.message) || e) }; }
  })();
  const [da, db] = await Promise.all([safeDetail(a), safeDetail(b)]);
  const plist = (DATA && DATA.projects) || [];
  const pa = plist.find(x => x && x.path === a) || { name: shortPath(a), path: a };
  const pb = plist.find(x => x && x.path === b) || { name: shortPath(b), path: b };
  const rows = compareRows(pa, pb, da, db);
  const errNote = (da && da.__error) || (db && db.__error)
    ? '<div class="small muted" style="margin-bottom:6px;color:var(--amber)">部分项目详情读取失败，缺失项已用快照数据 / — 兜底。</div>'
    : '';
  res.innerHTML = errNote + compareHtml(rows);
}

function dirsUp() {
  if (!currentDetail || currentDetail.stack.length <= 1) return;
  currentDetail.stack.pop();
  currentDetail.loadDirs(false);
}

function mdInline(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

/* 轻量 Markdown 渲染：全文先 esc，再抽离 ``` 代码块为占位符，逐行转标题/列表/段落，最后回填代码块 */
function miniMd(src) {
  const blocks = [];
  const t = esc(src == null ? '' : src).replace(/```[^\n]*\n?([\s\S]*?)```/g, (m, code) => {
    blocks.push(code.replace(/\n+$/, ''));
    return '@@MD' + (blocks.length - 1) + '@@';
  });
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  t.split('\n').forEach(line => {
    const l = line.trim();
    if (/^@@MD\d+@@$/.test(l)) { closeList(); out.push(l); return; }
    if (!l) { closeList(); return; }
    const h = l.match(/^(#{1,3})\s+(.+)$/);
    if (h) { closeList(); out.push('<div class="mdh' + h[1].length + '">' + mdInline(h[2]) + '</div>'); return; }
    const li = l.match(/^[-*]\s+(.+)$/);
    if (li) {
      if (!inList) { out.push('<ul class="mdli">'); inList = true; }
      out.push('<li>' + mdInline(li[1]) + '</li>');
      return;
    }
    closeList();
    out.push('<div class="mdp">' + mdInline(l) + '</div>');
  });
  closeList();
  return out.join('').replace(/@@MD(\d+)@@/g, (m, i) => '<div class="mdcode"><pre>' + (blocks[Number(i)] || '') + '</pre></div>');
}

/* 目录构成 Top 12（复用 an-row 风格，弹窗内收敛为 4 列）；v1.7.4 目录行可在弹窗内下钻 */
function dirsRows(dd) {
  const items = (dd.items || []).slice(0, 12);
  const total = dd.totalSize || 1;
  return '<div class="small muted" style="margin:2px 0 8px">共 ' + (dd.items || []).length + ' 项 · 总计 <b style="color:var(--text)">' + fmtBytes(dd.totalSize || 0) + '</b> · 显示前 ' + items.length + ' 大' +
    ' · <span style="color:var(--acc)">点击 📁 目录可在弹窗内下钻</span></div>' +
    '<div class="an-row head"><span>名称</span><span>占比</span><span class="num">大小</span><span class="num">文件数</span></div>' +
    items.map(it => {
      const sz = it.size || 0;
      const pct = total ? sz / total * 100 : 0;
      const color = pct > 50 ? 'var(--red)' : pct > 25 ? 'var(--amber)' : 'url(#mdirs-grad)';
      const drillable = it.isDir && !it.reparse; // 符号链接 isDir:false，不下钻
      return '<div class="an-row">' +
        '<span class="nm" data-act="' + (drillable ? 'dirsdrill' : 'open') + '" data-p="' + esc(it.path) + '" title="' + (drillable ? '点击下钻：' : '点击打开：') + esc(it.path) + '">' + (it.isDir ? '📁 ' : '📄 ') + esc(it.name) + (it.reparse ? ' 🔗' : '') + '</span>' +
        '<span style="height:7px;background:var(--bar-track);border-radius:4px;overflow:hidden"><i style="display:block;height:100%;border-radius:4px;width:' + Math.min(pct, 100).toFixed(1) + '%;background:' + color + '"></i></span>' +
        '<span class="num" style="color:var(--text)">' + fmtBytes(sz) + '</span>' +
        '<span class="num">' + (it.files || '—') + '</span></div>';
    }).join('') +
    '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="mdirs-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#4d9fff"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs></svg>';
}

async function openProject(p) {
  const seq = ++detailSeq;
  const name = String(p).split('\\').pop();
  openModal('<button class="close" data-act="closeModal">✕</button><div class="muted">读取项目详情…</div>');
  let d = null, err = '';
  try { d = await window.wb.projectDetail(p); }
  catch (e) { err = String((e && e.message) || e); }
  if (seq !== detailSeq) return; // 期间又打开了其它详情
  if (err || !d || d.error || (!d.git && !d.readme)) {
    openModal(
      '<button class="close" data-act="closeModal">✕</button>' +
      '<div class="m-head"><div class="avatar" style="' + avatarStyle(hueOf(name)) + '">' + esc(name.slice(0, 1).toUpperCase()) + '</div>' +
      '<div><h3>' + esc(name) + '</h3><div class="muted small mono">' + esc(p) + '</div></div></div>' +
      '<div class="hint" style="color:var(--red)">✘ 读取项目详情失败：' + esc(err || (d && d.error) || '不是 git 仓库，也没有 README') + '</div>');
    return;
  }
  const meta = ((DATA && DATA.projects) || []).find(x => x.path === p) || {};
  const g = d.git || {};
  openModal(
    '<button class="close" data-act="closeModal">✕</button>' +
    '<div class="m-head"><div class="avatar" style="' + avatarStyle(hueOf(name)) + '">' + esc(name.slice(0, 1).toUpperCase()) + '</div>' +
    '<div style="min-width:0;flex:1"><h3>' + esc(name) + '</h3><div class="muted small mono">' + esc(p) + '</div></div>' +
    (meta.type ? '<span class="badge ' + esc(meta.type) + '" style="flex:none">' + esc(meta.type) + '</span>' : '') + '</div>' +
    '<div class="sec"><h3>概览</h3><div class="chips">' +
    (d.git
      ? '<span class="chip"><b>分支</b> ' + esc(g.branch || '—') + '</span>' +
        '<span class="chip">' + (g.dirty ? '<b style="color:var(--amber)">未提交 ' + esc(g.dirty) + ' 个文件</b>' : '<b style="color:var(--green)">工作区干净</b>') + '</span>' +
        '<span class="chip"><b>最近提交</b> ' + (g.commitTime ? esc(relTime(g.commitTime)) + '前' : '—') + '</span>'
      : '') +
    '<span class="chip"><b>体量</b> ' + (meta.sizeMB ? fmtMB(meta.sizeMB) : '—') + '</span>' +
    '<span class="chip"><b>文件数</b> ' + (meta.fileCount ? meta.fileCount.toLocaleString() : '—') + '</span>' +
    '</div></div>' +
    (g.dirtyFiles && g.dirtyFiles.length
      ? '<div class="sec"><h3>未提交文件（' + g.dirtyFiles.length + '）</h3><div class="files">' + esc(g.dirtyFiles.join('\n')) + '</div></div>'
      : '') +
    (d.git
      ? '<div class="sec"><h3>最近提交</h3><div class="log">' +
        (g.log || []).map(l => '<div><span class="t">' + esc(String(l.time || '').slice(5, 16)) + '</span>' + esc(l.subject) + '</div>').join('') + '</div></div>' +
        '<div class="sec"><h3>分支（' + (g.branches || []).length + '）</h3><div class="chips">' +
        (g.branches || []).map(b => '<span class="chip' + (b === g.branch ? ' on' : '') + '">' + esc(b) + '</span>').join('') + '</div></div>'
      : '') +
    (d.readme && d.readme.exists
      ? '<div class="sec"><h3>README <span class="muted small">' + esc(d.readme.name || '') + '</span></h3><div class="mdbody">' + miniMd(d.readme.text || '') + '</div></div>'
      : '') +
    '<div class="sec"><h3>目录构成 <span class="muted small">点击 📁 目录可在弹窗内下钻</span></h3>' +
    '<div id="dirs-wrap"><div class="muted small" style="padding:6px 0">目录构成计算中…（大目录需几十秒）</div></div></div>'
  );
  // 目录构成异步计算，不阻塞弹窗主体；stack 记录下钻层级，结果按「路径」命中 6 小时缓存（复用）
  currentDetail = { root: p, stack: [p], loadDirs };
  loadDirs(false);

  async function loadDirs(force) {
    if (!currentDetail) return;
    const cur = curDirsPath();
    const wrap = $('#dirs-wrap');
    if (!cur || !wrap) return;
    const depth = currentDetail.stack.length - 1;
    wrap.innerHTML = '<div class="muted small" style="padding:6px 0">' +
      (force ? '强制重算中…（大目录需几十秒）' : depth ? '进入目录中…（大目录需几十秒）' : '目录构成计算中…（大目录需几十秒）') + '</div>';
    let dd = null, derr = '';
    try { dd = await window.wb.projectDirs(cur, !!force); }
    catch (e) { derr = String((e && e.message) || e); }
    // 弹窗关闭 / 切换 / 期间又下钻或返回 → 丢弃过期结果
    if (seq !== detailSeq || $('#modal').classList.contains('hidden')) return;
    if (cur !== curDirsPath()) return;
    const w2 = $('#dirs-wrap');
    if (!w2) return;
    if (derr || !dd || dd.error) {
      w2.innerHTML = '<div class="muted small" style="padding:6px 0;color:var(--red)">✘ 目录构成计算失败：' + esc(derr || (dd && dd.error) || '未知错误') + '</div>';
      return;
    }
    if (!(dd.items || []).length) { w2.innerHTML = '<div class="muted small" style="padding:6px 0">目录为空</div>'; return; }
    // 导航条：返回上级（仅下钻层）/ 当前路径面包屑 / 缓存提示 / 打开当前目录 / 强制重算（按当前层路径）
    const upBtn = depth > 0 ? '<button class="ibtn" data-act="dirsup" title="返回上一级">⬆ 返回上级</button>' : '';
    const crumb = '<span class="crumb mono muted small" title="' + esc(cur) + '">' + (depth > 0 ? '📂 ' + esc(cur) : '项目根目录') + '</span>';
    const cacheTxt = dd.cached ? '<span class="muted small">来自缓存（' + cacheAge(dd.cachedAt) + '）</span>' : '';
    const openBtn = '<button class="ibtn" data-act="open" data-p="' + esc(cur) + '" title="在资源管理器打开当前目录">📂 打开</button>';
    const redirsBtn = '<button class="ibtn" data-act="redirs" data-p="' + esc(cur) + '" title="强制重算当前目录">↻ 重算</button>';
    const head = '<div class="dirs-nav">' + upBtn + crumb + cacheTxt + '<span style="flex:1"></span>' + openBtn + redirsBtn + '</div>';
    w2.innerHTML = head + dirsRows(dd);
  }
}

function cacheAge(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return '刚刚生成';
  if (m < 60) return m + ' 分钟前';
  return Math.floor(m / 60) + ' 小时前';
}

init();
