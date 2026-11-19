/* 系统 + 设置视图（v1.7.41 按职责抽为独立文件）。renderSystem/historyTrendHtml/drawTrend + renderSettings/saveSettings/clearScanErrors/autoCheckHtml。依赖 DATA/HISTORY/SETTINGS/AUTO_CHECK/esc/ipc 均在调用时延迟访问，在 app.js 之前加载、全局可见。 */
/* ---------- 系统 ---------- */

/* v1.7.61：扫描健康仪表 —— 聚合数据新鲜度/失效占比/体量覆盖/未提交数，给出整体健康分。
   纯展示，零新增 IPC，数据全部来自已加载的 DATA/PROJ_DEAD/HISTORY。 */
function scanHealthHtml() {
  const projects = (DATA && DATA.projects) || [];
  const n = projects.length || 1;
  const deadN = projects.filter(p => p && PROJ_DEAD.has(p.path)).length;
  const sizedN = projects.filter(p => p && (p.sizeMB || 0) > 0).length;
  const gitN = projects.filter(p => p && p.isGit).length;
  const dirtyN = projects.filter(p => p && p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).length;
  const ageMin = DATA && DATA.meta && DATA.meta.scanTime
    ? Math.max(0, Math.round((Date.now() - new Date(String(DATA.meta.scanTime).slice(0, 19).replace(' ', 'T'))) / 60000))
    : -1;
  // 健康分：新鲜度(30) + 体量覆盖(30) + 存活率(25) + 无未提交(15)
  const fresh = ageMin < 0 ? 0 : ageMin < 120 ? 30 : ageMin < 1440 ? 20 : ageMin < 10080 ? 10 : 0;
  const cover = Math.round((sizedN / n) * 30);
  const alive = Math.round(((n - deadN) / n) * 25);
  const clean = gitN ? Math.round(((gitN - dirtyN) / gitN) * 15) : 15;
  const score = fresh + cover + alive + clean;
  const level = score >= 80 ? ['良好', 'var(--green)'] : score >= 55 ? ['一般', 'var(--amber)'] : ['需关注', 'var(--red)'];
  const bar = (label, val, max, color) =>
    '<div class="hl-row"><span class="hl-l">' + label + '</span>' +
    '<span class="hl-bar"><i style="width:' + Math.max(0, Math.min(100, (val / max) * 100)).toFixed(0) + '%;background:' + color + '"></i></span>' +
    '<span class="hl-v">' + val + '/' + max + '</span></div>';
  return '<div class="card b-health"><div class="b-sec-t"><span>扫描健康 <span class="muted small">' +
    '整体 ' + score + '/100</span></span><span style="color:' + level[1] + ';font-weight:700">' + level[0] + '</span></div>' +
    '<div class="health-score"><b style="color:' + level[1] + '">' + score + '</b><span>/100</span></div>' +
    bar('数据新鲜度', fresh, 30, 'var(--acc)') +
    bar('体量覆盖 ' + sizedN + '/' + projects.length, cover, 30, 'var(--green)') +
    bar('存活项目 ' + (projects.length - deadN) + '/' + projects.length, alive, 25, 'var(--acc2)') +
    bar('干净仓库 ' + (gitN - dirtyN) + '/' + gitN, clean, 15, 'var(--amber)') +
    '<div class="hint small">' + (ageMin < 0 ? '尚无扫描数据' : '数据距今 ' + (ageMin < 60 ? ageMin + ' 分钟' : Math.round(ageMin / 60) + ' 小时')) +
    ' · 失效项目 ' + deadN + ' 个（已剔除统计）· 未提交仓库 ' + dirtyN + ' 个</div></div>';
}
function renderSystem() {
  const m = DATA.meta;
  $('#view').innerHTML = '<div class="viewwrap">' +
    scanHealthHtml() +
    '<h2>扫描历史趋势<span class="sub">共 ' + HISTORY.length + ' 次扫描快照 · 展示未提交文件总量与项目数变化</span>' +
    (HISTORY.length >= 2 ? '<button class="btn ghost" style="margin-left:12px" data-act="snapDiff">⚖ 对比快照</button>' : '') + '</h2>' +
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
    '<h2>行为<span style="margin-left:12px"><button class="chipbtn" data-act="shortcutHelp">⌨ 快捷键 ( ? )</button></span></h2>' +
    '<label class="ckrow"><input type="checkbox" id="ck-tray"' + (SETTINGS.trayMinimize ? ' checked' : '') + '> 关闭按钮最小化到托盘</label>' +
    '<label class="ckrow"><input type="checkbox" id="ck-login"' + (LOGINITEM ? ' checked' : '') + '> 开机自动启动工作台</label>' +
    '<h2>外观<span class="sub">切换即时生效，并跨重启保留</span></h2>' +
    '<div class="field"><label>主题</label><div class="theme-pick">' +
    '<button class="chipbtn' + (themeIsLight() ? '' : ' on') + '" data-act="theme:set" data-p="dark">🌙 深色</button>' +
    '<button class="chipbtn' + (themeIsLight() ? ' on' : '') + '" data-act="theme:set" data-p="light">☀️ 浅色</button>' +
    '</div><div class="hint">浅色主题对六个视图（总览 / 项目 / 最近 / 空间 / 系统 / 设置）整体换肤，含标题栏、侧栏、卡片、弹窗、命令面板与图表。</div></div>' +
    '<h2>扫描设置</h2>' +
    '<div class="field"><label>扫描根目录（每行一个路径；其下子目录会被发现为项目。留空 = 扫描各盘符根与用户目录）</label>' +
    '<textarea id="scan-roots" placeholder="每行一个绝对路径">' + esc((SETTINGS.scanRoots || []).join('\n')) + '</textarea></div>' +
    '<div class="field"><label>强制纳入的目录（每行一个路径；即使无项目标记也纳入项目雷达）</label>' +
    '<textarea id="force-dirs" placeholder="每行一个绝对路径">' + esc((SETTINGS.forceDirs || []).join('\n')) + '</textarea></div>' +
    '<div class="field"><label>额外项目根目录（每行一个路径，会纳入项目雷达）</label>' +
    '<textarea id="extra-roots" placeholder="每行一个绝对路径">' + esc((SETTINGS.extraRoots || []).join('\n')) + '</textarea></div>' +
    '<div class="field"><label>快捷入口（每行「名称=路径」，出现在空间分析页与命令面板；留空 = 仅默认的桌面/文档/下载）</label>' +
    '<textarea id="links" placeholder="项目群=D:\\projects">' + esc(((SETTINGS.links || [])).map(l => (l && l.name && l.path) ? l.name + '=' + l.path : '').filter(Boolean).join('\n')) + '</textarea></div>' +
    '<label class="ckrow"><input type="checkbox" id="ck-skip"' + (SETTINGS.skipSizes ? ' checked' : '') + '> 扫描时跳过体量统计（更快，但失去空间分析数据）</label>' +
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
    '<button class="btn ghost" data-act="dataExport">💾 导出数据备份</button>' +
    '<button class="btn ghost" data-act="dataImport">📥 导入备份（覆盖前自动备份现有数据）</button>' +
    '<button class="btn ghost" data-act="tagManage">🏷 管理标签</button>' +
    '<button class="btn ghost" data-act="csvExport">📊 导出项目清单 CSV</button>' +
    '<button class="btn ghost" data-act="mruClear">🧹 清除最近打开</button>' +
    '</div>' +
    '<div class="hint" style="margin-top:6px">导出全部本地数据（扫描缓存 / 历史快照 / 设置）为 JSON 备份，落盘至「文档\\工作台」；只读取、不改动原数据。</div>' +
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
  const lines = id => ($(id) ? $(id).value.split('\n').map(s => s.trim()).filter(Boolean) : []);
  const scanRoots = lines('#scan-roots');
  const forceDirs = lines('#force-dirs');
  const extraRoots = lines('#extra-roots');
  const links = lines('#links').map(s => {
    const i = s.indexOf('=');
    return i > 0 ? { name: s.slice(0, i).trim(), path: s.slice(i + 1).trim() } : null;
  }).filter(x => x && x.name && x.path);
  const skipSizes = !!(($('#ck-skip') || {}).checked);
  const autoScanHours = Number($('#autoscan-hours').value) || 0;
  const patch = { scanRoots, forceDirs, extraRoots, links, skipSizes, trayMinimize: $('#ck-tray').checked, autoScanHours };
  const res = await window.wb.saveSettings(patch);
  // settings:set 自 v1.7.2 起返回合并后的 settings 对象；历史版本返回布尔 true。
  // 绝不能把返回值整体赋给 SETTINGS（严格模式给布尔赋属性抛 TypeError，且会清空 favorites / winBounds）。
  // 拿到对象就用它同步磁盘态；否则退回「保留现有对象 + 合并本页改动」，两种方式都不会再抛错。
  SETTINGS = (res && typeof res === 'object') ? res : Object.assign({}, SETTINGS, patch);
  SETTINGS.autoScanHours = Number(SETTINGS.autoScanHours) || 0;
  if (window.wb.loginItemSet) await window.wb.loginItemSet($('#ck-login').checked);
  toast('设置已保存，重扫后生效', 'ok');
}
