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
/* 历史快照纯函数已按 nodebestpractices 1.3 抽为平铺文件 renderer/history.js（v1.7.41）。normHistoryProjects/historyStatsFor/historyStats/historyDiffItems/HIST_LEGACY_* 全局可见，简报/系统视图/QA 钩子调用点零改动。 */
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
