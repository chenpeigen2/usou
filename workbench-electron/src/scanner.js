'use strict';
// 本机扫描器：磁盘 / 项目雷达 / git 元数据 / 体量 / 最近动态 / 工具链
// 纯 Node 内置模块实现（scan.ps1 的移植版），全部操作只读。
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');

const HOME = os.homedir();
const GIT_FALLBACK = 'C:\\Program Files\\Git\\cmd\\git.exe';

// 体量统计时排除的目录名（统计"源码体量"，不含构建产物）
const SIZE_EXCLUDE = new Set([
  'node_modules', 'build', '.gradle', '.git', 'dist', '.next', 'target',
  '__pycache__', '.venv', 'venv', '.idea', '.kotlin', '.tmp', 'uvcache',
  'obj', 'bin', '.codegraph', '.dart_tool', 'pods', '.pnpm-store',
  '.turbo', 'coverage', '.cache'
]);

const PROJECT_MARKERS = ['settings.gradle', 'settings.gradle.kts', 'build.gradle',
  'build.gradle.kts', 'package.json', 'pom.xml', 'pyproject.toml',
  'requirements.txt', 'Cargo.toml', 'go.mod'];

const D_ROOT_SKIP = new Set([
  '.gradle', '.pnpm-store', 'uvcache', 'gradle', 'node_modules', 'Temp', 'tmp',
  'download', 'code', 'tools', 'work', 'skills', 'Users', 'platform-tools',
  'Snipaste-2.11.3-x64', 'proguard-7.9.1', 'dagger-dagger-2.60.1', 'nextjs',
  'android-studio-quail4-windows', 'GradleUserHome', 'GradleCache-TclLauncher',
  '归档整理_20261105', 'Program Files', 'Program Files (x86)'
]);

const FORCE_DIRS = ['D:\\CLAUNCER2', 'D:\\CLauncher', 'D:\\BBKLauncher',
  'D:\\VClauncher', 'D:\\oppo_a6_launcher', 'D:\\LauncherSwipeDetect', 'D:\\TclLauncher'];

const AI_CANDIDATES = [
  '.claude', '.codex', '.codebuddy', '.codebuddycn', '.cursor', '.qoder', '.qoder-cn',
  '.kimi-code', '.kimi-work', '.kimi-webbridge', '.trae-cn', '.zcode', '.copilot',
  '.minimax', '.qwenworkcn', '.jugg', '.pi', '.mavis', '.workbuddy', '.workbuddy-ai',
  '.qmind', '.codegraph', '.tlink', '.tmeet', '.loongsuite-pilot', '.agent-browser',
  '.dsh', '.qoderwork'
];

/* ---------- 小工具 ---------- */

function existsSync(p) { try { fs.accessSync(p); return true; } catch (_e) { return false; } }
async function safeReaddir(dir) {
  try { return await fsp.readdir(dir, { withFileTypes: true }); } catch (_e) { return []; }
}
function r1(n) { return Math.round(n * 10) / 10; }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function execP(cmd, opts = {}) {
  return new Promise(res => {
    exec(cmd, { windowsHide: true, timeout: opts.timeout || 15000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => res({ err, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() }));
  });
}
function execFileP(file, args, opts = {}) {
  return new Promise(res => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout || 20000, maxBuffer: opts.maxBuffer || 16 * 1024 * 1024 },
      (err, stdout, stderr) => res({ err, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() }));
  });
}

/* ---------- git ---------- */

let GIT = null;
async function resolveGit() {
  if (GIT) return GIT;
  const r = await execFileP('git', ['--version'], { timeout: 8000 });
  GIT = r.err ? GIT_FALLBACK : 'git';
  return GIT;
}

async function gitInfo(root) {
  const git = await resolveGit();
  const br = await execFileP(git, ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 15000 });
  const branch = (br.stdout || '').trim();
  if (!branch) return null;
  const log = await execFileP(git, ['-C', root, 'log', '-1', '--format=%ci|%s'], { timeout: 15000 });
  let commitTime = '', commitSubject = '';
  const line = (log.stdout || '').trim();
  if (line) {
    const i = line.indexOf('|');
    if (i > 0) { commitTime = line.slice(0, i); commitSubject = line.slice(i + 1); }
  }
  const st = await execFileP(git, ['-C', root, 'status', '--porcelain', '-uno'], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  const dirtyFiles = (st.stdout || '').split('\n').map(s => s.trimEnd()).filter(s => s.trim());
  return { branch, commitTime, commitSubject, dirty: dirtyFiles.length, dirtyFiles: dirtyFiles.slice(0, 300) };
}

