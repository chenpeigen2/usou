/* 今日简报子系统（v1.7.7~v1.7.38 逐轮建立，v1.7.41 抽为独立文件平铺在 renderer/）。活动/提交时间标签、buildBrief、屏幕与导出共用缓存、周报、导出提示。放 app.js 前加载：函数先定义；DATA/HISTORY/PROJ_DEAD/esc/relTime/toast 等依赖均在调用时延迟访问，调用点零改动。 */
/* ---------- 今日简报 ---------- */

/* v1.7.20：活动桶日期键 → 相对标签（今天/昨天/本月 MM-DD/跨年完整 YYYY-MM-DD）。
   纯函数；now 缺省 new Date()。所有日期键以本地时间 padStart(2,'0') 生成。
   昨天用日历法 new Date(y, m, d-1)（而非减 86400000ms），在 DST/月末边界仍准确。
   对任意畸形输入均不抛异常，兜底返回 '当日'。 */
function activityDayLabel(dateStr, now) {
  try {
    const p2 = x => String(x).padStart(2, '0');
    const d = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
    const todayKey = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const y = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    const yesterdayKey = y.getFullYear() + '-' + p2(y.getMonth() + 1) + '-' + p2(y.getDate());
    const s = (typeof dateStr === 'string') ? dateStr : '';
    if (!s) return '当日';
    if (s === todayKey) return '今天';
    if (s === yesterdayKey) return '昨天';
    if (s.indexOf(String(d.getFullYear()) + '-') === 0) return s.slice(5);
    return s;
  } catch (e) {
    return '当日';
  }
}

/* v1.7.21：简报「最近提交」的时间标签。
   根因：relTime() 的 base() 恒为 DATA.meta.scanTime（快照语义，DECISIONS D8，不得改动），
   数据陈旧时「12 分钟前」是「提交距扫描 12 分钟」而非「距此刻 12 分钟」→ 读者误读为假事实。
   修法：只把扫描时刻距此刻 ≤1h 的**新鲜快照**继续交给 relTime（零回归）；
   陈旧快照改用绝对时间「于 MM-DD HH:mm 」（跨年补 YYYY-）。纯函数，不改 DATA / relTime / base。 */
function commitWhenLabel(commitTime, scanTime, now) {
  const p2 = x => String(x).padStart(2, '0');
  const toDate = v => {
    if (v == null || v === '') return new Date(NaN);
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return new Date(v);
    return new Date(String(v).slice(0, 19).replace(' ', 'T'));
  };
  try {
    const n = toDate(now == null ? new Date() : now);
    const s = toDate(scanTime);
    if (!isNaN(s) && !isNaN(n) && (n - s) <= 3600000) return relTime(commitTime) + '前';
    const c = toDate(commitTime);
    if (isNaN(c)) return String(commitTime);
    const ymd = (!isNaN(n) && c.getFullYear() !== n.getFullYear() ? c.getFullYear() + '-' : '') +
      p2(c.getMonth() + 1) + '-' + p2(c.getDate());
    return '于 ' + ymd + ' ' + p2(c.getHours()) + ':' + p2(c.getMinutes()) + ' ';
  } catch (e) {
    return String(commitTime);
  }
}

