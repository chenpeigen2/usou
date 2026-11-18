/* 总览视图 + 共用辅助（v1.7.41 抽为独立文件）。renderOverview/磁盘环 hover/checkRecentExistence/checkProjectExistence/partitionDead 沉底排序。被项目/最近视图共用的辅助在同一全局作用域可见，调用点零改动。 */
/* ---------- 总览（Bento） ---------- */

function miniStat(icon, cls, id, val, lbl, goto, tip) {
  return '<div class="mini" data-act="goto" data-p="' + goto + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' +
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
  // v1.7.41：项目体量走「嵌套去重」口径 —— 子目录项目已含在父目录里，直接求和会把同一份
  //   磁盘空间算两遍（本项目实测 5 对嵌套、多算 5.4 GB / 5.04%）。纯函数见 format.js sizeTotals()。
  const sizeInfo = sizeTotals(projects);
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
    miniStat(ico('size'), 'g4', 'ms-size', fmtMB(sizeInfo.uniqueMB), '源码总体量', 'projects',
      sizeInfo.nested.length
        ? '各项目体量直接相加 = ' + fmtMB(sizeInfo.rawMB) + '；其中 ' + sizeInfo.nested.length + ' 个项目位于另一个项目目录之内（' + fmtMB(sizeInfo.dupMB) + '），已按父级合并去重 —— 避免同一份磁盘空间被算两次'
        : '各项目体量之和（无嵌套目录，无需去重）') +
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