async function gitDetail(root) {
  const info = await gitInfo(root);
  if (!info) return null;
  const git = await resolveGit();
  const [log, branches] = await Promise.all([
    execFileP(git, ['-C', root, 'log', '--pretty=format:%ci|%s', '-12'], { timeout: 20000 }),
    execFileP(git, ['-C', root, 'branch', '--list', '--format=%(refname:short)'], { timeout: 20000 })
  ]);
  info.log = (log.stdout || '').split('\n').filter(Boolean).map(l => {
    const i = l.indexOf('|');
    return { time: i > 0 ? l.slice(0, 19) : '', subject: i > 0 ? l.slice(i + 1) : l };
  });
  info.branches = (branches.stdout || '').split('\n').filter(Boolean).slice(0, 60);
  return info;
}

/* ---------- 体量统计 / 空间分析 ---------- */

async function walkSize(dir, exclude) {
  let bytes = 0, files = 0;
  async function rec(d) {
    const entries = await safeReaddir(d);
    const subdirs = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (exclude && exclude.has(e.name.toLowerCase())) continue;
        subdirs.push(full);
      } else if (e.isFile()) {
        try { const st = await fsp.stat(full); bytes += st.size; files++; } catch (_e) { /* skip */ }
      }
    }
    if (subdirs.length) await Promise.all(subdirs.map(rec)); // 目录树并发下钻，配合扩容的线程池
  }
  await rec(dir);
  return { bytes, files };
}

// 空间分析：统计 root 下每个直接子项的完整大小（不排除任何目录）
async function analyze(root, onProgress = () => {}) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const items = [];
  let done = 0;
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isSymbolicLink()) {
      items.push({ name: e.name, path: full, isDir: false, reparse: true, size: 0, files: 0 });
    } else if (e.isDirectory()) {
      const r = await walkSize(full, null);
      items.push({ name: e.name, path: full, isDir: true, size: r.bytes, files: r.files });
    } else if (e.isFile()) {
      let s = 0;
      try { s = (await fsp.stat(full)).size; } catch (_e) { /* skip */ }
      items.push({ name: e.name, path: full, isDir: false, size: s, files: 1 });
    }
    onProgress({ done: ++done, total: entries.length, name: e.name });
  }
  items.sort((a, b) => b.size - a.size);
  const totalSize = items.reduce((s, i) => s + i.size, 0);
  return { root, totalSize, items };
}

// 活动热力：聚合目录下近 N 天每日变动文件数（限深 3 层，排除构建产物目录）
// v1.7.30：此前只扫 D:\code 与 E:\workspace 两个硬编码根，而实际发现 59 个项目 ——
//   21 个在 D:\code 下、5 个在 E:\workspace 下被覆盖，其余 33 个（fcm-helper / launcher 系列等）
//   从未遍历 ⇒ 这些项目的文件改动不进任何活动桶，热力图系统性低估 56% 项目。
//   修：接收已发现的项目根，对不在两基础根之下的额外项目补扫（去重 + 复用 SIZE_EXCLUDE / 深度3）。
async function buildActivity(days, projectRoots) {
  const cutoff = Date.now() - days * 86400000;
  const map = new Map();
  async function rec(dir, depth) {
    const ents = await safeReaddir(dir);
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SIZE_EXCLUDE.has(e.name.toLowerCase())) continue;
        if (depth > 0) await rec(full, depth - 1);
      } else if (e.isFile()) {
        const st = await fsp.stat(full).catch(() => null);
        if (!st) continue;
        const t = st.mtime.getTime();
        if (t < cutoff) continue;
        const d = new Date(t);
        const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
  }
  const BASE = ['D:\\code', 'E:\\workspace'];
  for (const r of BASE) await rec(r, 3);
  // 补扫：项目根不在两基础根之下（避免重复遍历 D:\code\* 与 E:\workspace\* 下的 26 个项目）
  const seen = BASE.slice();
  for (const pr of (projectRoots || [])) {
    if (!pr || typeof pr !== 'string') continue;
    const p = String(pr);
    if (seen.some(s => p === s || p.startsWith(s + '\\') || p.startsWith(s + '/'))) continue;
    seen.push(p);
    await rec(p, 3);
  }
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    out.push({ date: key, count: map.get(key) || 0 });
  }
  return out;
}

