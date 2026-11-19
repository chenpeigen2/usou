/* 项目详情弹窗 + 并排对比（v1.7.41 按职责抽为独立文件，平铺在 renderer/）。openModal/closeModal/openProject/projectDirs 下钻 + openCompare/runCompare/compareRows/compareHtml。依赖 DATA/SETTINGS/esc/ipc 均在调用时延迟访问，在 app.js 之前加载、全局可见。 */
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
/* v1.7.45：对比结果导出为 Markdown（纯函数，所有动态文本经 mdEsc 转义）。 */
let lastCompare = null;
function compareMarkdown(pa, pb, rows) {
  const m = v => mdEsc(String(v == null || v === '' ? '—' : v));
  const stamp = String((DATA && DATA.meta && DATA.meta.scanTime) || new Date().toISOString()).slice(0, 19).replace('T', ' ');
  const lines = [
    '# 项目对比：' + m(pa && pa.name) + ' vs ' + m(pb && pb.name),
    '',
    '> 数据截至 ' + m(stamp) + ' · 工作台导出',
    '',
    '| 对比项 | 项目 A：' + m(pa && pa.name) + ' | 项目 B：' + m(pb && pb.name) + ' |',
    '|---|---|---|'
  ];
  (rows || []).forEach(r => {
    const mark = t => r.diff ? '**' + m(t) + '**' : m(t);
    lines.push('| ' + m(r.label) + ' | ' + mark(r.va) + ' | ' + mark(r.vb) + ' |');
  });
  lines.push('', '> ** 加粗表示该项两项目存在差异。');
  return lines.join('\n');
}
async function copyCompare() {
  if (!lastCompare) { toast('请先执行一次对比', 'err'); return; }
  const md = compareMarkdown(lastCompare.pa, lastCompare.pb, lastCompare.rows);
  try {
    await navigator.clipboard.writeText(md);
    toast('对比结果已复制（Markdown）', 'ok');
  } catch (e) { toast('复制失败：' + String((e && e.message) || e), 'err'); }
}
async function exportCompare() {
  if (!lastCompare) { toast('请先执行一次对比', 'err'); return; }
  const md = compareMarkdown(lastCompare.pa, lastCompare.pb, lastCompare.rows);
  try {
    const r = await window.wb.briefExport(md, '项目对比');
    toast(r && r.ok ? ('已导出：' + r.path.split(/[\\/]/).pop()) : ('导出失败：' + ((r && r.reason) || '未知')), r && r.ok ? 'ok' : 'err');
  } catch (e) { toast('导出失败：' + String((e && e.message) || e), 'err'); }
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
  lastCompare = { pa: pa, pb: pb, rows: rows };
  const errNote = (da && da.__error) || (db && db.__error)
    ? '<div class="small muted" style="margin-bottom:6px;color:var(--amber)">部分项目详情读取失败，缺失项已用快照数据 / — 兜底。</div>'
    : '';
  const actions = '<div class="btnrow" style="margin-top:10px">' +
    '<button class="btn ghost" data-act="compare:copy">📋 复制</button>' +
    '<button class="btn ghost" data-act="compare:export">💾 导出 Markdown</button></div>';
  res.innerHTML = errNote + compareHtml(rows) + actions;
}

