'use strict';
/* 格式化工具（v1.7.41 按 nodebestpractices 1.3 抽为独立文件，平铺在 renderer/ 下）
   —— 纯函数、零状态、零 DOM/IPC 依赖，可独立单测。
   与 app.js 同为普通 <script> 顺序加载，函数在同一全局作用域直接可见。 */

function fmtMB(mb) { if (!mb) return '—'; return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB'; }
function fmtSizeKB(kb) {
  if (kb == null) return '—';
  if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB';
  return Math.round(kb) + ' KB';
}
function fmtBytes(b) {
  if (b >= 2 ** 30) return (b / 2 ** 30).toFixed(2) + ' GB';
  if (b >= 2 ** 20) return (b / 2 ** 20).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return Math.round(b) + ' B';
}
/* ---------- v1.7.41：项目体量的「嵌套去重」口径 ----------
   为什么需要：项目根目录的 sizeMB 是「递归统计自己全部内容」，而项目发现规则允许**父目录**与
   **其子目录**同时成为项目（实测存在多层嵌套：父项目 ⊃ 若干子项目）。
   把各项目体量直接相加，会把同一份磁盘字节算两遍
   —— 实测 107.25 GB 里有 5.4 GB 是重复的（5.04%）。
   规则：只累加「不在任何其他项目目录之内」的项目；被包含的项目记入 dupMB。
   三层链（A ⊃ B ⊃ C）同样成立：只计 A，B/C 都算重复（B 的体量已含 C）。
   路径按 Windows 语义比较：\ 与 / 等价、大小写不敏感、忽略结尾分隔符；
   且必须按**路径边界**判断（D:\ab 不是 D:\a 的子目录）。畸形条目不参与统计，绝不抛错。 */
function projPathKey(p) {
  return String(p == null ? '' : p).trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}
function sizeTotals(list) {
  const arr = Array.isArray(list) ? list : [];
  const items = arr.map(p => {
    const mb = Number(p && p.sizeMB);
    return { p: p, key: projPathKey(p && p.path), mb: (isFinite(mb) && mb > 0) ? mb : 0 };
  });
  const rawMB = items.reduce((s, it) => s + it.mb, 0);
  const nested = [];
  items.forEach(it => {
    if (!it.key) return;
    const parent = items.find(o => o !== it && o.key && o.key !== it.key && it.key.indexOf(o.key + '/') === 0);
    if (parent) {
      nested.push({
        path: (it.p && it.p.path) || '', name: (it.p && it.p.name) || '',
        parent: (parent.p && parent.p.path) || '', mb: it.mb
      });
    }
  });
  const dupMB = nested.reduce((s, x) => s + x.mb, 0);
  return { rawMB: rawMB, uniqueMB: Math.max(0, rawMB - dupMB), dupMB: dupMB, nested: nested, count: arr.length };
}
/* 项目名 → 稳定色相（0..359），用于头像底色 */
function hueOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
/* 末两级路径（D:\a\b\c → b\c），用于简报/列表的短路径显示 */
function shortPath(p) { return String(p || '').split('\\').slice(-2).join('\\'); }
/* 时段问候语 */
function greet() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}
/* v1.7.68：重复/相似项目检测（纯函数）——同名、路径嵌套、近似名。
   把历轮巡检用的「数据自证」做成用户可用工具。 */
function findDuplicates(projects) {
  const list = (Array.isArray(projects) ? projects : []).filter(p => p && p.path);
  const groups = {};
  list.forEach(p => { const k = String(p.name || '').trim().toLowerCase(); if (k) (groups[k] = groups[k] || []).push(p); });
  const sameName = Object.keys(groups).map(k => groups[k]).filter(g => g.length > 1);
  const key = p => projPathKey(p.path);
  const nested = [];
  list.forEach(child => {
    const parent = list.find(p => p !== child && key(child).indexOf(key(p) + '/') === 0);
    if (parent) nested.push({ child: child, parent: parent });
  });
  // 近似名：去后缀/大小写后相同，但未同名（如 foo 与 foo-wt）
  const base = n => String(n || '').toLowerCase().replace(/[-_.\s]+(wt|worktree|copy|副本|backup|bak|new|old|\d+)$/, '').trim();
  const bg = {};
  list.forEach(p => { const k = base(p.name); if (k) (bg[k] = bg[k] || []).push(p); });
  const similar = Object.keys(bg).map(k => bg[k]).filter(g => g.length > 1 && new Set(g.map(p => p.name)).size > 1);
  return { sameName: sameName, nested: nested, similar: similar };
}
