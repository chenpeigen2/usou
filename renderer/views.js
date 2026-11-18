/* 视图渲染层（v1.7.41 按职责抽为独立文件）。渲染分发 render/setView + 总览/项目/最近/空间/系统/设置六视图 + 项目详情弹窗/对比 + 存在性检查/沉底排序。依赖 DATA/HISTORY/esc/各自 IPC 均在调用时延迟访问，在 app.js 之前加载、全局可见。 */

/* 今日简报子系统已按 nodebestpractices 1.3 抽为平铺文件 renderer/brief.js（v1.7.41）。activityDayLabel/commitWhenLabel/buildBrief/briefMarkdown/weeklyMarkdown 等全局可见，渲染/导出/QA 钩子调用点零改动。 */


/* 事件委托 + 命令面板已抽为 renderer/interaction.js（v1.7.41）。doAct/bindDelegation/palIndex/palFilteredFor 等全局可见。 */
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
  // 快捷入口 = 所有盘符 + 用户配置的快捷路径（DATA.links，来自 settings），无机器硬编码
  const quick = (DATA.drives || []).map(d => d.root)
    .concat(((DATA && DATA.links) || []).map(l => l.path));
  const defaultPath = quick[0] || '';
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>空间分析<span class="sub">统计子项完整大小找空间大头 · 含 node_modules 等全部内容 · 点击目录下钻</span></h2>' +
    '<div class="toolbar"><input id="an-path" style="width:430px" placeholder="输入要分析的目录路径" value="' + esc(lastAnalysis ? lastAnalysis.root : defaultPath) + '">' +
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


/* 系统 + 设置视图已抽为 renderer/system.js（v1.7.41）。renderSystem/renderSettings/saveSettings 等全局可见。 */


/* 项目详情弹窗 + 并排对比已抽为 renderer/detail.js（v1.7.41）。openProject/openCompare/compareRows 等全局可见。 */
