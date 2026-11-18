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


/* 项目 + 最近列表视图已抽为 renderer/lists.js（v1.7.41）。renderProjects/renderRecent 等全局可见。 */
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
