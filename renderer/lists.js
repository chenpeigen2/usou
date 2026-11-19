/* 项目 + 最近列表视图（v1.7.41 抽为独立文件）。renderProjects/renderRecent + 类型 chip/排序/搜索。依赖 DATA/FAVS/PROJ_DEAD/esc/搜索内核均在调用时延迟访问，在 app.js 之前加载、全局可见。 */
/* ---------- 项目 ---------- */

function renderProjects() {
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>项目雷达<span class="sub">悬停行显示操作 · Ctrl+K 全局直达</span></h2>' +
    '<div class="toolbar">' +
    '<input id="q" type="search" placeholder="搜索项目 / 路径 / 分支 / 提交…" value="' + esc(q) + '">' +
    '<div class="chips" id="type-chips"></div>' +
    (function () {
      const names = allTagNames();
      if (!names.length) return '';
      return '<select id="tag-filter" title="按标签筛选">' +
        '<option value="">全部标签</option>' +
        names.map(t => '<option value="' + esc(t) + '"' + (tagFilter === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') +
        '</select>';
    })() +
    '<select id="sort">' +
    '<option value="mtime"' + (sortBy === 'mtime' ? ' selected' : '') + '>按修改时间</option>' +
    '<option value="commit"' + (sortBy === 'commit' ? ' selected' : '') + '>按最近提交</option>' +
    '<option value="size"' + (sortBy === 'size' ? ' selected' : '') + '>按体量</option>' +
    '<option value="name"' + (sortBy === 'name' ? ' selected' : '') + '>按名称</option></select>' +
    '<button class="btool' + (projCompact ? ' on' : '') + '" data-act="projCompact" title="紧凑模式：隐藏副标题，一屏显示更多项目">' + (projCompact ? '▤ 舒适' : '☰ 紧凑') + '</button>' +
    '<button class="btool" data-act="dupFind" title="检测同名/嵌套/近似项目">🔍 查重</button>' +
    '<button class="btool" data-act="compare:open" title="并排对比两个 git 项目的分支 / 未提交 / 提交 / 体量">⚖ 对比</button>' +
    '</div>' +
    (selPaths.size ? '<div class="bulk-bar">已选 <b>' + selPaths.size + '</b> 项 · ' +
      '<button class="chipbtn" data-act="bulkFav">★ 批量收藏</button>' +
      '<button class="chipbtn" data-act="bulkUnfav">☆ 取消收藏</button>' +
      '<button class="chipbtn" data-act="bulkTag">🏷 批量打标签</button>' +
      '<button class="chipbtn" data-act="bulkClear">✕ 清空选择</button></div>' : '') +
    '<div id="proj-list"' + (projCompact ? ' class="compact"' : '') + '></div></div>';
  renderTypeChips();
  renderProjectList();
  // QA 钩子：?detail=项目名 → 列表就绪后自动打开项目详情
  if (QA_DETAIL) {
    const name = QA_DETAIL; QA_DETAIL = '';
    const hit = (DATA.projects || []).find(x => x.name === name);
    if (hit) openProject(hit.path);
  }
}
/* v1.7.60：局部更新批量条与行选中态（不重绘整个列表，避免滚动跳转/DOM 替换） */
function updateBulkUI() {
  document.querySelectorAll('.prow').forEach(row => {
    const cb = row.querySelector('.proj-check');
    if (cb) row.classList.toggle('is-sel', !!cb.checked);
  });
  const toolbar = document.querySelector('#view .toolbar');
  if (!toolbar) return;
  let bar = document.querySelector('.bulk-bar');
  if (!selPaths.size) { if (bar) bar.remove(); return; }
  const html = '已选 <b>' + selPaths.size + '</b> 项 · ' +
    '<button class="chipbtn" data-act="bulkFav">★ 批量收藏</button>' +
    '<button class="chipbtn" data-act="bulkUnfav">☆ 取消收藏</button>' +
    '<button class="chipbtn" data-act="bulkTag">🏷 批量打标签</button>' +
    '<button class="chipbtn" data-act="bulkClear">✕ 清空选择</button>';
  if (bar) bar.innerHTML = html;
  else { bar = document.createElement('div'); bar.className = 'bulk-bar'; bar.innerHTML = html; toolbar.after(bar); }
}
function renderTypeChips() {
  const projects = DATA.projects || [];
  const types = [...new Set(projects.map(p => p.type))];
  const counts = { '全部': projects.length };
  projects.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
  // v1.7.18：chip 口径与列表统计行、总览数字条、托盘严格一致 —— 必须剔除失效项目
  counts['未提交'] = projects.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).length;
  // v1.7.41：新增「已删除」筛选 —— 失效项目沉底后要点开第 50+ 行才能看到，一键筛选直达
  counts['已删除'] = projects.filter(p => PROJ_DEAD.has(p.path)).length;
  // v1.7.59：一键筛出所有带标签/备注的项目（无需逐个点标签）
  counts['已标记'] = Object.keys(PROJ_TAGS || {}).filter(p => projects.some(x => x.path === p)).length;
  counts['★收藏'] = projects.filter(p => isFav(p.path)).length;
  const order = ['全部', '未提交'].concat(types);
  if (counts['已删除'] > 0) order.push('已删除');
  if (counts['已标记'] > 0) order.push('已标记');
  if (counts['★收藏'] > 0) order.push('★收藏');
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
    else if (filterType === '已删除') { if (!PROJ_DEAD.has(p.path)) return false; }
    else if (filterType === '已标记') { if (!(tagsOf(p.path).length || noteOf(p.path))) return false; }
    else if (filterType === '★收藏') { if (!isFav(p.path)) return false; }
    else if (filterType !== '全部' && p.type !== filterType) return false;
    if (tagFilter && !tagsOf(p.path).includes(tagFilter)) return false;
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
  // v1.7.41：体量按「嵌套去重」口径 —— 子目录项目的体量已含在父目录里，直接求和会重复计算
  //   （本机实测 5 对嵌套、多算 5.4 GB）；去重后的数字与总览数字条、系统页趋势表同口径。
  const sizeInfo = sizeTotals(list);
  $('#proj-list').innerHTML =
    '<div class="stats" style="margin-bottom:8px">' + list.length + ' 项 · git ' + gitN + ' · 未提交 ' + dirtyN + ' · ★ 收藏 ' + favN +
    (deadN ? ' · <span class="deadstat">已删除 ' + deadN + '（已沉底）</span>' : '') +
    ' · 体量 ' + fmtMB(sizeInfo.uniqueMB) +
    (sizeInfo.nested.length ? '（已去重 ' + sizeInfo.nested.length + ' 个嵌套项目 · ' + fmtMB(sizeInfo.dupMB) + '）' : '') + '</div>' +
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
        ' · ' + esc((p.lastCommitSubject || '').slice(0, 70)) + ' · ' + relTimeAgo(p.lastCommitTime)
      : '非 git 目录 · 修改于 ' + relTimeAgo(p.rootMTime));
  const starTip = fav ? '取消收藏' : '收藏并置顶';
  const typeCell = dead
    ? '<span class="deadtag" title="该路径在磁盘上已不存在（可能已被删除或移动）">已删除</span>'
    : '<span class="badge ' + esc(p.type) + '">' + esc(p.type) + '</span>';
  const tagChips = tagsOf(p.path).map(t =>
    '<button class="tagchip" data-act="tagfilter" data-t="' + esc(t) + '" title="按标签「' + esc(t) + '」筛选">' + esc(t) + '</button>').join('');
  const noteChip = noteOf(p.path) ? '<span class="muted small" title="' + esc(noteOf(p.path)) + '">📝</span>' : '';
  return '<div class="prow' + (dirty ? ' has-dirty' : '') + (fav ? ' is-fav' : '') + (dead ? ' is-dead' : '') + (selPaths.has(p.path) ? ' is-sel' : '') + '">' +
    '<input type="checkbox" class="proj-check" data-p="' + esc(p.path) + '"' + (selPaths.has(p.path) ? ' checked' : '') + ' aria-label="选中项目">' +
    '<div class="avatar" style="' + avatarStyle(hue) + '">' + esc(p.name.slice(0, 1).toUpperCase()) + '</div>' +
    '<div class="p-main" style="min-width:0">' +
    '<div class="p-line"><button class="fav-btn' + (fav ? ' on' : '') + '" data-act="fav" data-p="' + esc(p.path) + '" title="' + esc(starTip) + '" aria-label="' + esc(starTip) + '">' + (fav ? '★' : '☆') + '</button>' +
    '<span class="nm" data-act="open" data-p="' + esc(p.path) + '" title="' + esc(p.path) + '">' + esc(p.name) + '</span>' +
    typeCell + '</div>' +
    '<div class="p-sub">' + sub + (tagChips || noteChip ? '<span class="p-tags">' + tagChips + noteChip + '</span>' : '') + '</div></div>' +
    '<div class="p-size"><div class="v">' + (dead ? '—' : fmtMB(p.sizeMB)) + '</div><div class="u">' + (dead ? '已失效' : (p.fileCount ? p.fileCount.toLocaleString() + ' 文件' : '—')) + '</div></div>' +
    '<div class="p-actions">' +
    '<button class="ibtn" data-act="open" data-p="' + esc(p.path) + '" title="资源管理器打开">📂</button>' +
    (CAPS.vscode ? '<button class="ibtn" data-act="vscode" data-p="' + esc(p.path) + '" title="用 VS Code 打开">💻</button>' : '') +
    '<button class="ibtn" data-act="term" data-p="' + esc(p.path) + '" title="在终端打开">⌨️</button>' +
    (p.isGit ? '<button class="ibtn" data-act="detail" data-p="' + esc(p.path) + '" title="项目详情">🌿</button>' : '') +
    '<button class="ibtn" data-act="copy" data-p="' + esc(p.path) + '" title="复制路径">📋</button>' +
    '<button class="ibtn' + (tagsOf(p.path).length || noteOf(p.path) ? ' tagged' : '') + '" data-act="tagedit" data-p="' + esc(p.path) + '" title="编辑标签与备注">🏷</button>' +
    '</div></div>';
}

