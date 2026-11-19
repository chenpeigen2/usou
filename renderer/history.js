/* 历史快照纯函数（v1.7.19~v1.7.29 建立，v1.7.41 抽为独立文件平铺在 renderer/）。归一化新旧格式快照、趋势统计、前后差异、legacy 标注常量。只依赖 HISTORY（延迟访问）与 esc（调用时已定义），在 app.js 之前加载、全局可见。 */
/* v1.7.19：history.json 快照格式演进 —— 旧快照按「项目名」为键、值 {dirty,sizeMB,commitTime}；
   新快照按「绝对路径」为键、值 {name,dirty,sizeMB,commitTime}。同一 history.json 里两种可共存（混合快照）。
   normHistoryProjects 把任一快照的 projects 统一成 normalizedKey -> {path,name,dirty,sizeMB,commitTime}：
     · 键含 \ 或 / ⇒ 视为路径键：path=键，name=值.name 或路径末段；
     · 否则视为旧名称键：path=值.path 或空，name=值.name 或键本身；
     · normalizedKey 优先用 path，无 path 才用 'name:'+name ⇒ 同名不同路径不会互相覆盖。
   纯函数，畸形条目逐个跳过、绝不抛异常，无历史迁移。 */
/* v1.7.54：单项目历史轨迹 —— 从各快照里抽出该项目的 dirty/sizeMB 变化序列。
   兼容新旧格式（normHistoryProjects 归一），按 path 精确匹配、无 path 时按 name 匹配。 */
function projectTimeline(p, hist) {
  const snaps = Array.isArray(hist) ? hist : (HISTORY || []);
  const key = projPathKey ? projPathKey(p) : String(p || '').toLowerCase();
  const name = String(p || '').split(/[\\/]/).pop();
  const out = [];
  snaps.forEach(s => {
    const map = normHistoryProjects(s);
    const hit = map[key] || Object.values(map).find(x => x && x.name === name);
    if (hit) out.push({ time: s.time || '', dirty: hit.dirty || 0, sizeMB: hit.sizeMB || 0, commitTime: hit.commitTime || '' });
  });
  return out;
}
function timelineHtml(pts) {
  if (!pts.length) return '<div class="hint">该项目暂无历史快照记录（需至少一次扫描后才会有轨迹）。</div>';
  const maxDirty = Math.max(1, ...pts.map(x => x.dirty));
  return '<div class="tl-list">' + pts.map(x => {
    const w = Math.max(2, Math.round((x.dirty / maxDirty) * 100));
    return '<div class="tl-row"><span class="tl-t">' + esc(String(x.time).slice(5, 16)) + '</span>' +
      '<span class="tl-bar"><i style="width:' + w + '%"></i></span>' +
      '<span class="tl-v">' + x.dirty + ' 未提交</span>' +
      '<span class="tl-s">' + esc(fmtMB(x.sizeMB)) + '</span></div>';
  }).join('') + '</div>';
}
/* v1.7.57：任意两次快照的完整对比（供系统页「对比快照」弹窗）。
   返回 {added:[], removed:[], changed:[], same:[]}，每项 {name,dirty,sizeMB}。
   复用 normHistoryProjects 归一化新旧格式，按 path（无则 name:）做键。 */
