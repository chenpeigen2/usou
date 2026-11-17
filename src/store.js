'use strict';
// 数据持久化：扫描缓存 + 设置。
// 位置策略：开发态用应用旁 data\（透明可删）；打包态(asar 只读)自动落到 userData。
const fs = require('fs');
const path = require('path');

const FORMAT = 2; // 缓存结构版本，不匹配即视为无缓存

let _dir = null;
function dataDir() {
  if (_dir) return _dir;
  let packaged = false;
  try { packaged = require('electron').app.isPackaged; } catch (_e) { /* 无 electron（无头脚本） */ }
  const local = path.join(__dirname, '..', 'data');
  if (!packaged) {
    try { fs.mkdirSync(local, { recursive: true }); _dir = local; } catch (_e) { _dir = null; }
  }
  if (!_dir) {
    try {
      _dir = require('electron').app.getPath('userData');
      fs.mkdirSync(_dir, { recursive: true });
    } catch (_e2) {
      _dir = local;
      try { fs.mkdirSync(_dir, { recursive: true }); } catch (_e3) { /* 放弃 */ }
    }
  }
  return _dir;
}

function read(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_e) { return null; } }
function write(f, o) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o));
  fs.renameSync(tmp, f);
}

const DEFAULTS = { skipSizes: false, extraRoots: [], trayMinimize: true, autoScanHours: 0, winBounds: null, winMaximized: false, favorites: [], theme: 'dark' }; // autoScanHours: 自动扫描间隔（小时），0=关闭；favorites: 项目绝对路径数组（收藏/置顶）；theme: 'dark'|'light'（v1.7.8 浅色主题，旧配置无此键即回落深色）

function getScan() {
  const c = read(path.join(dataDir(), 'scan-cache.json'));
  return (c && c.format === FORMAT) ? c : null;
}
function setScan(data) { write(path.join(dataDir(), 'scan-cache.json'), Object.assign({}, data, { format: FORMAT })); }
function getSettings() { return Object.assign({}, DEFAULTS, read(path.join(dataDir(), 'settings.json')) || {}); }
function setSettings(s) {
  const next = Object.assign(getSettings(), s || {});
  write(path.join(dataDir(), 'settings.json'), next);
  return next;
}

// 扫描历史：保留最近 60 次快照摘要，供「今日简报」做对比叙事
function appendHistory(data) {
  const f = path.join(dataDir(), 'history.json');
  const arr = read(f) || [];
  arr.push({
    time: data.meta.scanTime,
    fast: !!data.meta.fast,
    totalMB: Math.round(data.projects.reduce((s, p) => s + (p.sizeMB || 0), 0)),
    // v1.7.19 改用绝对路径作 key（唯一）：此前按 name 作 key，4 个同名 TclLauncher 被 reduce 后写覆盖、只剩最旧一个，致历史快照项目数/dirty 数少于扫描缓存；旧快照仍是 name-keyed，读取侧已做归一化兼容。
    projects: data.projects.reduce((o, p) => {
      const key = p.path || ('name:' + p.name);
      o[key] = { name: p.name, dirty: p.dirty || 0, sizeMB: p.sizeMB || 0, commitTime: p.lastCommitTime || '' };
      return o;
    }, {})
  });
  while (arr.length > 60) arr.shift();
  write(f, arr);
  return arr;
}
function getHistory() { return read(path.join(dataDir(), 'history.json')) || []; }

// 扫描/分析错误诊断：持久化到 scan-errors.json，供设置页事后可查（不再只有一闪而过的 toast）
const SCAN_ERRORS_MAX = 50;
function getScanErrors() {
  const a = read(path.join(dataDir(), 'scan-errors.json'));
  return Array.isArray(a) ? a : [];
}
function appendScanError(kind, message) {
  const arr = getScanErrors();
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const time = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  arr.push({ time, kind: String(kind || '扫描'), message: String(message == null ? '' : message).slice(0, 800) });
  while (arr.length > SCAN_ERRORS_MAX) arr.shift();
  write(path.join(dataDir(), 'scan-errors.json'), arr);
  return arr;
}
function clearScanErrors() {
  write(path.join(dataDir(), 'scan-errors.json'), []);
  return [];
}

module.exports = { getScan, setScan, getSettings, setSettings, getHistory, appendHistory, getScanErrors, appendScanError, clearScanErrors, dataDir };