/* ---------- 项目发现 ---------- */

function detectType(p) {
  const has = n => existsSync(path.join(p, n));
  if (has('settings.gradle') || has('settings.gradle.kts') || has('build.gradle') || has('build.gradle.kts')) return 'Android';
  if (has('package.json')) return 'Web';
  if (has('pom.xml')) return 'Java';
  if (has('Cargo.toml')) return 'Rust';
  if (has('go.mod')) return 'Go';
  if (has('pyproject.toml') || has('requirements.txt')) return 'Python';
  return null;
}

async function discoverRoots(extraRoots) {
  const roots = [];
  const push = p => { if (p && existsSync(p) && !roots.includes(p)) roots.push(p); };

  for (const e of await safeReaddir('D:\\code')) {
    if (e.isDirectory() && !/^[._]/.test(e.name) && e.name !== '新建文件夹' && e.name !== 'usou') {
      push(path.join('D:\\code', e.name));
    }
  }
  for (const e of await safeReaddir('D:\\')) {
    if (!e.isDirectory()) continue;
    if (/^\$|^Config\.Msi|^System Volume/.test(e.name) || D_ROOT_SKIP.has(e.name)) continue;
    const p = path.join('D:\\', e.name);
    if (existsSync(path.join(p, '.git')) || PROJECT_MARKERS.some(m => existsSync(path.join(p, m)))) push(p);
  }
  for (const f of FORCE_DIRS) {
    push(f);
    for (const e of await safeReaddir(f)) {
      if (e.isDirectory() && existsSync(path.join(f, e.name, '.git'))) push(path.join(f, e.name));
    }
  }
  for (const e of await safeReaddir('E:\\workspace')) {
    if (e.isDirectory()) push(path.join('E:\\workspace', e.name));
  }
  for (const e of await safeReaddir(path.join(HOME, 'AndroidStudioProjects'))) {
    if (e.isDirectory()) push(path.join(HOME, 'AndroidStudioProjects', e.name));
  }
  for (const p of (extraRoots || [])) push(String(p).trim());
  return roots;
}

/* ---------- 最近动态 / 常用文件夹 ---------- */

async function addFiles(list, dir, levels) {
  for (const e of await safeReaddir(dir)) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      const st = await fsp.stat(full).catch(() => null);
      if (st) list.push({ name: e.name, dir, path: full, sizeKB: r1(st.size / 1024), mtime: fmtDate(st.mtime) });
    } else if (e.isDirectory() && levels > 0) {
      await addFiles(list, full, levels - 1);
    }
  }
}

async function userFoldersSnapshot() {
  const out = {};
  for (const n of ['Desktop', 'Documents', 'Downloads']) {
    const dir = path.join(HOME, n);
    const ents = await safeReaddir(dir);
    const withTime = [];
    for (const e of ents) {
      const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      if (st) withTime.push({ e, st });
    }
    withTime.sort((a, b) => b.st.mtime - a.st.mtime);
    out[n] = {
      count: ents.length,
      items: withTime.slice(0, 15).map(({ e, st }) => ({
        name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory(),
        sizeKB: e.isDirectory() ? null : r1(st.size / 1024),
        mtime: fmtDate(st.mtime).slice(0, 16)
      }))
    };
  }
  return out;
}

/* ---------- 磁盘 / 工具 / 能力 ---------- */

async function listDrives() {
  const out = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = letter + ':\\';
    if (!existsSync(root)) continue;
    try {
      const s = await fsp.statfs(root);
      const total = s.blocks * s.bsize;
      const free = s.bfree * s.bsize;
      if (total <= 0) continue;
      out.push({ name: letter, root, totalGB: r1(total / 2 ** 30), usedGB: r1((total - free) / 2 ** 30), freeGB: r1(free / 2 ** 30) });
    } catch (_e) { /* 不可读盘跳过 */ }
  }
  return out;
}

let CAPS = null;
async function capabilities() {
  if (CAPS) return CAPS;
  const [code, wt] = await Promise.all([execP('where code', { timeout: 8000 }), execP('where wt', { timeout: 8000 })]);
  CAPS = {
    vscode: !code.err && !!code.stdout.trim(),
    wt: !wt.err && !!wt.stdout.trim()
  };
  return CAPS;
}

