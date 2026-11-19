/* 事件委托 + 命令面板（v1.7.41 按职责抽为独立文件）。doAct/bindDelegation/bindScanEvents/bindWinControls + 命令面板 palIndex/palFilteredFor/renderPalList/openPal/closePal 等。在 app.js 之前加载、全局可见。 */
/* ---------- 事件委托 ---------- */

function doAct(act, p) {
  switch (act) {
    case 'open': window.wb.openPath(p).then(r => { if (r && r !== '') toast(String(r), 'err'); else markOpened(p); }).catch(() => toast('打开失败', 'err')); break;
    // v1.7.13：此前**完全忽略** path:show 的返回值 ⇒ 失效路径点「📂 打开所在目录」是 100% 静默失败
    case 'show': window.wb.showInFolder(p).then(r => { if (r && r.ok === false) toast(String(r.reason || '无法打开所在目录'), 'err'); }).catch(() => toast('无法打开所在目录', 'err')); break;
    // v1.7.14：open:in 现在会先判存在性（缺失 → {ok:false, msg} ⇒ 这里自动弹 toast）；
    // 另补 .catch() 兜底 —— IPC 调用异常时也要有提示，否则 Promise 变成 unhandled rejection =「点了没反应」
    case 'vscode': window.wb.openIn(p, 'vscode').then(r => { if (!r || !r.ok) toast((r && r.msg) || '打开失败', 'err'); else markOpened(p); }).catch(() => toast('无法用 VS Code 打开', 'err')); break;
    case 'term': window.wb.openIn(p, 'terminal').then(r => { if (!r || !r.ok) toast((r && r.msg) || '打开失败', 'err'); else markOpened(p); }).catch(() => toast('无法在终端打开', 'err')); break;
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
    case 'tagfilter': tagFilter = (tagFilter === p ? '' : p); if (view !== 'projects') setView('projects'); else render(); break;
    case 'tagedit': openTagEditor(p); break;
    case 'tagsave': saveTagEditor(p); break;
    case 'tagManage': openTagManager(); break;
    case 'tagRename': renameTag(p); break;
    case 'tagDelete': deleteTag(p); break;
    case 'snapDiff': openSnapDiff(); break;
    case 'snapDiffRun': runSnapDiff(); break;
    case 'bulkFav': bulkFav(true); break;
    case 'bulkUnfav': bulkFav(false); break;
    case 'bulkTag': bulkTag(); break;
    case 'bulkTagRun': bulkTagRun(); break;
    case 'bulkClear': selPaths.clear(); render(); break;
    case 'mruClear': clearMRU(); break;
    case 'csvExport': (async () => {
      try {
        const r = await window.wb.csvExport();
        toast(r && r.ok ? ('已导出 ' + r.rows + ' 个项目到 CSV（Excel 可直接打开）') : ('导出失败：' + ((r && r.reason) || '未知')), r && r.ok ? 'ok' : 'err');
      } catch (e) { toast('导出失败：' + String((e && e.message) || e), 'err'); }
    })(); break;
    case 'shortcutHelp': openShortcutHelp(); break;
    case 'projCompact': projCompact = !projCompact; window.wb.saveSettings({ compactProjects: projCompact }).catch(() => {}); render(); break;
    case 'dupFind': openDupFind(); break;
    case 'recent:deadonly': rqDeadOnly = !rqDeadOnly; renderRecent(); break;
    case 'recent:group': recentGrouped = !recentGrouped; renderRecent(); break;
    case 'drill': { const el = $('#an-path'); if (el) { el.value = p; startAnalyze(); } break; }
    case 'analyze': startAnalyze(); break;
    case 'reforce': { if (p) { const el = $('#an-path'); if (el) el.value = p; } startAnalyze(true); break; }
    case 'saveSettings': saveSettings(); break;
    case 'clearScanErrors': clearScanErrors(); break;
    case 'dataExport': (async () => {
      try {
        const r = await window.wb.dataExport();
        toast(r && r.ok ? ('已导出备份：' + r.projects + ' 项目 · ' + Math.round(r.bytes / 1024) + ' KB') : ('导出失败：' + ((r && r.reason) || '未知')), r && r.ok ? 'ok' : 'err');
      } catch (e) { toast('导出失败：' + String((e && e.message) || e), 'err'); }
    })(); break;
    case 'dataImport': (async () => {
      try {
        const pv = await window.wb.dataPeek();
        if (!pv || pv.canceled) return;
        if (!pv.ok) { toast('备份校验失败：' + ((pv && pv.reason) || '未知'), 'err'); return; }
        const when = String(pv.exportedAt || '').slice(0, 19).replace('T', ' ') || '(未记录)';
        const msg = '备份摘要：\n· ' + pv.projects + ' 个项目\n· ' + pv.history + ' 条历史快照\n' +
          '· 导出时间：' + when + '\n· 设置：' + (pv.hasSettings ? '包含' : '不含') +
          '\n\n导入会覆盖当前数据（覆盖前自动备份现有数据）。确定继续吗？';
        if (typeof window.confirm === 'function' && !window.confirm(msg)) return;
        const r = await window.wb.dataImport(pv.file);
        if (r && r.canceled) return;
        toast(r && r.ok ? ('已导入 ' + r.projects + ' 项目（旧数据已备份 .preimport-' + r.backupTag + '）') : ('导入失败：' + ((r && r.reason) || '未知')), r && r.ok ? 'ok' : 'err');
      } catch (e) { toast('导入失败：' + String((e && e.message) || e), 'err'); }
    })(); break;
    case 'theme:set': setTheme(p); break;
    case 'compare:open': openCompare(); break;
    case 'compare:run': runCompare(); break;
    case 'compare:copy': copyCompare(); break;
    case 'compare:export': exportCompare(); break;
  }
}

