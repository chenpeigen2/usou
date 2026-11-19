/* 主题引擎 + 通用工具 + 头像墨色（v1.7.41 按职责抽为独立文件）。含浅色映射 LIGHT_MAP、色值读取 cssVar/colorOf、头像 avatarStyle/avatarInk、时间/体积格式化、主题切换 applyTheme/setTheme/toggleTheme、对比度审计依赖的 SVG 图标。在 app.js 之前加载，全局可见。 */
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
/* v1.7.47：相对时间 + 「前」的后缀封装 —— relTime 对 <1 分钟返回「刚刚」，直接拼「前」会变成
   「刚刚前」（第 127 轮真实文案 bug）。此处统一处理：刚刚不加前，其余加前。 */
function relTimeAgo(s) { const r = relTime(s); return r === '刚刚' ? '刚刚' : r + '前'; }
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
  // v1.7.71：标题栏新鲜度可点击重扫（符合直觉：点"数据 X 前"= 刷新数据）
  const st = $('#tb-status');
  if (st) { st.setAttribute('data-act', 'rescan'); st.title = '点击立即重扫项目数据（F5）'; st.style.cursor = 'pointer'; }
}
function logLine(s) {
  const el = $('#scan-log');
  if (el) { el.textContent += s + '\n'; el.scrollTop = el.scrollHeight; }
}

/* ---------- 主题引擎（v1.7.8 浅色主题） ----------
   深色为默认；浅色靠 <html data-theme="light"> + CSS 语义变量整体换肤。
   主题状态落 settings.theme（走既有 settings:set，不新增 IPC）。 */
/* v1.7.78：跟随系统主题 —— 'system' 时按 prefers-color-scheme 解析为 light/dark，并监听系统变化 */
function systemPrefersLight() {
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; }
  catch (_e) { return false; }
}
function resolveTheme(t) { return t === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : (t === 'light' ? 'light' : 'dark'); }
function applyTheme(t, opts) {
  const th = resolveTheme(t);
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
    const res = await window.wb.saveSettings({ theme: t }); // v1.7.78：保存原值（含 'system'），非解析后的 th
    // settings:set 返回合并后的完整对象（v1.7.2 起）；非对象则保留原对象合并 patch，绝不整体覆盖
    SETTINGS = (res && typeof res === 'object') ? res : Object.assign({}, SETTINGS, { theme: t });
    SETTINGS.theme = t;
  } catch (e) {
    toast('主题保存失败：' + String((e && e.message) || e), 'err');
  }
  toast(t === 'system' ? '已设为跟随系统主题' : (th === 'light' ? '已切换到浅色主题' : '已切换到深色主题'), 'ok');
}
function toggleTheme() { setTheme(themeIsLight() ? 'dark' : 'light'); }
// v1.7.78：系统主题变化时，若当前设为跟随系统则实时应用
function bindSystemTheme() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (SETTINGS && SETTINGS.theme === 'system') applyTheme('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (_e) { /* 老浏览器不支持则忽略 */ }
}

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