/* v1.7.14：打开路径链路的**失效保护**（与 v1.7.13 的 path:open / path:show 同根因）。
   探针实测（修前）：
     · openIn(<缺失>, 'vscode')    → **照样 spawn** `cmd.exe /c code "<缺失>"`，却回报 {ok:true}
     · openIn(<缺失>, 'terminal') → **照样 spawn** `wt.exe -d <缺失>`，却回报 {ok:true}
     · openIn(<缺失>, 默认兜底)  → 直调 shell.openPath(<缺失>) ⇒ 命中「Promise 永不落地 + 原生模态弹窗」
   ⇒ 用户桌面上会弹出 **VS Code / Windows Terminal 自己的报错窗**，而工作台**一句话都不说**
     （渲染层 `if (!r.ok) toast(...)` 永不触发）⇒ 纯静默失败。
   修法：**入口统一判存在性** —— 缺失直接返回 {ok:false, msg}，**不 spawn、不调 shell**；
        存在时行为完全不变。存在性判断放在 capabilities() 之前（更快的本地检查，
        且失效路径不必再付出两个 `where code` / `where wt` 子进程的代价）。 */
const OPEN_IN_TIMEOUT = 15000;   // 兜底分支：路径存在但系统打不开时的上限（与 main.js 的 path:open 同口径）