function buildBrief() {
  const projects = DATA.projects || [];
  const out = [];
  // 每条简报携带可操作动作：act/p 走既有 data-act 事件委托；tip 为悬浮提示（渲染时统一 esc）
  // v1.7.7：同时携带纯文本 text —— 复制/导出用 text，不再从 html 反推（HTML 反推会漏标签语义）
  const push = (color, html, text, act, p, tip) => out.push({ color, html, text, act, p, tip });

  projects.filter(p => p.isGit && p.dirty > 0 && !PROJ_DEAD.has(p.path)).sort((a, b) => b.dirty - a.dirty).slice(0, 2)
    .forEach(p => push('var(--amber)', '「<b>' + esc(p.name) + '</b>」还有 <span class="warn">' + p.dirty + '</span> 个文件未提交，停在 <b>' + esc(p.branch) + '</b> 分支',
      '「' + p.name + '」还有 ' + p.dirty + ' 个文件未提交，停在 ' + p.branch + ' 分支', 'detail', p.path, '查看「' + p.name + '」项目详情'));

  projects.filter(p => p.isGit && p.lastCommitTime)
    .sort((a, b) => (b.lastCommitTime || '').localeCompare(a.lastCommitTime || ''))
    .slice(0, 2)
    .forEach(p => {
      const label = commitWhenLabel(p.lastCommitTime, DATA.meta && DATA.meta.scanTime);
      push('var(--acc)', '「<b>' + esc(p.name) + '</b>」' + esc(label) + '提交："' + esc((p.lastCommitSubject || '').slice(0, 36)) + '"',
        '「' + p.name + '」' + label + '提交："' + (p.lastCommitSubject || '').slice(0, 36) + '"', 'detail', p.path, '查看「' + p.name + '」项目详情');
    });

  const act = DATA.activity || [];
  const today = act[act.length - 1];
  if (today && today.count > 0) {
    // v1.7.20：桶日期未必是「今天」（autoScan=0 时可能是昨天/更早），标签按真实日期计算
    const dayLabel = activityDayLabel(today.date);
    push('var(--green)', dayLabel + ' D:\\code 与 E:\\workspace 下有 <b>' + today.count + '</b> 个文件在动',
      dayLabel + ' D:\\code 与 E:\\workspace 下有 ' + today.count + ' 个文件在动', 'goto', 'recent', '切到「最近」视图');
  }

  // v1.7.17：**只统计磁盘上仍然存在的文件**。
  // 根因：快照里的失效条目（磁盘上已不存在）保留了「删除前」的 mtime，往往比活文件新
  // ⇒ 实测前 40 条里 36 条已失效、且「D:\code\usou」那 34 条**全部已删除**
  // ⇒ 简报每天播报「最近改动集中在 D:\code\usou（34 个文件）」，而那个目录里**一个活文件都没有**
  //   ⇒ 陈述了一个不成立的事实（与 v1.7.15「目录都没了还标未提交」同款）。
  // 修法：复用 v1.7.13 已有的失效集合 RECENT_DEAD（零新增 IPC、零新增状态）剔除失效条目；
  // 若剔除后没有任何存活文件，则**不播报这一条**（没有事实基础，宁缺毋滥）。
  // 注意顺序：**先剔除失效、再取前 40** —— 反过来的话，死条目会先占满窗口，
  // 把真正的活文件挤到窗口外（实测活文件里 20 条在原下标 40 之后 ⇒ 必须先剔除）。
  const liveRecent = (DATA.recent || []).filter(r => !RECENT_DEAD.has(r.path)).slice(0, 40);
  const dirs = {};
  liveRecent.forEach(r => { dirs[r.dir] = (dirs[r.dir] || 0) + 1; });
  const topDir = Object.entries(dirs).sort((a, b) => b[1] - a[1])[0];
  if (topDir && topDir[1] > 1) push('var(--green)', '最近改动集中在 <b>' + esc(shortPath(topDir[0])) + '</b>（' + topDir[1] + ' 个文件）',
    '最近改动集中在 ' + shortPath(topDir[0]) + '（' + topDir[1] + ' 个文件）', 'goto', 'recent', '切到「最近」视图');

  const tight = (DATA.drives || []).slice().sort((a, b) => a.freeGB - b.freeGB)[0];
  if (tight) {
    const dName = esc(tight.name);
    if (tight.freeGB < 40) push('var(--red)', '<b>' + dName + ':</b> 只剩 <span class="warn">' + tight.freeGB + ' GB</span>，建议清理',
      tight.name + ': 只剩 ' + tight.freeGB + ' GB，建议清理', 'open', tight.root, '打开 ' + tight.root + ' 查看空间');
    else push('var(--muted)', '<b>' + dName + ':</b> 空间充足（剩 ' + tight.freeGB + ' GB）',
      tight.name + ': 空间充足（剩 ' + tight.freeGB + ' GB）', 'open', tight.root, '打开 ' + tight.root);
  }

  const top = [...projects].sort((a, b) => b.sizeMB - a.sizeMB)[0];
  if (top && top.sizeMB) push('var(--purple)', '体量最大的是「<b>' + esc(top.name) + '</b>」（' + (top.sizeMB / 1024).toFixed(1) + ' GB）',
    '体量最大的是「' + top.name + '」（' + (top.sizeMB / 1024).toFixed(1) + ' GB）', 'brief:bysize', '', '项目雷达按体量排序');

  // v1.7.19：历史快照读取归一化（新格式绝对路径键 / 旧格式名称键 / 混合快照）统一在 historyDiffItems 内处理。
  // 命中项目有 path 时一律 byPath 精确匹配，绝不回退 name —— 4 个同名 TclLauncher 曾会被错指到错误项目。
  historyDiffItems(HISTORY, projects).forEach(it => push(it.color, it.html, it.text, it.act, it.p, it.tip));
  // 保留 9 条：确保「详情 / 打开磁盘 / 切最近 / 按体量排序」四类动作都在列表内（列表自带滚动，不撑高卡片）
  return out.slice(0, 9);
}

/* v1.7.26：简报文案长开窗口漂移修复 —— 屏幕与复制/导出共用同一份已计算条目。
   lastBriefItems / lastBriefSig 记录屏幕当前渲染所用条目及其文案签名；
   签名 = 各条目 text 以 '|' 拼接（与 briefMarkdown 的纯文本内容同源）。 */
