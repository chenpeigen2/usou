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
  '.turbo', 'coverage', '.cache', '.tmp_jira', 'worktrees', 'browser_profile',
  'download', 'screenshots', 'node_modules_backup', 'data', 'out'
]);

const PROJECT_MARKERS = ['settings.gradle', 'settings.gradle.kts', 'build.gradle',
  'build.gradle.kts', 'package.json', 'pom.xml', 'pyproject.toml',
  'requirements.txt', 'Cargo.toml', 'go.mod'];

// 通用排除项：构建产物、缓存、系统目录。机器特定的目录名由 settings.scanRoots/forceDirs 配置，不写死在源码里。
const D_ROOT_SKIP = new Set([
  '.gradle', '.pnpm-store', 'uvcache', 'gradle', 'node_modules', 'Temp', 'tmp',
  'download', 'tools', 'work', 'skills', 'Users', 'platform-tools',
  'Program Files', 'Program Files (x86)'
]);

// 强制纳入的目录从 opts.forceDirs（来自 settings.forceDirs）读取 —— 默认空 = 不强制纳入任何目录。
// 这样任何机器上都不会出现「写死别人项目路径」的问题。
function forceDirsOf(opts) {
  const v = opts && opts.forceDirs;
  return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
}
// 要扫描的根目录从 opts.scanRoots 读取 —— 默认空 = 不额外扫描（只扫用户目录）。
function scanRootsOf(opts) {
  const v = opts && opts.scanRoots;
  return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
}

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
// v1.7.30：此前只扫 某项目根目录 与 另一工作区 两个硬编码根，而实际发现 59 个项目 ——
//   21 个在 某项目根目录 下、5 个在 另一工作区 下被覆盖，其余 33 个（某 Web 项目 / launcher 系列等）
//   从未遍历 ⇒ 这些项目的文件改动不进任何活动桶，热力图系统性低估 56% 项目。
//   修：接收已发现的项目根，对不在两基础根之下的额外项目补扫（去重 + 复用 SIZE_EXCLUDE / 深度3）。
async function buildActivity(days, projectRoots) {
  const cutoff = Date.now() - (days - 1) * 86400000; // v1.7.33：与最早桶（now−(days−1)d）对齐，此前 now−days d 会丢第一天边界数据
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
  // 遍历所有已发现的项目根（由调用方传入），不再硬编码任何机器上的基础目录。
  // 去重：跳过彼此嵌套的路径，只遍历最外层，避免重复计数。
  const roots = (projectRoots || []).filter(p => typeof p === 'string' && p);
  const outer = roots.filter(p => !roots.some(q => q !== p && p.startsWith(q.endsWith('\\') ? q : q + '\\')));
  for (const r of outer) await rec(r, 3);
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

async function discoverRoots(opts) {
  // 兼容旧签名（字符串数组 = extraRoots）与新签名（对象 { scanRoots, forceDirs, extraRoots }）
  const o = Array.isArray(opts) ? { extraRoots: opts } : (opts || {});
  const scanRoots = scanRootsOf(o);
  const forceDirs = forceDirsOf(o);
  const extraRoots = Array.isArray(o.extraRoots) ? o.extraRoots : [];
  const roots = [];
  const push = p => { if (p && existsSync(p) && !roots.includes(p)) roots.push(p); };

  // 1) 配置的扫描根（settings.scanRoots）：每个根下的子目录视为项目
  for (const root of scanRoots) {
    for (const e of await safeReaddir(root)) {
      if (e.isDirectory() && !/^[._]/.test(e.name)) push(path.join(root, e.name));
    }
  }
  // 2) 强制纳入的目录（settings.forceDirs）及其下的 git 子目录
  for (const f of forceDirs) {
    push(f);
    for (const e of await safeReaddir(f)) {
      if (e.isDirectory() && existsSync(path.join(f, e.name, '.git'))) push(path.join(f, e.name));
    }
  }
  // 3) 各盘符根目录里带项目标记的目录（通用：枚举已知盘符，不写死某个盘）
  for (const drive of await listDrives()) {
    const base = drive.root || (drive.name ? drive.name + ':\\' : '');
    if (!base) continue;
    for (const e of await safeReaddir(base)) {
      if (!e.isDirectory()) continue;
      if (/^\$|^Config\.Msi|^System Volume/.test(e.name) || D_ROOT_SKIP.has(e.name)) continue;
      const p = path.join(base, e.name);
      if (existsSync(path.join(p, '.git')) || PROJECT_MARKERS.some(m => existsSync(path.join(p, m)))) push(p);
    }
  }
  // 4) 用户目录下的常见项目位置（通用）
  for (const sub of ['AndroidStudioProjects', 'Projects', 'projects', 'code', 'Code', 'workspace', 'Workspace']) {
    const dir = path.join(HOME, sub);
    for (const e of await safeReaddir(dir)) {
      if (e.isDirectory()) push(path.join(dir, e.name));
    }
  }
  // 5) 旧字段 extraRoots 兼容
  for (const p of extraRoots) push(String(p).trim());
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
      // v1.7.32：加深遍历时必须跳过构建产物目录（node_modules/build/dist…），否则候选集被海量依赖文件灌满
      if (SIZE_EXCLUDE.has(e.name.toLowerCase())) continue;
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

// 快捷入口：默认只有用户目录（通用）；额外的快捷方式从 settings.links 配置（不写死在源码里）
const DEFAULT_LINKS = [
  { name: '桌面', path: path.join(HOME, 'Desktop') },
  { name: '文档', path: path.join(HOME, 'Documents') },
  { name: '下载', path: path.join(HOME, 'Downloads') }
];
function linksOf(opts) {
  const extra = opts && opts.links;
  return DEFAULT_LINKS.concat(Array.isArray(extra)
    ? extra.filter(x => x && typeof x.path === 'string' && typeof x.name === 'string')
    : []);
}

async function runScan(opts = {}, onProgress = () => {}) {
  const t0 = Date.now();
  const prog = (phase, current, total, name) => onProgress({ phase, current, total, name });

  prog('drives', 0, 1, '磁盘');
  const drives = await listDrives();

  prog('projects', 0, 0, '发现项目根');
  const roots = await discoverRoots(opts);
  prog('projects', 0, roots.length, '开始');
  const projects = [];
  let doneN = 0;
  let startedN = 0;                       // v1.7.33：已开始处理的项目数（shift 时 +1）
  const totalProjects = roots.length;     // v1.7.33：启动时快照总数，分母恒定、不随并发 shift 回退
  const CONCURRENCY = 4; // 项目级并发：git 与体量统计互相并行，多项目流水线
  async function projWorker() {
    while (roots.length) {
      const r = roots.shift();
      startedN++;
      const name = path.basename(r);
      prog('projects', startedN, totalProjects, name);
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
      prog('projects', startedN, totalProjects, name); // 分子统一用 startedN：单调递增、不因两计数器交替而回退
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
  // v1.7.32：旧代码 levels=1 只收项目**根目录**文件（README/package.json），
  //   看不到 src\ 内层源码（本机真实最近改的 某工作区\workbench-electron\src\scanner.js
  //   藏在第 3 层，旧逻辑与新 levels=2 都够不到），且来源只剩 3 个项目。
  //   改为对基础根深度 4（实测 16232 文件 ~1.5s）+ 项目根深度 4 补扫 33 个外部项目；
  //   addFiles 已跳过 SIZE_EXCLUDE + 临时目录，Top-60 按 mtime 取最新。
  // 遍历所有已发现的项目根（去重后只扫最外层），不硬编码任何机器目录。
  const recentRoots = projects.map(p => p.path).filter(p => typeof p === 'string' && p);
  const recentOuter = recentRoots.filter(p => !recentRoots.some(q => q !== p && p.startsWith(q.endsWith('\\') ? q : q + '\\')));
  for (const r of recentOuter) await addFiles(recent, r, 4);
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
  const links = linksOf(opts).filter(l => existsSync(l.path)).map(l => ({ name: l.name, path: l.path }));

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