function bindDelegation() {
  $('#view').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'typefilter' || a === 'tagfilter') doAct(a, b.dataset.t);
    else if (a === 'scan') doAct(a, b.dataset.fast || b.dataset.p);
    else doAct(a, b.dataset.p);
  });
  $('#view').addEventListener('input', e => {
    if (e.target.id === 'q') { q = e.target.value.trim(); renderProjectList(); }
    else if (e.target.id === 'rq') { rq = e.target.value; renderRecentList(); }
  });
  $('#view').addEventListener('change', e => {
    if (e.target.id === 'sort') { sortBy = e.target.value; renderProjectList(); }
    else if (e.target.id === 'tag-filter') { tagFilter = e.target.value; renderProjectList(); }
    else if (e.target.classList && e.target.classList.contains('proj-check')) {
      if (e.target.checked) selPaths.add(e.target.dataset.p); else selPaths.delete(e.target.dataset.p);
      updateBulkUI(); // 局部更新，不重绘列表（避免滚动跳转与 DOM 替换）
    }
  });
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
    // v1.7.65：? 显示快捷键帮助（输入框内不触发，避免打字误弹）
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.preventDefault();
      openShortcutHelp();
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
      const fa = isFav(a.path) ? 1 : 0, fb = isFav(b.path) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      // v1.7.58：收藏之后按最近打开（MRU）排序，越近打开越靠前
      const ma = MRU.indexOf(a.path), mb = MRU.indexOf(b.path);
      const ra = ma < 0 ? 999 : ma, rb = mb < 0 ? 999 : mb;
      return ra - rb;
    });
  projects.forEach(p => {
    const fav = isFav(p.path);
    const hue = hueOf(p.name);
    const ico = '<div class="avatar" style="' + avatarStyle(hue, 'width:30px;height:30px;border-radius:8px;font-size:13px') + '">' + esc(p.name.slice(0, 1).toUpperCase()) + '</div>';
    const acts = [['📂', 'open', p.path]];
    if (CAPS.vscode) acts.push(['💻', 'vscode', p.path]);
    acts.push(['⌨️', 'term', p.path]);
    if (p.isGit) acts.push(['🌿', 'detail', p.path]);
    const tags = tagsOf(p.path);
    items.push({
      label: (fav ? '★ ' : '') + p.name + (tags.length ? ' [' + tags.join(' ') + ']' : ''),
      hint: (fav ? '★ 已收藏 · ' : '') + (MRU.indexOf(p.path) === 0 ? '🕘 最近打开 · ' : '') + p.type + (p.isGit ? ' · ' + (p.branch || '') : '') + ' · ' + p.path,
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
  // v1.7.63：高频动作也进命令面板 —— Ctrl+K 不必回总览/设置就能导出/复制
  [['动作：导出周报', '📅 导出 weeklyMarkdown 到文档', '导出 周报 weekly markdown', '📅', () => exportWeekly()],
   ['动作：复制今日简报', '📋 复制简报到剪贴板', '复制 简报 brief copy', '📋', () => copyBrief()],
   ['动作：导出数据备份', '💾 导出全部本地数据 JSON', '导出 备份 数据 data export', '💾', () => doAct('dataExport')],
   ['动作：清除最近打开', '🕘 清除命令面板的最近打开记录', '清除 最近 打开 clear mru recent', '🧹', () => clearMRU()],
   ['动作：导出项目清单 CSV', '📊 导出全部项目到 Excel 可打开的 CSV', '导出 项目 清单 csv excel 表格', '📊', () => doAct('csvExport')]
  ].forEach(([label, hint, keys, ico, run]) => items.push({
    label: label, hint: hint, keys: keys, ico: ico, icoCls: 'g2', acts: [], run: run
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