let lastBriefItems = null, lastBriefSig = '';

// 纯函数：把 buildBrief() 的条目渲染为 .d-item.brief-item 行（逐字等价于原内联渲染）
function briefItemsHtml(items) {
  return items.map(it =>
    '<div class="d-item brief-item" data-act="' + esc(it.act) + '" data-p="' + esc(it.p) + '" title="' + esc(it.tip || '点击查看详情') + '">' +
    '<span class="di" style="background:' + it.color + ';color:' + it.color + '"></span>' +
    '<span class="di-text">' + it.html + '</span>' +
    '<span class="di-go" aria-hidden="true">↗</span></div>').join('');
}

// 签名门控的定向更新：文案真的变了才重绘 #daily-list，不触碰其他 DOM、不触发整页 render()。
function refreshBrief() {
  if (!DATA) return false;
  const items = buildBrief();
  const sig = items.map(i => i.text).join('|');
  if (sig === lastBriefSig) return false;
  lastBriefItems = items;
  lastBriefSig = sig;
  const el = $('#daily-list');
  if (el) el.innerHTML = briefItemsHtml(items);
  return true;
}

/* ---------- 简报导出（v1.7.7） ----------
   复制与导出共用同一份 briefMarkdown() 产物 ⇒ 两条通道内容必然一致。
   · 复制走主进程 clipboard（与窗口焦点无关），主进程写完立即 readText() 回读自证
   · 导出走主进程 fs.writeFileSync，落到 Documents\工作台\简报-YYYYMMDD-HHmm.md
   纯本地文本，无外部依赖、无网络请求。 */
let lastBriefCopy = null, lastBriefExport = null;

