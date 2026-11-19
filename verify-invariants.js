'use strict';
/* 数据不变量自检（v1.7.52）：用 Node 独立加载 renderer/format.js 的纯函数，
   对 scan-cache.json 做数学自证——把第 109 轮「嵌套体积重复计数」类回归做成自动化守卫。
   零依赖、只读、不改任何数据文件。退出码 0=全过，1=有失败。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const APP = __dirname;
const src = fs.readFileSync(path.join(APP, 'renderer', 'format.js'), 'utf8');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\n;this.__T = sizeTotals; this.__K = projPathKey;', ctx);
const T = ctx.__T, K = ctx.__K;
const cache = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'scan-cache.json'), 'utf8'));
const projects = cache.projects || [];
const t = T(projects);
const fails = [];
function chk(name, ok, detail) { console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ' — ' + detail : '')); if (!ok) fails.push(name); }

chk('raw ≥ unique', t.rawMB >= t.uniqueMB, 'raw=' + t.rawMB.toFixed(1) + ' uniq=' + t.uniqueMB.toFixed(1));
chk('dup = raw - unique', Math.abs((t.rawMB - t.uniqueMB) - t.dupMB) < 0.01, 'dup=' + t.dupMB.toFixed(1));
chk('count = 项目数', t.count === projects.length, 'count=' + t.count + ' / projects=' + projects.length);
chk('nested 数 ≤ 项目数', t.nested.length <= projects.length, 'nested=' + t.nested.length);
// 每个 nested 项的父路径必须是某个非嵌套项目
const nestedPaths = new Set(t.nested.map(n => K(n.path)));
const topKeys = new Set(projects.map(p => K(p.path)).filter(k => k && !nestedPaths.has(k)));
const parentsOk = t.nested.every(n => n.parent && topKeys.has(K(n.parent)));
chk('每个嵌套项有顶层父项目', parentsOk, 'topKeys=' + topKeys.size);
// 路径边界：D:\a 不算 D:\ab 的子目录
const edge = T([{ path: 'D:\\a', sizeMB: 2000 }, { path: 'D:\\ab', sizeMB: 1000 }]);
chk('路径边界（ab 非 a 子目录）', edge.nested.length === 0, 'nested=' + edge.nested.length);

console.log(fails.length ? '✘ 数据不变量失败 ' + fails.length + ' 项: ' + fails.join(', ') : '✔ 数据不变量全过');
process.exit(fails.length ? 1 : 0);
