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


/* 总览视图 + 共用辅助已抽为 renderer/overview.js（v1.7.41）。renderOverview/partitionDead/checkProjectExistence 等全局可见。 */

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