function snapshotDiff(h1, h2) {
  const a = normHistoryProjects(h1), b = normHistoryProjects(h2);
  const cur = (DATA && DATA.projects) || [];
  // 桥接：旧 name-key（无 path）项若在当前项目里唯一同名，映射到其 path —— 否则同一项目会
  // 被算作「新增+移除」而非「变更」（第 29 轮混合格式问题的延续）。零个/多个同名保持 name: 键，绝不误指。
  const keyOf = (k, e) => {
    if (e && e.path) return e.path;
    const nm = (e && e.name) || k;
    const same = cur.filter(p => p && p.name === nm && p.path);
    return same.length === 1 ? same[0].path : ('name:' + nm);
  };
  const ma = {}, mb = {};
  Object.keys(a).forEach(k => { ma[keyOf(k, a[k])] = a[k]; });
  Object.keys(b).forEach(k => { mb[keyOf(k, b[k])] = b[k]; });
  const item = e => ({ name: e.name || '(未命名)', dirty: e.dirty || 0, sizeMB: e.sizeMB || 0 });
  const added = [], removed = [], changed = [], same = [];
  Object.keys(mb).forEach(k => {
    if (!ma[k]) added.push(item(mb[k]));
    else {
      const x = ma[k], y = mb[k];
      if ((x.dirty || 0) !== (y.dirty || 0) || Math.abs((x.sizeMB || 0) - (y.sizeMB || 0)) > 0.1) {
        changed.push({ name: y.name || x.name, d0: x.dirty || 0, d1: y.dirty || 0, s0: x.sizeMB || 0, s1: y.sizeMB || 0 });
      } else same.push(item(y));
    }
  });
  Object.keys(ma).forEach(k => { if (!mb[k]) removed.push(item(ma[k])); });
  const srt = (x, y) => String(x.name).localeCompare(String(y.name), 'zh-Hans-CN');
  return { added: added.sort(srt), removed: removed.sort(srt), changed: changed.sort(srt), same: same.sort(srt) };
}
function normHistoryProjects(h) {
  const out = {};
  const projects = (h && h.projects) || {};
  let keys = [];
  try { keys = Object.keys(projects); } catch (_e) { keys = []; }
  keys.forEach(k => {
    try {
      const key = String(k);
      const v = projects[k] || {};
      const pathLike = /[\\/]/.test(key);
      const path = pathLike ? key : (v.path ? String(v.path) : '');
      const name = v.name ? String(v.name) : (pathLike ? path.split(/[\\/]/).pop() : key);
      const normalizedKey = path || ('name:' + name);
      out[normalizedKey] = { path: path, name: name, dirty: v.dirty || 0, sizeMB: v.sizeMB || 0, commitTime: v.commitTime || '' };
    } catch (_e) { /* 单块坏数据不影响其余条目：跳过即可 */ }
  });
  return out;
}

/* v1.7.19：快照数组 -> 趋势/QA 共用统计（纯函数）。n=归一化后项目数，dirty=未提交文件数总和。
   v1.7.29：新增 legacy —— 原始快照的项目键若全部为「名称键」（不含 \ 或 /）则为旧格式，
   其 n/dirty 按名去重、可能低于真实值；仅作标注，不改动 n/dirty/totalMB 的计算。 */
function historyStatsFor(hist) {
  return (hist || []).map(h => {
    const norm = normHistoryProjects(h);
    const keys = Object.keys(norm);
    let dirty = 0;
    keys.forEach(k => { dirty += (norm[k].dirty || 0); });
    // 用「原始」快照的 projects 键判定，不能用归一化后的 keys（会把名称键变成 'name:' 前缀）
    let origKeys = [];
    try { origKeys = Object.keys((h && h.projects) || {}); } catch (_e) { origKeys = []; }
    const legacy = origKeys.length > 0 && origKeys.every(k => !/[\\/]/.test(k));
    // v1.7.41：体量走「嵌套去重」同一口径（与总览数字条 / 项目视图统计行一致）。
    //   · 新格式快照带路径 ⇒ 能用 sizeTotals() 去重（覆盖本机 5 对嵌套项目多算的 5.4 GB）；
    //   · 旧格式快照只有名称、没有路径 ⇒ 无法判断包含关系，保留快照里记录的 totalMB（原样、不重算）。
    let totalMB = Number((h && h.totalMB) || 0);
    let dupMB = 0;
    if (!legacy) {
      const t = sizeTotals(keys.map(k => ({ path: norm[k].path, sizeMB: norm[k].sizeMB })));
      totalMB = Math.round(t.uniqueMB);
      dupMB = t.dupMB;
    }
    return { time: (h && h.time) || '', fast: !!(h && h.fast), n: keys.length, dirty, totalMB, dupMB, legacy };
  });
}
function historyStats() {
  return historyStatsFor(HISTORY);
}

