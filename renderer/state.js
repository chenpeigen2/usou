/* 全局状态 + 初始化（v1.7.41 按职责抽为独立文件）。DATA/SETTINGS/HISTORY 等全局 let 变量、refreshState/init/startScan 等。在 app.js 之前加载：变量声明先执行，init 在 app.js 末尾调用、那时所有模块函数已定义。 */
let DATA = null, SETTINGS = { skipSizes: false, extraRoots: [] }, CAPS = { vscode: false, wt: false }, HISTORY = [], LOGINITEM = false, VERSION = '';
let view = localStorage.getItem('wb.view') || 'overview';
let filterType = '全部', q = '', sortBy = 'mtime';
let tagFilter = '';      // v1.7.53：项目视图标签筛选（空=全部）
let rq = '';     // v1.7.12：最近视图搜索词（与项目视图的 q 分开保存，互不干扰）
let rqDeadOnly = false; // v1.7.41：最近视图「仅看已删除」筛选开关
let lastAnalysis = null;
let QA_DETAIL = '';   // QA 钩子：URL ?detail=项目名，renderProjects 末尾消费
let detailSeq = 0;    // 项目详情弹窗序号：接口慢返回时不覆盖已关闭/已切换的弹窗
let currentDetail = null; // 当前详情弹窗 { root, stack, loadDirs }，供目录构成下钻 / 返回 / 重算使用
let FAVS = [];        // 收藏项目绝对路径数组（settings.favorites 镜像；置顶 / Ctrl+K / 数字条共用）
let PROJ_TAGS = {};   // v1.7.53：项目标签/备注 { path: { tags:[], note:'' } }（settings.projectTags 镜像）
let MRU = [];         // v1.7.58：最近打开的项目路径（settings.recentOpened 镜像，命令面板优先）
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
   （本机真实数据：某已删除目录 / 某已删除目录）仍完整显示在雷达里
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

/* ---------- 状态与初始化 ---------- */

async function refreshState() {
  const st = await window.wb.getState();
  DATA = st.cache;
  SETTINGS = st.settings || {};
  SETTINGS.autoScanHours = Number(SETTINGS.autoScanHours) || 0; // 0=关闭
  FAVS = Array.isArray(SETTINGS.favorites) ? SETTINGS.favorites.filter(x => typeof x === 'string') : [];
  PROJ_TAGS = (SETTINGS.projectTags && typeof SETTINGS.projectTags === 'object' && !Array.isArray(SETTINGS.projectTags)) ? SETTINGS.projectTags : {};
  MRU = Array.isArray(SETTINGS.recentOpened) ? SETTINGS.recentOpened.filter(x => typeof x === 'string').slice(0, 12) : [];
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

/* v1.7.53：项目标签/备注（复用 settings 通道持久化，零新增 IPC） */
function tagsOf(p) { const e = PROJ_TAGS[p]; return e && Array.isArray(e.tags) ? e.tags : []; }
function noteOf(p) { const e = PROJ_TAGS[p]; return e && typeof e.note === 'string' ? e.note : ''; }
function allTagNames() {
  const s = new Set();
  Object.keys(PROJ_TAGS).forEach(p => (PROJ_TAGS[p].tags || []).forEach(t => s.add(t)));
  return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
async function saveProjTags(p, tags, note) {
  const next = Object.assign({}, PROJ_TAGS);
  if (!tags.length && !note) delete next[p];
  else next[p] = { tags: tags, note: note };
  PROJ_TAGS = next;
  try {
    const res = await window.wb.saveSettings({ projectTags: next });
    if (res && typeof res === 'object') { SETTINGS = res; PROJ_TAGS = res.projectTags || next; }
  } catch (e) { toast('标签保存失败：' + String((e && e.message) || e), 'err'); }
}
/* v1.7.58：记录最近打开（MRU）——命令面板优先显示，最多 12 条，落盘 settings */
function markOpened(p) {
  if (typeof p !== 'string' || !p) return;
  MRU = [p].concat(MRU.filter(x => x !== p)).slice(0, 12);
  window.wb.saveSettings({ recentOpened: MRU }).catch(() => {});
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
  if (qs.get('sizeqa')) triggerSizeQa();
  if (qs.get('diskqa')) triggerDiskQa(); // v1.7.42：空间页「已知空间大头」面板取证（零副作用）
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
  // v1.7.46：导入成功后主进程广播 —— 立即重载内存态并重绘，无需重启应用
  window.wb.on('data:imported', async d => {
    toast('已导入 ' + (d && d.projects || 0) + ' 个项目，数据已刷新', 'ok');
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

/* 机器脉搏 + 编码热力图已抽为平铺文件 renderer/visual.js（v1.7.41）。drawPulse/heatCard/bindPulse/PULSE 全局可见，init/渲染调用点零改动。 */