// Markdown 特殊字符转义：导出文本里可能出现路径/提交主题中的 * _ ` [ ] 等符号
function mdEsc(s) {
  return String(s == null ? '' : s).replace(/([\\`*_[\]<>#])/g, '\\$1').replace(/\r?\n/g, ' ');
}
// 路径用行内代码包裹（反斜杠在代码段内是字面量，无需转义）
function mdPath(s) {
  return '`' + String(s == null ? '' : s).replace(/`/g, '\\`').replace(/\r?\n/g, ' ') + '`';
}
function briefMarkdown() {
  // v1.7.26：导出前先按当前时刻同步一次缓存，屏幕与导出共用同一份条目（杜绝长开窗口文案漂移）
  refreshBrief();
  const items = lastBriefItems || buildBrief();
  const m = (DATA && DATA.meta) || {};
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const now = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  const lines = [];
  lines.push('# 今日机器简报');
  lines.push('');
  lines.push('- 主机：' + mdEsc(m.host || '') + ' · 扫描时间：' + mdEsc(m.scanTime || '') + ' · 导出时间：' + now);
  lines.push('- 条目数：' + items.length);
  lines.push('');
  items.forEach((it, i) => {
    lines.push((i + 1) + '. ' + mdEsc(it.text));
    // 仅对「可跳转的真实路径」附目标行（视图跳转无路径可附）
    if (it.p && (it.act === 'detail' || it.act === 'open')) lines.push('   - 目标：' + mdPath(it.p));
  });
  lines.push('');
  lines.push('---');
  lines.push('由「工作台」本地生成 · 纯规则推导、无 AI 参与 · 数据只读自本机扫描快照');
  return lines.join('\n');
}
async function copyBrief() {
  const md = briefMarkdown();
  try {
    const r = await window.wb.briefCopy(md);
    lastBriefCopy = r || { ok: false };
    if (r && r.ok) toast('简报已复制（' + r.chars + ' 字符）', 'ok');
    else toast('复制失败：' + ((r && r.reason) || '未知错误'), 'err');
  } catch (e) {
    lastBriefCopy = { ok: false, reason: String((e && e.message) || e) };
    toast('复制失败：' + String((e && e.message) || e), 'err');
  }
}
async function exportBrief() {
  const md = briefMarkdown();
  try {
    const r = await window.wb.briefExport(md);
    if (r && r.ok) {
      lastBriefExport = { path: r.path, bytes: r.bytes, chars: r.chars };
      updateBriefExportTip();
      toast('简报已导出：' + r.path, 'ok');
    } else {
      lastBriefExport = { ok: false, reason: (r && r.reason) || '未知错误' };
      toast('导出失败：' + ((r && r.reason) || '未知错误'), 'err');
    }
  } catch (e) {
    lastBriefExport = { ok: false, reason: String((e && e.message) || e) };
    toast('导出失败：' + String((e && e.message) || e), 'err');
  }
}
/* ---------- 每周开发节奏周报（v1.7.35） ----------
   weeklyMarkdown 是纯函数：只读 DATA.activity / HISTORY，不调用 IPC、不写文件、不改任何全局数据。
   复用 mdEsc 做 Markdown 转义、normHistoryProjects 归一化快照项目键，畸形数据一律降级为零值/「无」，绝不抛异常。 */
function weeklyMarkdown() {
  const m = (DATA && DATA.meta) || {};
  const A = Array.isArray(DATA && DATA.activity) ? DATA.activity : [];
  const days = A.slice(-7); // 最近 7 个活动桶（最旧→最新）
  let activeDays = 0, totalFiles = 0, peak = null, maxCount = 0;
  days.forEach(d => {
    const c = (d && Number(d.count)) || 0;
    if (c > 0) activeDays++;
    totalFiles += c;
    if (c > maxCount) { maxCount = c; peak = d; } // 全 0 时 peak 保持 null
  });
  const weekStart = days.length ? String((days[0] && days[0].date) || '') : '';
  const weekEnd = days.length ? String((days[days.length - 1] && days[days.length - 1].date) || '') : '';

  // 本周快照：time（'YYYY-MM-DD HH:mm:ss'）日期部分落在 [weekStart, weekEnd] 内
  const recentSnaps = (Array.isArray(HISTORY) ? HISTORY : []).filter(h => {
    const t = (h && typeof h.time === 'string') ? h.time.slice(0, 10) : '';
    return !!t && (!weekStart || t >= weekStart) && (!weekEnd || t <= weekEnd);
  });
  const snapCount = recentSnaps.length;
  const firstN = snapCount >= 2 ? Object.keys(normHistoryProjects(recentSnaps[0])).length : null;
  const lastN = snapCount >= 2 ? Object.keys(normHistoryProjects(recentSnaps[snapCount - 1])).length : null;
  const projectDelta = (firstN != null && lastN != null) ? (lastN - firstN) : null;

  const lines = [];
  lines.push('# 每周开发节奏周报');
  lines.push('');
  lines.push('- 统计区间：' + mdEsc(weekStart) + ' ~ ' + mdEsc(weekEnd) + '（近 7 天）');
  lines.push('- 数据截至：' + mdEsc(String(m.scanTime || '')) + '（本机扫描快照）');
  lines.push('- 活跃天数：' + activeDays + '/7 · 变动文件合计：' + totalFiles);
  lines.push('- 峰值日：' + (peak ? mdEsc(String(peak.date)) + '（' + mdEsc(String(peak.count)) + ' 个文件）' : '无'));
  lines.push('- 本周快照：' + snapCount + ' 次' + (projectDelta != null ? ' · 收录项目数变化：' + (projectDelta >= 0 ? '+' : '') + projectDelta : ''));
  lines.push('');
  lines.push('## 每日明细');
  lines.push('');
  lines.push('| 日期 | 变动文件 |');
  lines.push('|---|---|');
  days.forEach(d => {
    lines.push('| ' + mdEsc(String((d && d.date) || '')) + ' | ' + ((d && Number(d.count)) || 0) + ' |');
  });
  lines.push('');
  lines.push('---');
  lines.push('由「工作台」本地生成 · 数据源：近 90 天活动桶 + 扫描历史 · 纯规则推导、无 AI 参与 · 数据只读自本机');
  return lines.join('\n');
}
let lastWeeklyExport = null;
async function exportWeekly() {
  const md = weeklyMarkdown();
  try {
    const r = await window.wb.briefExport(md, '周报');
    if (r && r.ok) {
      lastWeeklyExport = { path: r.path, bytes: r.bytes, chars: r.chars };
      toast('周报已导出：' + r.path, 'ok');
    } else {
      lastWeeklyExport = { ok: false, reason: (r && r.reason) || '未知错误' };
      toast('导出失败：' + ((r && r.reason) || '未知错误'), 'err');
    }
  } catch (e) {
    lastWeeklyExport = { ok: false, reason: String((e && e.message) || e) };
    toast('导出失败：' + String((e && e.message) || e), 'err');
  }
}

// 导出落点提示（常驻在简报卡片内，路径可点 → 复用既有 path:show 打开所在文件夹）
function briefExportTipHtml() {
  if (!lastBriefExport || !lastBriefExport.path) return '';
  return '已导出：<span class="bp">' + esc(lastBriefExport.path) + '</span>' +
    ' · <span class="lk" data-act="show" data-p="' + esc(lastBriefExport.path) + '">📂 打开文件夹</span>';
}
function updateBriefExportTip() {
  const el = document.getElementById('brief-export-tip');
  if (el) el.innerHTML = briefExportTipHtml();
}