/* v1.7.19：前后两次快照的项目差异 -> 简报 push 参数数组（最多 2 条，纯函数）。
   命中项目只要带 path 就只走 byPath 精确匹配，绝不回退 byName（同名项目会错指）。
   v1.7.23：修复 name-key→path-key 过渡期的匹配断裂 —— 归一化条目先按「身份」键化再匹配，
   令旧名称键快照能桥接到当前同路径项目；零/多个同名绝不猜归属，保留 'name:' 键。 */
function historyDiffItems(hist, projects) {
  const out = [];
  const arr = hist || [];
  if (arr.length < 2) return out;
  const prev = normHistoryProjects(arr[arr.length - 2]);
  const cur = normHistoryProjects(arr[arr.length - 1]);
  const list = projects || [];
  const byPath = p => list.find(x => x && x.path === p);
  const byName = n => list.find(x => x && x.name === n);
  // 纯函数身份解析器：有 path 直接用 path；旧名称键桥接到「唯一同名且带路径」的当前项目；
  // 零个或多个同名（如 4 个 同名项目）退回 'name:'+name，绝不把变更错指到某个同名项目。
  const identityOf = e => {
    if (!e) return '';
    if (e.path) return e.path;
    const sameName = list.filter(p => p && p.name === e.name && p.path);
    if (sameName.length === 1) return sameName[0].path;
    return 'name:' + e.name;
  };
  const mapById = norm => {
    const m = {};
    Object.values(norm).forEach(e => {
      const id = identityOf(e);
      if (id) m[id] = e;
    });
    return m;
  };
  const prevById = mapById(prev);
  const curById = mapById(cur);
  let diffN = 0;
  Object.keys(curById).forEach(key => {
    if (diffN >= 2) return;
    const pp = prevById[key];
    if (!pp) return;
    const cc = curById[key];
    // 身份为 path（含桥接补出的 path）走 byPath；仅遗留 'name:' 身份保留旧 byName 回退。
    const hit = key.indexOf('name:') === 0 ? byName(cc.name) : byPath(key);
    const hAct = hit ? 'detail' : 'goto';
    const hP = hit ? hit.path : 'projects';
    const hTip = hit ? '查看「' + cc.name + '」项目详情' : '切到「项目」视图';
    // v1.7.17：比上一次的提交时间 pp.commitTime（同维度）；!pp.commitTime 覆盖「上次还没有提交」。
    if (cc.commitTime && (!pp.commitTime || cc.commitTime > pp.commitTime)) {
      out.push({ color: 'var(--acc)', html: '与上次扫描相比，「<b>' + esc(cc.name) + '</b>」有新提交',
        text: '与上次扫描相比，「' + cc.name + '」有新提交', act: hAct, p: hP, tip: hTip }); diffN++;
    } else if (cc.dirty > pp.dirty) {
      out.push({ color: 'var(--amber)', html: '与上次扫描相比，「<b>' + esc(cc.name) + '</b>」未提交 +' + (cc.dirty - pp.dirty),
        text: '与上次扫描相比，「' + cc.name + '」未提交 +' + (cc.dirty - pp.dirty), act: hAct, p: hP, tip: hTip }); diffN++;
    }
  });
  return out;
}
/* v1.7.29：旧格式（按项目名存储）快照提示文案 —— 角标 / 说明 / QA 共用常量，避免文案漂移。
   v1.7.41：补一句体量口径 —— 旧快照无路径、无法判断项目包含关系 ⇒ 体量只能保留当时记录的
   「各项目直接相加」，而新快照与总览/项目视图已按父级去重 ⇒ 两者口径不同必须说明。 */
const HIST_LEGACY_BADGE = '旧格式·名称去重';
const HIST_LEGACY_NOTE = '⚠ 旧格式快照（按项目名存储）：项目数/未提交数可能低于真实值；体量为当时各项目直接相加（未去嵌套）。v1.7.41 起新快照的体量按父级去重，与总览/项目视图同口径。仅供趋势参考。';
