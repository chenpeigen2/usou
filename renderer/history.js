/* 历史快照纯函数（v1.7.19~v1.7.29 建立，v1.7.41 抽为独立文件平铺在 renderer/）。归一化新旧格式快照、趋势统计、前后差异、legacy 标注常量。只依赖 HISTORY（延迟访问）与 esc（调用时已定义），在 app.js 之前加载、全局可见。 */
/* v1.7.19：history.json 快照格式演进 —— 旧快照按「项目名」为键、值 {dirty,sizeMB,commitTime}；
   新快照按「绝对路径」为键、值 {name,dirty,sizeMB,commitTime}。同一 history.json 里两种可共存（混合快照）。
   normHistoryProjects 把任一快照的 projects 统一成 normalizedKey -> {path,name,dirty,sizeMB,commitTime}：
     · 键含 \ 或 / ⇒ 视为路径键：path=键，name=值.name 或路径末段；
     · 否则视为旧名称键：path=值.path 或空，name=值.name 或键本身；
     · normalizedKey 优先用 path，无 path 才用 'name:'+name ⇒ 同名不同路径不会互相覆盖。
   纯函数，畸形条目逐个跳过、绝不抛异常，无历史迁移。 */
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
    return { time: (h && h.time) || '', fast: !!(h && h.fast), n: keys.length, dirty, totalMB: (h && h.totalMB) || 0, legacy };
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
/* v1.7.29：旧格式（按项目名存储）快照提示文案 —— 角标 / 说明 / QA 共用常量，避免文案漂移 */
const HIST_LEGACY_BADGE = '旧格式·名称去重';
const HIST_LEGACY_NOTE = '⚠ 旧格式快照（按项目名存储）的项目数/未提交数可能低于真实值，仅供趋势参考；体量为全量统计。';