async function openIn(p, mode) {
  // ① 路径本身无效（非字符串 / 空）
  if (typeof p !== 'string' || !p.trim()) return { ok: false, msg: '路径无效' };
  // ② 路径在磁盘上已不存在 —— **不 spawn、不调 shell**（避免拉起外部程序的报错窗 / 原生模态框）
  if (!existsSync(p)) return { ok: false, msg: '路径已不存在（可能已被删除或移动）' };
  if (mode === 'vscode') {
    const caps = await capabilities();
    if (!caps.vscode) return { ok: false, msg: '未找到 VS Code（code CLI）' };
    spawn('cmd.exe', ['/c', 'code', '"' + p + '"'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  if (mode === 'terminal') {
    const caps = await capabilities();
    if (caps.wt) {
      spawn('wt.exe', ['-d', p], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    } else {
      spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', 'cd /d "' + p + '"'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    }
    return { ok: true };
  }
  // ③ 默认兜底：路径**已确认存在**才调 shell（修前是未经判断直调 ⇒ 命中「Promise 永不落地」）
  //    再加 Promise.race 超时兜底（与 main.js 的 path:open 同款：路径存在但系统打不开时不至于永远挂着）
  let timer = null;
  try {
    const r = await Promise.race([
      require('electron').shell.openPath(p),
      new Promise(res => { timer = setTimeout(() => res('__TIMEOUT__'), OPEN_IN_TIMEOUT); })
    ]);
    if (r === '__TIMEOUT__') return { ok: false, msg: '打开超时（系统无响应）' };
    return { ok: !r, msg: r || '' };
  } catch (e) {
    return { ok: false, msg: '打开失败' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------- 主扫描流程 ---------- */

const LINK_PATHS = [
  { name: '桌面', path: path.join(HOME, 'Desktop') },
  { name: '文档', path: path.join(HOME, 'Documents') },
  { name: '下载', path: path.join(HOME, 'Downloads') },
  { name: 'D:\\code 项目群', path: 'D:\\code' },
  { name: 'TclLauncher 主仓库', path: 'D:\\TclLauncher' },
  { name: 'CLAUNCER2 工作区', path: 'D:\\CLAUNCER2' },
  { name: 'D:\\tools 工具', path: 'D:\\tools' },
  { name: 'D:\\download 下载', path: 'D:\\download' },
  { name: '归档整理_20261105', path: 'D:\\归档整理_20261105' },
  { name: 'E:\\workspace', path: 'E:\\workspace' },
  { name: 'E:\\launcher_hprof 内存分析', path: 'E:\\launcher_hprof' },
  { name: 'E:\\android-development-docs', path: 'E:\\android-development-docs' },
  { name: 'E:\\WorkBuddy Worksapace 日报', path: 'E:\\WorkBuddy Worksapace' },
  { name: 'F:\\TCL_Layout_Toolv0.6', path: 'F:\\TCL_Layout_Toolv0.6' },
  { name: 'F:\\CDriveData C盘迁移数据', path: 'F:\\CDriveData' },
  { name: 'C:\\TCL', path: 'C:\\TCL' }
];

async function runScan(opts = {}, onProgress = () => {}) {
  const t0 = Date.now();
  const prog = (phase, current, total, name) => onProgress({ phase, current, total, name });

  prog('drives', 0, 1, '磁盘');
  const drives = await listDrives();

  prog('projects', 0, 0, '发现项目根');
  const roots = await discoverRoots(opts.extraRoots);
  prog('projects', 0, roots.length, '开始');
  const projects = [];
  let doneN = 0;
  const CONCURRENCY = 4; // 项目级并发：git 与体量统计互相并行，多项目流水线
  async function projWorker() {
    while (roots.length) {
      const r = roots.shift();
      const name = path.basename(r);
      prog('projects', doneN + 1, roots.length + doneN + 1, name);
      const [gi, size] = await Promise.all([
        gitInfo(r),
        opts.skipSizes ? Promise.resolve({ bytes: 0, files: 0 }) : walkSize(r, SIZE_EXCLUDE)
      ]);
      const st = await fsp.stat(r).catch(() => null);
      let type = detectType(r);
      if (!type) {
        const ents = await safeReaddir(r);
        const mds = ents.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md')).length;
        type = mds >= 3 ? '文档' : '其他';
      }
      projects.push({
        name, path: r, type,
        isGit: !!gi,
        branch: gi ? gi.branch : '',
        lastCommitTime: gi ? gi.commitTime : '',
        lastCommitSubject: gi ? gi.commitSubject : '',
        dirty: gi ? gi.dirty : 0,
        sizeMB: r1(size.bytes / 2 ** 20),
        fileCount: size.files,
        rootMTime: st ? fmtDate(st.mtime) : ''
      });
      doneN++;
      prog('projects', doneN, roots.length + doneN, name);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, projWorker));

  prog('activity', 0, 1, '活动统计');
  const activity = await buildActivity(90, projects.map(p => p.path));

  prog('recent', 0, 1, '最近动态');
  const recent = [];
  await addFiles(recent, path.join(HOME, 'Desktop'), 1);
  await addFiles(recent, path.join(HOME, 'Documents'), 1);
  await addFiles(recent, path.join(HOME, 'Downloads'), 0);
  await addFiles(recent, 'D:\\code', 1);
  await addFiles(recent, 'E:\\workspace', 1);
  recent.sort((a, b) => b.mtime.localeCompare(a.mtime));
  recent.length = Math.min(recent.length, 60);

  prog('folders', 0, 1, '常用文件夹');
  const userFolders = await userFoldersSnapshot();

  prog('tools', 0, 1, '工具链');
  const tools = [];
  for (const t of ['git', 'node', 'npm', 'pnpm', 'python', 'java', 'adb']) {
    const flag = t === 'adb' ? 'version' : (t === 'java' ? '-version' : '--version');
    const r = await execP(t + ' ' + flag, { timeout: 20000 });
    const v = ((r.stdout || '') + '\n' + (r.stderr || '')).split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || '';
    const where = await execP('where ' + t, { timeout: 8000 });
    const wpath = (where.stdout || '').split(/\r?\n/).filter(Boolean)[0] || '';
    if (v || wpath) tools.push({ name: t, version: v, path: wpath });
  }

  const aiTools = AI_CANDIDATES.filter(a => existsSync(path.join(HOME, a)));
  const links = LINK_PATHS.filter(l => existsSync(l.path)).map(l => ({ name: l.name, path: l.path }));

  const meta = {
    host: os.hostname(),
    user: os.userInfo().username,
    os: os.type() + ' ' + os.release(),
    arch: os.arch(),
    cpu: (os.cpus()[0] || {}).model || '',
    ramTotalGB: r1(os.totalmem() / 2 ** 30),
    ramFreeGB: r1(os.freemem() / 2 ** 30),
    bootTime: fmtDate(new Date(Date.now() - os.uptime() * 1000)),
    scanTime: fmtDate(new Date()),
    durationSec: Math.round((Date.now() - t0) / 100) / 10,
    fast: !!opts.skipSizes
  };

  return { meta, drives, projects, activity, recent, userFolders, tools, aiTools, links };
}

module.exports = { runScan, analyze, gitInfo, gitDetail, capabilities, openIn };