/* v1.7.53：项目标签/备注编辑弹窗（复用 openModal，零新增 IPC） */
function openTagEditor(p) {
  const name = (p && p.path ? p : {});
  const proj = ((DATA && DATA.projects) || []).find(x => x && x.path === p);
  const title = proj ? proj.name : shortPath(p || '');
  const tags = tagsOf(p).join(', ');
  const note = noteOf(p);
  openModal(
    '<button class="close" data-act="closeModal">✕</button>' +
    '<div class="m-head"><h3>🏷 标签与备注</h3></div>' +
    '<div class="hint" style="margin-bottom:10px">' + esc(title) + ' · <span class="muted">' + esc(p || '') + '</span></div>' +
    '<div class="field"><label>标签（逗号分隔，如：工作, 关注, 交付）</label>' +
    '<input id="tag-input" type="text" value="' + esc(tags) + '" placeholder="标签1, 标签2"></div>' +
    '<div class="field"><label>备注</label><textarea id="tag-note" placeholder="给这个项目写点备注…">' + esc(note) + '</textarea></div>' +
    '<div class="btnrow"><button class="btn" data-act="tagsave" data-p="' + esc(p) + '">💾 保存</button></div>'
  );
}
async function saveTagEditor(p) {
  const inp = $('#tag-input'), nt = $('#tag-note');
  if (!inp || !p) return;
  const tags = inp.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const note = nt ? nt.value.trim() : '';
  await saveProjTags(p, tags, note);
  closeModal();
  render();
  toast('标签已保存', 'ok');
}
/* v1.7.56：全局标签管理（重命名/删除批量更新所有项目） */
function tagUsage() {
  const m = {};
  Object.keys(PROJ_TAGS || {}).forEach(p => (PROJ_TAGS[p].tags || []).forEach(t => { (m[t] = m[t] || []).push(p); }));
  return m;
}
function openTagManager() {
  const usage = tagUsage(), names = Object.keys(usage).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  if (!names.length) { toast('还没有任何标签，请先在项目中打标签', 'err'); return; }
  openModal(
    '<button class="close" data-act="closeModal">✕</button>' +
    '<div class="m-head"><h3>🏷 标签管理</h3></div>' +
    '<div class="hint" style="margin-bottom:10px">重命名会更新所有使用该标签的项目；删除会从所有项目移除该标签。</div>' +
    '<div class="tagman-list">' + names.map(t =>
      '<div class="tagman-row" data-tag="' + esc(t) + '">' +
      '<input type="text" class="tagman-in" value="' + esc(t) + '" aria-label="标签名">' +
      '<span class="muted small">' + usage[t].length + ' 个项目</span>' +
      '<button class="btn ghost" data-act="tagRename" data-p="' + esc(t) + '">改名</button>' +
      '<button class="btn ghost" data-act="tagDelete" data-p="' + esc(t) + '">删除</button></div>').join('') +
    '</div>'
  );
}
async function renameTag(oldT) {
  const row = Array.from(document.querySelectorAll('.tagman-row')).find(r => r.dataset.tag === oldT);
  if (!oldT || !row) return;
  const newT = (row.querySelector('.tagman-in') || {}).value.trim();
  if (!newT || newT === oldT) return;
  const next = Object.assign({}, PROJ_TAGS);
  Object.keys(next).forEach(p => { next[p] = Object.assign({}, next[p]); next[p].tags = (next[p].tags || []).map(t => t === oldT ? newT : t); });
  PROJ_TAGS = next;
  const res = await window.wb.saveSettings({ projectTags: next });
  if (res && typeof res === 'object') { SETTINGS = res; PROJ_TAGS = res.projectTags || next; }
  openTagManager(); render();
  toast('标签「' + oldT + '」已改名为「' + newT + '」', 'ok');
}
async function deleteTag(t) {
  if (!t) return;
  if (typeof window.confirm === 'function' && !window.confirm('确定删除标签「' + t + '」？会从所有使用它的项目移除。')) return;
  const next = Object.assign({}, PROJ_TAGS);
  Object.keys(next).forEach(p => { next[p] = Object.assign({}, next[p]); next[p].tags = (next[p].tags || []).filter(x => x !== t); if (!next[p].tags.length && !next[p].note) delete next[p]; });
  PROJ_TAGS = next;
  const res = await window.wb.saveSettings({ projectTags: next });
  if (res && typeof res === 'object') { SETTINGS = res; PROJ_TAGS = res.projectTags || next; }
  openTagManager(); render();
  toast('标签「' + t + '」已删除', 'ok');
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
        '<span class="chip"><b>最近提交</b> ' + (g.commitTime ? esc(relTimeAgo(g.commitTime)) : '—') + '</span>'
      : '') +
    '<span class="chip"><b>体量</b> ' + (meta.sizeMB ? fmtMB(meta.sizeMB) : '—') + '</span>' +
    '<span class="chip"><b>文件数</b> ' + (meta.fileCount ? meta.fileCount.toLocaleString() : '—') + '</span>' +
    '</div></div>' +
    '<div class="sec"><h3>历史轨迹 <span class="muted small">各次快照的未提交文件数 · 体量</span></h3>' +
    timelineHtml(projectTimeline(p)) + '</div>' +
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