/* ---------- 最近 ---------- */

/* v1.7.12：最近视图补搜索框（原先 60 条记录只能肉眼扫，而项目视图有搜索 —— 同应用内交互不一致）。
   与项目视图同款做法：搜索框放在 #view 里、结果列表放子容器 #recent-list，
   过滤时只重绘子容器 ⇒ 输入框不会被 innerHTML 重建而失焦。 */
function renderRecent() {
  const deadTotal = partitionDead(DATA.recent || [], RECENT_DEAD).dead.length;
  $('#view').innerHTML = '<div class="viewwrap">' +
    '<h2>最近动态<span class="sub">桌面 / 文档 / 下载 + 已配置项目根 · 限深扫描 Top 60</span></h2>' +
    '<div class="toolbar"><input id="rq" type="search" placeholder="搜索文件名 / 目录 / 类型…（空格分词）" value="' + esc(rq) + '">' +
    (deadTotal ? '<button class="chipbtn' + (rqDeadOnly ? ' on' : '') + '" data-act="recent:deadonly">🗑 仅看已删除 ' + deadTotal + '</button>' : '') +
    '<button class="chipbtn' + (recentGrouped ? ' on' : '') + '" data-act="recent:group">📁 按项目分组</button></div>' +
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
  // v1.7.41：仅看已删除模式 —— 复用 partitionDead 的失效集合，零新增判定
  const parts = partitionDead(list, RECENT_DEAD);
  if (rqDeadOnly) { parts.live = []; }
  const deadN = parts.dead.length;
  const note = rqDeadOnly
    ? ('仅看已删除 ' + deadN + ' 条' + (rq ? '（搜索：' + esc(rq) + '）' : ''))
    : (rq ? ('匹配 ' + list.length + ' / ' + all.length + ' 条') : (all.length + ' 条')) +
      (deadN ? ' · <span class="deadstat">已删除 ' + deadN + '（已沉底）</span>' : '');
  const sep = (!rqDeadOnly && deadN) ? '<div class="deadsep">以下 ' + deadN + ' 条已从磁盘删除（已沉底 · 不再位于首屏）</div>' : '';
  let body;
  if (recentGrouped) {
    const groups = {};
    parts.live.forEach(r => { const d = String(r.dir || '(未知目录)'); (groups[d] = groups[d] || []).push(r); });
    const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b, 'zh-Hans-CN'));
    body = keys.map(d => '<div class="rgroup"><div class="rgroup-h" title="' + esc(d) + '">📁 ' + esc(d) + ' <span class="muted small">' + groups[d].length + ' 项</span></div>' +
      groups[d].map(recentRow).join('') + '</div>').join('');
    if (deadN) body += sep + parts.dead.map(recentRow).join('');
  } else {
    body = parts.live.map(recentRow).join('') + sep + parts.dead.map(recentRow).join('');
  }
  $('#recent-list').innerHTML =
    '<div class="stats" style="margin-bottom:8px">' + note + '</div>' +
    '<div class="rlist">' + (body || '<div class="empty">' + (rq ? '无匹配文件' : '无记录') + '</div>') + '</div>';
}

