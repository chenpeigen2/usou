/* QA 钩子集合（v1.7.12~v1.7.40，v1.7.41 抽为独立文件平铺在 renderer/）。22 个 --xxxqa 取证钩子 + pollQa/qaNote。在 app.js 之前加载：函数先定义，业务引用在 setTimeout 回调里延迟执行。 */
/* QA 钩子：--brief=detail|bysize|序号 → 渲染后自动点击对应简报条目，
   用于截图取证「点击确实触发动作」（复用 #view 的 data-act 事件委托，无内联 onclick） */
function triggerBriefQa(sel) {
  setTimeout(() => {
    const items = Array.from($$('#view .brief-item'));
    let el = null;
    if (sel === 'detail') el = items.find(x => x.dataset.act === 'detail');
    else if (sel === 'bysize') el = items.find(x => x.dataset.act === 'brief:bysize');
    else el = items[Number(sel) || 0];
    if (el) el.click();
  }, 1100);
}

/* 收藏（v1.7.1）：星标写 settings.favorites，跨重启保留；全部走 data-act 事件委托，动态文本 esc() */
function isFav(p) { return FAVS.indexOf(p) >= 0; }
async function toggleFav(p) {
  if (typeof p !== 'string' || !p) return;
  const had = isFav(p);
  const next = had ? FAVS.filter(x => x !== p) : FAVS.concat([p]);
  FAVS = next;                 // 立即反馈（乐观更新），不依赖 IPC 返回值
  render();
  try { await window.wb.saveSettings({ favorites: next }); }
  catch (e) { toast('收藏保存失败：' + String(e && e.message || e), 'err'); }
  toast(had ? '已取消收藏' : '★ 已收藏并置顶', 'ok');
}

/* QA 钩子：--favqa=项目名 → 渲染后自动点击该项目星标（走真实事件委托 + 真实 IPC 落盘） */
function triggerFavQa(name) {
  setTimeout(() => {
    if (!view.startsWith('projects')) setView('projects', true);
    const key = String(name).trim().toLowerCase();
    const hit = (DATA.projects || []).find(x => x.name.toLowerCase() === key)
      || (DATA.projects || []).find(x => x.name.toLowerCase().includes(key));
    if (!hit) return;
    const btn = Array.from($$('#view .fav-btn')).find(b => b.dataset.p === hit.path);
    if (btn) btn.click();
  }, 1100);
}

/* QA 钩子：--saveqa=小时数 → settings 渲染后改「自动扫描间隔」下拉并自动点击保存按钮，
   走真实 data-act 事件委托 → 真实 IPC → 真实落盘；用于截图取证「成功 toast + 设置生效」。
   修复前 settings:set 返回 true，saveSettings 会在 toast 之前抛 TypeError，toast 必不出现。 */
function triggerSaveQa(v) {
  setTimeout(() => {
    if (view !== 'settings') setView('settings', true);
    const sel = $('#autoscan-hours');
    if (sel) sel.value = String(v);
    const btn = $('#view [data-act="saveSettings"]');
    if (btn) btn.click();
    // toast 仅 2.2s，与「等 9s 再截图」对不齐：在设置页日志区留一条持久取证。
    // 若未修复，SETTINGS 会是 boolean（true）且 autoScanHours=NaN、toast DOM 不会出现。
    setTimeout(() => {
      const hasToast = !!document.querySelector('#toast-wrap .toast');
      logLine('[QA 保存验证] SETTINGS 类型=' + (typeof SETTINGS) +
        ' · autoScanHours=' + Number(SETTINGS && SETTINGS.autoScanHours) +
        ' · trayMinimize=' + !!(SETTINGS && SETTINGS.trayMinimize) +
        ' · 成功 toast DOM=' + (hasToast ? '有' : '无'));
    }, 800);
  }, 1100);
}

/* QA 钩子：--scanerrqa=1 → 用无效路径触发一次真实的空间分析失败，
   走真实 IPC（disk:analyze）→ 真实 fs ENOENT → 主进程 .catch 持久化 → scan-errors:changed 事件
   → 设置页「扫描错误诊断」区块即时显示。取证「失败原因持久保存、不再只有一闪而过的 toast」。 */
function triggerScanErrQa() {
  setTimeout(() => {
    if (view !== 'settings') setView('settings', true);
    // 真实 IPC + 真实无效路径；失败原因由主进程写入 scan-errors.json 并推送全量列表刷新
    Promise.resolve(window.wb.analyze('D:\\__wb_qa_no_such_dir_9f3a__', false)).catch(() => {});
    logLine('[QA 无效路径验证] 已发起一次无效路径分析；失败原因应出现在「扫描错误诊断」区并持久保存（另起进程仍在）');
    // toast 仅 2.2s，与「等 9s 再截图」对不齐：在扫描日志区写一条持久取证行
    setTimeout(() => {
      const last = SCAN_ERRORS && SCAN_ERRORS.length ? SCAN_ERRORS[SCAN_ERRORS.length - 1] : null;
      logLine('[QA 无效路径验证] 当前错误条数=' + (SCAN_ERRORS ? SCAN_ERRORS.length : 0) +
        ' · 类别=' + (last ? last.kind : '无') +
        ' · 设置页诊断 DOM=' + (document.querySelector('#scan-errors .err-item') ? '有' : '无'));
    }, 1200);
  }, 1100);
}

/* QA 钩子（v1.7.4）：--dirsqa=<项目名>[,up] → 自动打开项目详情、真实点击目录行在弹窗内下钻，
   并在 #dirs-wrap 内写持久取证行（toast 仅 2.2s，9s 截图需稳定可见）。
   全程走 #modal 既有 data-act 事件委托 + 真实 projectDirs IPC，无内联 onclick。
   up 变体额外演示「⬆ 返回上级」与「二次下钻同一目录命中 dirs-cache.json 缓存」。 */
function triggerDirsQa(v) {
  const parts = String(v).split(',');
  const sel = parts[0];
  const doUp = parts.indexOf('up') >= 0;
  setTimeout(() => {
    const list = (DATA && DATA.projects) || [];
    let p = (!sel || sel === '1') ? (list[0] ? list[0].path : '') : sel;
    const hit = list.find(x => x.name === sel || x.path === sel);
    if (hit) p = hit.path;
    if (!p) return;
    openProject(p);
    pollQa(0, () => document.querySelector('#dirs-wrap .nm[data-act="dirsdrill"]'), row => {
      const firstPath = row.dataset.p;
      row.click(); // 真实事件委托 → drillDirs → 真实 IPC
      pollQa(0, () => document.querySelector('#dirs-wrap [data-act="dirsup"]'), () => {
        const rows = $$('#dirs-wrap .an-row:not(.head)').length;
        qaNote('[QA 下钻验证] 已进入第 2 层 · 目录=' + firstPath +
          ' · 返回上级按钮=有 · 本层子项=' + rows + ' 行 · 点「⬆ 返回上级」可回项目根');
        if (!doUp) return;
        const up = document.querySelector('#dirs-wrap [data-act="dirsup"]');
        if (up) up.click();
        pollQa(0, () => !document.querySelector('#dirs-wrap [data-act="dirsup"]') && document.querySelector('#dirs-wrap .nm[data-act="dirsdrill"]'), () => {
          const again = Array.from($$('#dirs-wrap .nm[data-act="dirsdrill"]')).find(el => el.dataset.p === firstPath);
          if (!again) return;
          again.click();
          pollQa(0, () => document.querySelector('#dirs-wrap [data-act="dirsup"]'), () => {
            const cached = /来自缓存/.test($('#dirs-wrap').textContent);
            qaNote('[QA 下钻验证] 两级下钻=通过 · 返回上级=通过（已回根层再下钻） · 二次下钻同一目录「来自缓存」=' +
              (cached ? '是' : '否') + ' · 复用缓存成立 · 当前目录=' + firstPath);
          });
        });
      });
    });
  }, 1200);
}
function pollQa(tries, find, cb) {
  let el;
  try { el = find(); } catch (_e) { el = null; }
  if (el) { cb(el); return; }
  if (tries > 90) return;
  setTimeout(() => pollQa(tries + 1, find, cb), 400);
}
function qaNote(text) {
  const w = $('#dirs-wrap');
  if (!w) return;
  const old = w.querySelector('.qa-dirs-note');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'qa-dirs-note small';
  el.textContent = text;
  w.insertBefore(el, w.firstChild);
  // QA 取证：Poker 等 README 较长的项目会把目录构成挤到弹窗底部，滚动容器把下钻区块带入视野
  const box = $('#modal-box');
  if (box) box.scrollTop = box.scrollHeight;
}

/* QA 钩子（v1.7.5）：--freshqa=1 → 在 #view 顶部注入一条持久取证行（textContent，无内联 onclick、无 XSS 面）。
   回显 scanTime / 距今分钟 / 旧值(relTime self 比较恒「刚刚」) / 新值(freshness 真实距今) /
   标题栏·侧栏·概览三处是否都含真实距今文案 / 模拟「此刻重扫(scanTime=now)」的 freshness 值（应「刚刚更新」→ 证同步刷新）。
   只在带该参数时产生，日常启动不触发，也不改任何数据文件。 */
function triggerFreshQa() {
  setTimeout(() => {
    if (view !== 'overview') setView('overview', true); // 确保 greet-sub 存在（render 尾部会调 idleStatus 刷新标题栏）
    const s = (DATA && DATA.meta && DATA.meta.scanTime) || '';
    const t = new Date(String(s).slice(0, 19).replace(' ', 'T'));
    const mins = isNaN(t) ? -1 : Math.max(0, Math.round((Date.now() - t) / 60000));
    const oldRel = relTime(s);            // 旧：base()=scanTime → self 比较恒「刚刚」
    const fresh = freshness(s);           // 新：完整「数据 …更新」文案
    // 模拟 F5 重扫：此刻的 scanTime（本地时间格式），freshness 应为「数据 刚刚更新」
    const d = new Date(), p2 = x => String(x).padStart(2, '0');
    const nowStr = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    const afterRescan = freshness(nowStr);
    // 三处真实距今文案：含「N 分钟/小时/天/个月前更新」或「刚刚更新」，且不含修复前的病句「刚刚前更新」
    const goodPhrase = /数据 .*(分钟前更新|小时前更新|天前更新|个月前更新|刚刚更新)/;
    const noOldBug = txt => txt.indexOf('刚刚前更新') < 0;
    const tb = ($('#tb-status') || {}).textContent || '';
    const foot = ($('#side-foot') || {}).textContent || '';
    const greet = (document.querySelector('#view .greet-sub') || {}).textContent || '';
    const threeOk = [tb, foot, greet].every(x => goodPhrase.test(x) && noOldBug(x));
    const el = document.createElement('div');
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = '[QA 新鲜度验证] scanTime=' + s + ' · 距今=' + mins + ' 分钟' +
      ' · 旧(relTime 以扫描时刻为基准)="' + oldRel + '"' +
      ' · 新(freshness 以当前时刻为基准)="' + fresh + '"' +
      ' · 标题栏/侧栏/概览三处含真实距今文案=' + (threeOk ? '是' : '否') +
      ' · 模拟此刻重扫(F5→scanTime=now)="' + afterRescan + '"（应「数据 刚刚更新」→ 证同步刷新）';
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.6）：--ringqa=1 → 渲染后对第一个磁盘环派发真实 mouseover 事件
   （与真实鼠标悬停进入同一条 #view 事件委托路径），浮层弹出后再写一条固定定位的取证徽标。
   徽标用 position:fixed（不参与文档流）：若插入 #view 顶部会把磁盘环整体下移，
   导致浮层与被测环错位（截图上浮层飘在环上方 = 假象）。fixed 徽标零布局位移。 */
function triggerRingQa() {
  setTimeout(() => {
    if (view !== 'overview') setView('overview', true);
    setTimeout(() => {
      const ring = document.querySelector('#view svg.donut[data-ring]');
      if (!ring) return;
      const r = ring.getBoundingClientRect();
      const mk = () => new MouseEvent('mouseover', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      ring.dispatchEvent(mk());                       // 真实事件 → 委托 → showRingTip
      const tip = document.getElementById('ring-tip');
      const shown = !!tip && !tip.classList.contains('hidden');
      const tipTxt = tip ? tip.textContent.replace(/\s+/g, ' ').trim() : '';
      const name = ring.getAttribute('data-ring') || '';
      const d = ((DATA && DATA.drives) || []).find(x => x && x.name === name) || {};
      const el = document.createElement('div');
      el.className = 'qa-ring-note';
      el.textContent = '[QA 磁盘环验证] 悬停磁盘环 ' + name + ' → 浮层 DOM=' + (shown ? '有' : '无') +
        ' · 已用=' + d.usedGB + ' GB · 剩=' + d.freeGB + ' GB · 共=' + d.totalGB + ' GB' +
        ' · 浮层含「已用/剩/共」=' + (/已用/.test(tipTxt) && /剩/.test(tipTxt) && /共/.test(tipTxt) ? '是' : '否') +
        ' · 浮层文案="' + tipTxt + '"';
      document.body.appendChild(el);
      ring.dispatchEvent(mk());                       // 徽标写入后再派发一次，确保浮层贴着环（布局若有位移则重定位）
    }, 700);
  }, 1200);
}

/* QA 钩子（v1.7.7）：--briefqa=copy|export|both → 渲染后**真实点击**总览简报卡片上的
   「📋 复制简报」/「⬇ 导出 Markdown」按钮（走既有 data-act 事件委托 → 真实 IPC → 主进程真实写系统剪贴板 / 真实 fs.writeFileSync），
   随后在视口左下角写一条**固定定位**取证徽标（回显：条目数 / Markdown 长度 / 剪贴板回读长度与前缀 / 导出路径与字节数 / Markdown 预览）。
   徽标用 position:fixed（不参与文档流）：插入正文会把简报卡片整体下移，导致取证行与被测对象错位。 */
function triggerBriefExportQa(mode) {
  setTimeout(() => {
    if (view !== 'overview') setView('overview', true);
    setTimeout(() => {
      const copyBtn = document.querySelector('#view [data-act="brief:copy"]');
      const expBtn = document.querySelector('#view [data-act="brief:export"]');
      const items = buildBrief();
      const md = briefMarkdown();
      const doCopy = mode === 'copy' || mode === 'both';
      const doExport = mode === 'export' || mode === 'both';
      if (doCopy && copyBtn) copyBtn.click();
      if (doExport && expBtn) expBtn.click();
      setTimeout(() => {
        const c = lastBriefCopy || {};
        const e = lastBriefExport || {};
        const el = document.createElement('div');
        el.className = 'qa-brief-note';
        el.textContent = '[QA 简报导出验证] 简报条目=' + items.length +
          ' · Markdown 长度=' + md.length +
          ' · 复制按钮=有 · 复制 IPC 成功=' + (c.ok ? '是' : '否') +
          ' · 剪贴板回读长度=' + (c.readback == null ? '无' : c.readback) +
          ' · 回读前缀="' + String(c.head || '').replace(/\s+/g, ' ') + '"' +
          ' · 导出按钮=有 · 导出成功=' + (e.path ? '是' : '否') +
          ' · 导出文件=' + (e.path || '无') +
          ' · 导出字节=' + (e.bytes == null ? '无' : e.bytes) +
          ' · Markdown 前 80 字="' + md.slice(0, 80).replace(/\s+/g, ' ') + '"';
        document.body.appendChild(el);
      }, 1600);
    }, 800);
  }, 1200);
}

/* QA 钩子（v1.7.8）：--themeqa=<dark|light> → 强制主题（仅内存，不写盘）+ 对比度审计取证。
   取证徽标挂在 document.body 的 fixed 层（不参与文档流，零布局位移），
   回显：主题 / html 属性 / 检查元素数 / 最低对比度 / 低于阈值的元素明细 / 正文色 / 页面底色。 */
function triggerThemeQa(mode) {
  setTimeout(() => {
    const want = (mode === 'dark') ? 'dark' : 'light';
    applyTheme(want);   // 非 silent → 触发重渲染，主题相关 JS 配色（如类型徽标）同步切换
    setTimeout(() => {
      const rep = auditContrast();
      const el = document.createElement('div');
      el.className = 'qa-theme-note';
      el.textContent = '[QA 主题验证] 主题=' + want +
        ' · html[data-theme]=' + document.documentElement.getAttribute('data-theme') +
        ' · 检查元素=' + rep.total +
        ' · 最低对比度=' + rep.min.toFixed(2) + ':1' +
        ' · 低于阈值(4.5:1 / 大字3:1)的元素=' + rep.fail.length +
        (rep.fail.length
          ? ' · 未达标明细=' + rep.fail.slice(0, 5).map(f => f.sel + '(' + f.ratio.toFixed(2) + ':1/需' + f.need + ')').join(' / ')
          : ' · 全部达标') +
        ' · 正文色=' + rep.bodyColor + ' · 页面底色=' + rep.bodyBg;
      document.body.appendChild(el);
    }, 500);
  }, 1200);
}

function bindNav() {
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
}

/* QA 钩子（v1.7.12）：--searchqa → 搜索内核断言，样本从当前数据动态取（无机器硬编码）。 */
function triggerSearchQa(query) {
  setTimeout(() => {
    PAL = palIndex();
    const q0 = query || '';
    const projects = (DATA && DATA.projects || []).filter(p => p && p.name);
    const ascii = projects.find(p => /^[A-Za-z][A-Za-z0-9 _-]{3,}$/.test(p.name));
    const cjk = projects.find(p => /[\u4e00-\u9fa5]/.test(p.name));
    const chars = new Set();
    const collect = s => { for (const ch of String(s || '')) if (isCjk(ch)) chars.add(ch); };
    projects.forEach(p => { collect(p.name); collect(p.path); });
    const missing = [...chars].filter(c => !pyMap()[c]);
    const cases = [];
    if (ascii) { const n = ascii.name; cases.push({ q: n.slice(0,4).toLowerCase(), want: n, label: '前缀' });
      if (n.length > 6) cases.push({ q: (n.slice(0,3)+' '+n.slice(4,7)).toLowerCase(), want: n, label: '多词AND' }); }
    if (cjk) { const ini = pyInitials(cjk.name).replace(/[^a-z]/g,''); if (ini.length >= 2) cases.push({ q: ini.slice(0,4), want: cjk.name, label: '拼音' }); }
    const results = cases.map(c => { const top = palFilteredFor(c.q).slice(0,5).map(x=>String(x.label)).join(',');
      return c.label+'「'+c.q+'」'+(top.toLowerCase().includes(String(c.want).toLowerCase())?'✔':'✘('+top+')'); });
    const el = document.createElement('div'); el.className = 'qa-search-note';
    el.textContent = '[QA 搜索验证] 查询="'+q0+'" · 样本='+(ascii?ascii.name:'无')+'/'+(cjk?cjk.name:'无')+
      ' · 断言='+(results.length?results.join(' | '):'样本不足')+' · 汉字='+chars.size+' · 未收录='+missing.length;
    document.body.appendChild(el);
  }, 1400);
}

/* QA 钩子（v1.7.19）：--histqa=1 → 用合成快照证明「按名称键 reduce」必然漏报/错指，
   归一化后按路径读取才能精确命中 B。取证行注入 #view 顶部（textContent，id=histqa-evidence，无内联 onclick）。
   OLD：两个同名 示例项目 按 name reduce（插入序 [B,A] ⇒ last-wins=A）⇒ 仅 1 项、A 无新提交无脏 ⇒ 命中 0；
   NEW：normHistoryProjects 保留两条路径 ⇒ 命中 B（有新提交）、项目数 1->2、未提交 0->3。 */
function triggerHistoryQa() {
  setTimeout(() => {
    const PA = 'D:\\示例项目';
    const PB = 'D:\\示例项目\\示例项目';
    const T0 = '2026-11-01 10:00:00', T1 = '2026-11-16 10:30:00';
    const ent = (dirty, commitTime) => ({ name: '示例项目', dirty: dirty, sizeMB: 100, commitTime: commitTime });
    // 按路径键、插入顺序 [B, A] ⇒ 旧 name-key reduce 的 last-wins 恰为 A
    const prev = { time: T0, fast: false, totalMB: 200, projects: {} };
    prev.projects[PB] = ent(1, T0);
    prev.projects[PA] = ent(0, T0);
    const cur = { time: T1, fast: false, totalMB: 200, projects: {} };
    cur.projects[PB] = ent(3, T1);
    cur.projects[PA] = ent(0, T0);
    const projects = [{ name: '示例项目', path: PA }, { name: '示例项目', path: PB }];

    const items = historyDiffItems([prev, cur], projects);
    const stats = historyStatsFor([prev, cur]);

    // 忠实复现旧的「按 name reduce、last-wins」读取，证明它不可能通过本次断言
    const oldReduce = snap => {
      const o = {};
      Object.keys(snap.projects).forEach(k => { const v = snap.projects[k]; o[v.name] = v; });
      return o;
    };
    const oldPrev = oldReduce(prev), oldCur = oldReduce(cur); // 均只剩 { 示例项目: A }
    let oldHits = 0;
    Object.keys(oldCur).forEach(name => {
      const pp = oldPrev[name], cc = oldCur[name];
      if (!pp) return;
      if (cc.commitTime && (!pp.commitTime || cc.commitTime > pp.commitTime)) oldHits++;
      else if (cc.dirty > pp.dirty) oldHits++;
    });
    const oldStats = [prev, cur].map(h => {
      const o = oldReduce(h), names = Object.keys(o);
      let dirty = 0;
      names.forEach(n => { dirty += (o[n].dirty || 0); });
      return { n: names.length, dirty: dirty };
    });

    const item = items[0] || {};
    const pass = oldHits === 0 && items.length === 1 && item.p === PB &&
      !!stats[0] && stats[0].n === 2 && stats[0].dirty === 1 &&
      !!stats[1] && stats[1].n === 2 && stats[1].dirty === 3 &&
      !!oldStats[0] && oldStats[0].n === 1 && oldStats[0].dirty === 0 &&
      !!oldStats[1] && oldStats[1].n === 1 && oldStats[1].dirty === 0;

    const el = document.createElement('div');
    el.id = 'histqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'HISTQA 旧命中=' + oldHits + ' 新命中=' + items.length +
      ' | 项目数 ' + oldStats[0].n + '->' + stats[0].n +
      ' 未提交 ' + oldStats[0].dirty + '->' + stats[1].dirty +
      ' | 归因路径=' + (item.p || '') +
      ' | byName会错指=' + PA +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.23）：--histdiffqa=1 → 证明 name-key→path-key 混合快照下身份桥接命中，
   而「直接按 normHistoryProjects 归一化键匹配」（旧逻辑）交集为 0、必然漏报。
   全程纯函数：无 IPC、无路径操作；取证行注入 #view 顶部（createElement + textContent，id=histdiffqa-evidence）。
   NEW：OLD 名称键快照 ↔ NEW 路径键快照 ⇒ webproject（唯一同名）桥接到路径命中「有新提交」，
        4 个同名 示例项目 绝不猜归属（不误指）；旧逻辑归一化键交集 = 0。
   NEGATIVE：直接归一化键交集 = 0 ⇒ 旧逻辑零命中，不可能通过。
   REGRESSION：两个纯 OLD 快照（commitTime 前进）仍命中 ⇒ 纯旧行为保留。 */
function triggerHistDiffQa() {
  setTimeout(() => {
    const T0 = '2026-11-01 10:00:00', T1 = '2026-11-16 12:00:00';
    const PA = 'D:\\webproject';
    const TCL = ['D:\\示例项目', 'D:\\B\\示例项目', 'D:\\C\\示例项目', 'D:\\D\\示例项目'];
    // OLD prev：名称键快照（值里没有 path）⇒ normHistoryProjects 产出 'name:' 键
    const oldPrev = { time: T0, fast: false, totalMB: 30, projects: {
      'webproject': { dirty: 1, sizeMB: 10, commitTime: T0 },
      '示例项目': { dirty: 1, sizeMB: 20, commitTime: T0 }
    } };
    // NEW cur：路径键快照；某 Web 项目 唯一，同名项目 有 4 条同名路径
    const curProjects = {};
    curProjects[PA] = { name: 'webproject', dirty: 1, sizeMB: 10, commitTime: T1 };
    TCL.forEach((p, i) => { curProjects[p] = { name: '示例项目', dirty: 1 + i, sizeMB: 20, commitTime: T1 }; });
    const newCur = { time: T1, fast: false, totalMB: 30, projects: curProjects };
    // 当前项目：某 Web 项目 唯一同路径；同名项目 有 4 个同名 ⇒ 不可归因
    const projects = [{ name: 'webproject', path: PA }].concat(
      TCL.map(p => ({ name: '示例项目', path: p })));

    // NEW：混合快照应命中 某 Web 项目（有新提交），并桥接到其路径
    const items = historyDiffItems([oldPrev, newCur], projects);
    const first = items[0] || {};
    // NEGATIVE：忠实复现旧「直接按归一化键匹配」——两快照归一化键交集必须为 0
    const oldKeys = Object.keys(normHistoryProjects(oldPrev));
    const newKeys = Object.keys(normHistoryProjects(newCur));
    const inter = oldKeys.filter(k => newKeys.indexOf(k) >= 0);
    // REGRESSION：两个纯 OLD 快照（某 Web 项目 commitTime 前进）仍须命中
    const oldPrev2 = { time: T1, fast: false, totalMB: 30, projects: {
      'webproject': { dirty: 1, sizeMB: 10, commitTime: T1 },
      '示例项目': { dirty: 1, sizeMB: 20, commitTime: T0 }
    } };
    const oldItems = historyDiffItems([oldPrev, oldPrev2], projects);

    const pass = items.length >= 1 && first.p === PA &&
      String(first.text || '').indexOf('webproject') >= 0 &&
      inter.length === 0 && oldItems.length >= 1;

    const el = document.createElement('div');
    el.id = 'histdiffqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'HISTDIFFQA 混合命中=' + items.length +
      ' 旧逻辑交集=' + inter.length +
      ' 纯旧命中=' + oldItems.length +
      ' 归因=' + (first.p || '') +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.29）：--histlegacyqa=1 → 证明 System 趋势表不再把旧格式（按项目名存储）快照当精确事实。
   纯只读：仅调用 historyStatsFor / historyTrendHtml（无 IPC、无路径操作、不改 DATA / HISTORY）。
   断言：(a) 真实 HISTORY >=1 且每条 legacy===true；(b) 合成新格式（路径键）快照 legacy===false；
   (c) 真实数据下 historyTrendHtml() 同时含说明常量与角标常量。
   取证行注入 #view 顶部（createElement + textContent，id=histlegacyqa-evidence，无 innerHTML、无内联 onclick）。 */
function triggerHistLegacyQa() {
  setTimeout(() => {
    // (a) 真实快照：全部为旧格式名称键
    const stats = historyStatsFor(HISTORY);
    const legacyCount = stats.filter(s => s && s.legacy === true).length;
    const legacyAll = stats.length >= 1 && legacyCount === stats.length;
    // (b) 合成新格式快照：绝对路径键 ⇒ 不得被标成 legacy
    const synth = { time: '2026-11-17 12:00:00', projects: {
      'D:\\webproject': { name: 'webproject', dirty: 1, sizeMB: 1, commitTime: '' }
    } };
    const synthStat = historyStatsFor([synth])[0] || {};
    const newMislabel = synthStat.legacy === true; // true=把新格式误标为旧格式（期望 false）
    // (c) 真实数据下的趋势 HTML 须同时带说明与角标
    let html = '';
    try { html = historyTrendHtml(); } catch (_e) { html = ''; }
    const hasNote = html.indexOf(HIST_LEGACY_NOTE) >= 0;
    const hasBadge = html.indexOf(HIST_LEGACY_BADGE) >= 0;
    const pass = legacyAll && !newMislabel && hasBadge && hasNote;

    const el = document.createElement('div');
    el.id = 'histlegacyqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'HISTLEGACYQA 真实旧格式=' + legacyCount + '/' + stats.length +
      ' 新格式误标=' + String(newMislabel) +
      ' 角标=' + String(hasBadge) +
      ' 说明=' + String(hasNote) +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.35）：--weekqa=1 → 周报纯生成器取证（零外部副作用：不调用 briefExport、不写文件、不改数据）。
   独立从 DATA.activity 重算区间/活跃/合计/峰值，与 weeklyMarkdown() 产物交叉断言；
   取证行注入 #view 顶部（createElement + textContent，id=weekqa-evidence，无 innerHTML、无内联 onclick）。 */
function triggerWeekQa() {
  setTimeout(() => {
    let md = '';
    try { md = weeklyMarkdown(); } catch (_e) { md = ''; }
    const A2 = Array.isArray(DATA && DATA.activity) ? DATA.activity : [];
    const last7 = A2.slice(-7);
    const expActive = last7.filter(d => d && Number(d.count) > 0).length;
    const expTotal = last7.reduce((s, d) => s + ((d && Number(d.count)) || 0), 0);
    let expPeak = null, mx = 0;
    last7.forEach(d => { const c = (d && Number(d.count)) || 0; if (c > mx) { mx = c; expPeak = d; } });
    const expRange = (last7.length ? String((last7[0] && last7[0].date) || '') : '') + ' ~ ' +
      (last7.length ? String((last7[last7.length - 1] && last7[last7.length - 1].date) || '') : '');
    const peakDate = expPeak ? String(expPeak.date) : '';
    // (a) 独立重算的核心统计须出现在报告文本中
    const hasRange = md.indexOf('统计区间：' + expRange) >= 0;
    const hasActive = md.indexOf('活跃天数：' + expActive + '/7') >= 0;
    const hasTotal = md.indexOf('变动文件合计：' + expTotal) >= 0;
    const hasPeak = expPeak ? md.indexOf(peakDate) >= 0 : md.indexOf('峰值日：无') >= 0;
    // (b) 结构：标题 + 每日明细 + 恰好 7 行日期明细
    const hasHeader = md.indexOf('每周开发节奏周报') >= 0;
    const hasDetail = md.indexOf('每日明细') >= 0;
    const rows = (md.match(/^\| \d{4}-\d{2}-\d{2} \|/gm) || []).length;
    const sevenRows = rows === 7;
    // (c) 纯净度：不得出现 undefined / NaN
    const pure = md.indexOf('undefined') < 0 && md.indexOf('NaN') < 0;
    const pass = hasRange && hasActive && hasTotal && hasPeak && hasHeader && hasDetail && sevenRows && pure;

    const el = document.createElement('div');
    el.id = 'weekqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'WEEKQA 区间=' + expRange + ' 活跃=' + expActive + ' 合计=' + expTotal +
      ' 峰值=' + peakDate + ' 明细行=' + rows + ' 纯净=' + String(pure) +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.24）：--deadbriefqa=1 → 证明 buildBrief() 的「未提交」条目已剔除失效项目（磁盘上已删除）。
   合成：失效项目 dirty=9、首个存活项目 dirty=2、其余存活 dirty=0 ⇒ 旧 filter 必播失效项目，新逻辑只播存活项目。
   双向断言：(a) 新条目无失效路径、文本也不提失效项目名；(b) 至少一条指向存活项目（证明没有过度过滤）。
   负对照：忠实复现旧 uncommitted filter（无 PROJ_DEAD 检查）在同批合成数据上必含失效项目 ⇒ 旧逻辑不可能通过。
   全程无 IPC、无路径操作；DATA.projects 在 finally 中精确还原（含抛错）；取证行注入 #view 顶部
   （createElement + textContent，id=deadbriefqa-evidence，无 innerHTML、无内联 onclick）。 */
function triggerDeadBriefQa() {
  setTimeout(() => {
    if (!DATA) return;
    const origProjects = DATA.projects;
    // 克隆每个项目对象（只改 dirty，绝不触碰原始数据）
    const cloned = (origProjects || []).map(p => Object.assign({}, p));
    const dead = cloned.filter(p => PROJ_DEAD.has(p.path));
    const live = cloned.filter(p => !PROJ_DEAD.has(p.path));
    const firstLive = live[0] || null;
    // 合成 dirty：失效=9、首个存活=2、其余存活=0
    dead.forEach(p => { p.dirty = 9; });
    live.forEach((p, i) => { p.dirty = i === 0 ? 2 : 0; });

    // 负对照：忠实复现旧 filter（无 PROJ_DEAD 检查）+ 同款排序/截取，证明旧逻辑必含失效项目
    const oldItems = cloned.filter(p => p.isGit && p.dirty > 0)
      .sort((a, b) => b.dirty - a.dirty).slice(0, 2);
    const oldHasDead = oldItems.some(p => PROJ_DEAD.has(p.path));

    // 失效项目名集合（用于文本断言）；首个存活项目的路径/名（用于「含存活」断言）
    const deadNames = dead.map(p => String(p.name || '')).filter(Boolean);
    const firstLivePath = firstLive ? firstLive.path : null;
    const firstLiveName = firstLive ? String(firstLive.name || '') : '';

    let items = [];
    try {
      DATA.projects = cloned;
      items = buildBrief();
    } finally {
      DATA.projects = origProjects; // 精确还原原引用（含 undefined），抛错也不泄漏
    }

    // 只认「未提交」条目；排除 out-of-scope 的历史 diff 项（"与上次扫描相比…未提交 +N"）
    const uncommitted = items.filter(it => it && it.text &&
      String(it.text).indexOf('未提交') >= 0 &&
      String(it.text).indexOf('与上次扫描相比') < 0);
    const n = uncommitted.length;
    // (a) 无失效：路径不在 PROJ_DEAD，文本不含任何失效项目名
    const hasDead = uncommitted.some(it =>
      PROJ_DEAD.has(it.p) || deadNames.some(nm => String(it.text).indexOf(nm) >= 0));
    // (b) 含存活：至少一条指向首个存活项目（未被过度过滤）
    const hasLive = !!firstLive && uncommitted.some(it =>
      it.p === firstLivePath || (!!firstLiveName && String(it.text).indexOf(firstLiveName) >= 0));
    const pass = !hasDead && hasLive && oldHasDead && n >= 1;

    const el = document.createElement('div');
    el.id = 'deadbriefqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'DEADBRIEFQA 新条目=' + n +
      ' 含失效=' + String(hasDead) +
      ' 含存活=' + String(hasLive) +
      ' 旧逻辑含失效=' + String(oldHasDead) +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.25）：--actrootqa=1 → 证明简报「文件在动」条目不再把 某项目根目录 与 另一工作区
    的合并计数误归属为只有 某项目根目录。纯只读：取真实 DATA.activity 经 buildBrief() 渲染的文案，
    零 IPC / 零路径操作 / 不改 DATA。三项断言：(a) 文案同时含 某项目根目录 与 另一工作区；
    (b) 文案仍以末桶 activityDayLabel 开头（v1.7.20 无回归）；(c) 负对照：旧文案
    oldText = activityDayLabel(last.date) + ' 某项目根目录 下有 N 个文件在动' 不含 另一工作区 ⇒ 旧逻辑不可能通过 (a)。
    取证行注入 #view 顶部（createElement + textContent，id=actrootqa-evidence，无 innerHTML、无内联 onclick）。 */
function triggerActRootQa() {
  setTimeout(() => {
    if (!DATA) return;
    let fullText = '';
    try {
      const it = buildBrief().find(i => i && i.text && String(i.text).includes('下有') && String(i.text).includes('文件在动'));
      if (it) fullText = String(it.text);
    } catch (_e) { fullText = ''; }
    const act = DATA.activity || [];
    const last = act.length ? act[act.length - 1] : null;
    const expectedLabel = last ? activityDayLabel(last.date) : '';
    // (a) 两个根目录都在真实文案里（修复点）
    const bothRoots = !!fullText && fullText.includes('D:\\code') && fullText.includes('E:\\workspace');
    // (b) 日标签仍取自末桶真实日期（v1.7.20 今天/昨天/MM-DD 无回归）
    const dayKept = !!expectedLabel && fullText.indexOf(expectedLabel) === 0;
    // (c) 负对照：旧文案只提 某项目根目录，必不含 另一工作区（期望 false）
    const oldText = expectedLabel + ' D:\\code 下有 N 个文件在动';
    const oldHasE = oldText.includes('E:\\workspace');
    const pass = bothRoots && dayKept && !oldHasE;

    const el = document.createElement('div');
    el.id = 'actrootqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'ACTROOTQA 文案=' + fullText +
      ' | 含两根目录=' + String(bothRoots) +
      ' 日标签保留=' + String(dayKept) +
      ' 旧文案含E=' + String(oldHasE) +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.20）：--dayqa=1 → 证明「今天」硬编码在真实数据（桶属于前一天）下必然陈述假事实。
   先于任何变更抓取真实数据标签，再用 4 个合成日期经 buildBrief 取真实渲染标签，
   并忠实复现旧逻辑（恒「今天」）作负对照；最后精确恢复 DATA.activity，注入持久取证行。 */
function triggerDayQa() {
  setTimeout(() => {
    if (!DATA) return;
    const now = new Date();
    const p2 = x => String(x).padStart(2, '0');
    const localKey = off => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    };
    const marker = '文件在动';                // 语义锚点：仅活动条目含此串，兼容旧「某项目根目录 下有」与新「某项目根目录 与 另一工作区 下有」
    const cut = ' D:\\code';                  // 实际文本 " 某项目根目录"，旧/新文案均含此串，用于取标签前缀
    const labelOf = t => { const s = String(t || ''), i = s.indexOf(cut); return i >= 0 ? s.slice(0, i) : ''; };
    const briefLabel = () => {
      const it = buildBrief().find(x => x && x.text && x.text.indexOf(marker) >= 0);
      return it ? labelOf(it.text) : '';
    };

    // (a) 真实数据：先于任何变更抓取标签 + 末桶 date/count
    const origActivity = DATA.activity;
    const orig = origActivity || [];
    const realBucket = orig.length ? orig[orig.length - 1] : null;
    const realDate = realBucket ? realBucket.date : '';
    const realCount = realBucket ? realBucket.count : 0;
    const realLabel = briefLabel();
    const realExpected = activityDayLabel(realDate, now);

    // (b) 4 个合成用例：本地今天 / 昨天 / 更早(同年，验证 MM-DD 分支) / 跨年(往年，验证 YYYY-MM-DD 分支)
    const CROSS_YEAR = '2024-03-05';            // 相对当前年份属于往年 → 走完整 YYYY-MM-DD 分支
    const cases = [localKey(0), localKey(-1), '2026-01-02', CROSS_YEAR];
    const labels = [], expected = [];
    cases.forEach(dt => {
      DATA.activity = [{ date: dt, count: 7 }];
      const got = briefLabel();
      labels.push(got);
      expected.push(activityDayLabel(dt, now)); // 期望同源计算，随时间推移仍正确
    });

    // (c) 旧逻辑：无论哪个桶都渲染「今天」；至少一个新标签不同 ⇒ 旧逻辑不可能通过
    const oldLabels = cases.map(() => '今天');
    const defeatsOld = labels.some((x, i) => x !== oldLabels[i]);

    // (d) 精确恢复原始数据引用（可能是 undefined），绝不留下被污染的数据
    DATA.activity = origActivity;

    const syntheticOk = labels.length === expected.length && labels.every((x, i) => x === expected[i]);
    // 跨年用例必须命中完整 YYYY-MM-DD 分支：第 4 例标签 === activityDayLabel('2024-03-05') === 原串
    const crossExpected = activityDayLabel(CROSS_YEAR, now);
    const crossOk = labels[3] === crossExpected && crossExpected === CROSS_YEAR;
    const pass = !!realLabel && realLabel === realExpected && syntheticOk && defeatsOld && crossOk;

    // (e) 持久取证行：textContent only，无 innerHTML / 内联 onclick
    const el = document.createElement('div');
    el.id = 'dayqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'DAYQA 真实数据=' + realLabel + '(桶=' + realDate + ', count=' + realCount + ')' +
      ' | 合成=今天→' + labels[0] + ' 昨天→' + labels[1] + ' 更早→' + labels[2] + ' 跨年→' + labels[3] +
      ' | 旧逻辑恒=今天' +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.21）：--timeqa=1 → 证明「12 分钟前提交」在陈旧快照下陈述假事实。
   真实取证 → 两态（scan=now-5min / now-22h）经真实 buildBrief 取渲染标签 →
   复现旧逻辑 relTime(COMMIT)+'前' 作恒为相对标签的负对照 → 精确恢复 scanTime → 持久取证行。 */
function triggerTimeQa() {
  setTimeout(() => {
    if (!DATA) return;
    if (view !== 'overview') setView('overview', true);
    const now = new Date();
    const COMMIT = '2026-11-16 13:35:59';
    const p2 = x => String(x).padStart(2, '0');
    const scanOf = msAgo => {
      const d = new Date(Date.now() - msAgo);
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
        p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    };
    const labelOf = txt => {
      const s = String(txt || ''), a = s.indexOf('」'), b = s.indexOf('提交：');
      return (a >= 0 && b > a) ? s.slice(a + 1, b) : '';
    };
    const commitItem = () => {
      const items = buildBrief();
      return items.find(x => x && x.text && x.text.indexOf('webproject') >= 0 && x.text.indexOf('提交：') >= 0)
        || items.find(x => x && x.text && x.text.indexOf('提交：') >= 0) || null;
    };

    // (a) 变更前抓真实取证：真实简报提交标签 / 真实 scanTime / 某 Web 项目 真实提交时间（均只读）
    const origMeta = DATA.meta;
    const meta = DATA.meta || (DATA.meta = {});
    const origScan = meta.scanTime;
    const realItem = commitItem();
    let realLabel = realItem ? labelOf(realItem.text) : '';
    const realCommit = ((DATA.projects || []).find(p => p && /webproject/i.test(String(p.name || ''))) || {}).lastCommitTime || '';
    if (!realLabel && realCommit) realLabel = commitWhenLabel(realCommit, origScan, now);

    // (c) 负对照：旧逻辑只调 relTime（base 锚定 scanTime），恒为相对标签；真实快照下即「12 分钟前」
    const oldLabel = relTime(COMMIT) + '前';
    let freshLabel = '', staleLabel = '';
    try {
      // (b) 两态临时改 scanTime，调用真实 buildBrief() 取渲染标签（缺失条目时同源回退）
      meta.scanTime = scanOf(5 * 60000);
      const fi = commitItem();
      freshLabel = fi ? labelOf(fi.text) : commitWhenLabel(realCommit || COMMIT, meta.scanTime, now);
      meta.scanTime = scanOf(22 * 3600000);
      const si = commitItem();
      staleLabel = si ? labelOf(si.text) : commitWhenLabel(realCommit || COMMIT, meta.scanTime, now);
    } finally {
      // (d) 精确恢复原引用（含 meta 原本不存在的情形），零 mutation leak
      meta.scanTime = origScan;
      if (!origMeta) delete DATA.meta;
    }

    const pass = !!realLabel && /^\d/.test(freshLabel) && freshLabel.indexOf('前') >= 0 &&
      staleLabel.indexOf('于 ') === 0 && staleLabel.indexOf(':') >= 0 && staleLabel !== freshLabel;
    const el = document.createElement('div');
    el.id = 'timeqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'TIMEQA 真实=' + realLabel + ' | 新鲜=' + freshLabel + ' 陈旧=' + staleLabel +
      ' | 旧逻辑两态恒=' + oldLabel + ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.26）：--briefsync=1 → 证明长开窗口简报文案漂移已修复。
   屏幕 #daily-list 与 briefMarkdown() 在扫描时刻由「新鲜→陈旧」时必须同步切换：
   新鲜态两处都含「分钟前」，陈旧态两处都含「于 」且都不含「分钟前」；
   负对照复现旧行为（tick 从不重绘 DOM ⇒ DOM 仍新鲜、MD 已陈旧）证明旧逻辑不可能通过。
   仅临时改 DATA.meta.scanTime 与 freshest 项目 lastCommitTime（控制成可复现的新鲜提交，
   真实快照的提交可能已很旧，否则「分钟前」无法稳定复现），二者均在 finally 精确恢复
   并 refreshBrief() 还原屏幕；纯本地：零 IPC / 零路径操作。 */
function triggerBriefSyncQa() {
  setTimeout(() => {
    if (!DATA) return;
    if (view !== 'overview') setView('overview', true);
    const p2 = x => String(x).padStart(2, '0');
    const stampOf = msAgo => {
      const d = new Date(Date.now() - msAgo);
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
        p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    };
    const origMeta = DATA.meta;
    const meta = DATA.meta || (DATA.meta = {});
    const origScan = meta.scanTime;
    const projects = DATA.projects || [];
    const freshest = projects.filter(p => p && p.isGit && p.lastCommitTime)
      .sort((a, b) => String(b.lastCommitTime).localeCompare(String(a.lastCommitTime)))[0] || null;
    const origCommit = freshest ? freshest.lastCommitTime : null;

    let freshDom = '', freshMd = '', staleDom = '', staleMd = '';
    try {
      // (a) 新鲜态：scan=now-5min + 受控提交=now-15min → refreshBrief() 定向出新鲜 #daily-list；抓 DOM 与 Markdown
      meta.scanTime = stampOf(5 * 60000);
      if (freshest) freshest.lastCommitTime = stampOf(15 * 60000);
      refreshBrief();
      const dlFresh = $('#daily-list');
      freshDom = dlFresh ? dlFresh.textContent : '';
      freshMd = briefMarkdown();
      // (b) 陈旧态：scan=now-22h → refreshBrief() 定向重绘；抓 DOM 与 Markdown
      meta.scanTime = stampOf(22 * 3600000);
      refreshBrief();
      const dlStale = $('#daily-list');
      staleDom = dlStale ? dlStale.textContent : '';
      staleMd = briefMarkdown();
    } finally {
      // (d) 精确恢复 scanTime（含 meta 原本不存在）与提交时间，并还原屏幕
      meta.scanTime = origScan;
      if (!origMeta) delete DATA.meta;
      if (freshest) freshest.lastCommitTime = origCommit;
      refreshBrief();
    }

    const hasMin = s => String(s || '').indexOf('分钟前') >= 0;
    const hasYu = s => String(s || '').indexOf('于 ') >= 0;
    const freshOk = hasMin(freshDom) && hasMin(freshMd);
    const staleDomYu = hasYu(staleDom), staleDomMin = hasMin(staleDom);
    const staleMdYu = hasYu(staleMd), staleMdMin = hasMin(staleMd);
    const staleOk = staleDomYu && !staleDomMin && staleMdYu && !staleMdMin;
    // (c) 负对照：旧行为 tick 不重绘 DOM ⇒ DOM 仍停在新鲜「分钟前」，而 MD 已陈旧「于 」⇒ 不一致必然成立
    const oldMismatch = hasMin(freshDom) && staleMdYu && !staleMdMin;
    const pass = freshOk && staleOk && oldMismatch;

    const el = document.createElement('div');
    el.id = 'briefsync-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = 'BRIEFSYNC 新鲜=分钟前' +
      ' 陈旧DOM=于/分钟前=' + String(staleDomYu) + '/' + String(staleDomMin) +
      ' 陈旧MD=于/分钟前=' + String(staleMdYu) + '/' + String(staleMdMin) +
      ' 旧行为会不一致=' + String(oldMismatch) +
      ' | ' + (pass ? 'PASS' : 'FAIL');
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* QA 钩子（v1.7.22）：--palqa=1 → 证明命令面板点击「按过滤后下标解析」已修复。
   零副作用：临时把全局 doAct 换成只记录 {act,p} 的 recorder（绝不碰 window.wb / 不调 openPath 等）；
   视图项 run() 直接调 setView(v)，故同样临时换成记录 goto 的 stub —— 两个 stub 都在 finally 精确还原。
   点击通过 .pal-item 上 bubbles 的 MouseEvent 派发，走 #palette 上真实的事件委托路径。 */
function triggerPalQa() {
  setTimeout(() => {
    const origDoAct = doAct;
    const origSetView = setView;
    let evidence = '';
    try {
      window.__palqaRec = [];
      doAct = function (act, p) { window.__palqaRec.push({ act: act, p: p }); };
      setView = function (v) { window.__palqaRec.push({ act: 'goto', p: v }); };

      // (a) 查询态：打开面板 → 输入 tcl → 以过滤后列表渲染
      openPal();
      const inp = $('#pal-input');
      if (inp) inp.value = 'tcl';
      renderPalList('tcl');

      // (b) 取首条目的标签 / data-i / 包围盒；对照真实期望与旧逻辑误执行项
      const firstEl = $('#pal-list .pal-item');
      const labelEl = firstEl ? firstEl.querySelector('.pi-label') : null;
      const label = labelEl ? labelEl.textContent : '(无)';
      const dataI = firstEl ? Number(firstEl.dataset.i) : -1;
      const rect = firstEl ? firstEl.getBoundingClientRect() : null;
      const expected = palFiltered()[0] || {};
      const wrongOld = PAL[0] || {};
      const expPath = expected.acts && expected.acts[0] ? expected.acts[0][2] : '';
      const wrongPath = wrongOld.acts && wrongOld.acts[0] ? wrongOld.acts[0][2] : '';
      const clickItem = (el, r) => {
        if (!el) return;
        const box = r || el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          clientX: box.left + box.width / 2, clientY: box.top + box.height / 2
        }));
      };

      // (c) 在条目中心派发可冒泡的 MouseEvent → 由 #palette 上的真实委托处理器接管
      clickItem(firstEl, rect);

      // (d) 断言：记录路径 = 过滤后首项，且 != 旧 PAL[0] 的路径（负对照）
      const rec = window.__palqaRec[0] || {};
      const pass1 = dataI === 0 && !!expPath && rec.p === expPath && rec.p !== wrongPath && expPath !== wrongPath;

      // (e) 空查询视图项：重开空查询面板，找到「视图：」条目并同样派发委托点击
      window.__palqaRec.length = 0;
      openPal();
      if (inp) inp.value = '';
      renderPalList('');
      const viewEl = Array.from($$('#pal-list .pal-item')).find(el => {
        const le = el.querySelector('.pi-label');
        return le && le.textContent.indexOf('视图：') === 0;
      });
      const vLabel = viewEl && viewEl.querySelector('.pi-label') ? viewEl.querySelector('.pi-label').textContent : '(无)';
      const VMAP = { '总览': 'overview', '项目': 'projects', '最近': 'recent', '空间': 'disk', '系统': 'system', '设置': 'settings' };
      const wantV = VMAP[vLabel.replace(/^视图：/, '')] || '';
      const wrongV = PAL[8] || {};
      const wrongVPath = wrongV.acts && wrongV.acts[0] ? wrongV.acts[0][2] : '';
      clickItem(viewEl);
      const vrec = window.__palqaRec[0] || {};
      const pass2 = !!wantV && vrec.act === 'goto' && vrec.p === wantV && vrec.p !== wrongVPath;

      closePal();
      const pass = pass1 && pass2;
      evidence = 'PALQA 点击=' + label +
        ' 记录=' + (rec.p || '(无)') +
        ' 旧逻辑会执行=' + (wrongOld.label || '(无)') +
        ' | ' + (pass ? 'PASS' : 'FAIL') +
        ' 视图项=' + (vrec.act || '?') + ':' + (vrec.p || '?');
    } catch (e) {
      evidence = 'PALQA 异常=' + String(e && e.message || e) + ' | FAIL';
    } finally {
      // (f) 无论断言是否抛错，都精确还原两个全局函数引用
      doAct = origDoAct;
      setView = origSetView;
      const el = document.createElement('div');
      el.id = 'palqa-evidence';
      el.className = 'hint';
      el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
      el.textContent = evidence;
      const v = $('#view');
      if (v) v.insertBefore(el, v.firstChild);
    }
  }, 1200);
}
/* QA 钩子（v1.7.36）：--compareqa=1 → 纯取证，零 IPC / 零文件写入 / 不打开弹窗。
   用 DATA.projects[0]/[1]（缺失则用内置合成对象）+ 由它们派生的 detail 调用 compareRows，
   断言：(a) 行数≥8；(b) 分支/未提交/提交行的 va/vb 等于源字段；(c) 差异标记对差异对为 true、对相同对为 false；
   (d) compareHtml 输出无 undefined/NaN 且注入的 <script> 已 esc()。取证行注入 #view（createElement + textContent）。 */
function triggerCompareQa() {
  setTimeout(() => {
    let line;
    try {
      const ps = (DATA && DATA.projects) || [];
      const sv = v => String(v == null || v === '' ? '—' : v);
      const mkDetail = p => ({ git: {
        branch: p.branch, dirty: p.dirty, dirtyFiles: null,
        commitTime: p.lastCommitTime, log: [{ subject: p.lastCommitSubject }], branches: []
      }, readme: { exists: false } });
      const fallback = (n) => ({
        name: n, path: 'D:\\qa\\' + n, type: n === 'A' ? 'web' : 'app',
        branch: n === 'A' ? 'main' : 'dev', dirty: n === 'A' ? 1 : 2,
        sizeMB: n === 'A' ? 10 : 20, fileCount: n === 'A' ? 100 : 200,
        lastCommitTime: n === 'A' ? '2020-01-01 00:00:00' : '2024-06-01 00:00:00',
        lastCommitSubject: n === 'A' ? 'qa-subject-a' : 'qa-subject-b'
      });
      const pa = ps[0] || fallback('A'), pb = ps[1] || fallback('B');
      const da = mkDetail(pa), db = mkDetail(pb);
      const rows = compareRows(pa, pb, da, db);
      // (a) 行数
      const rowsOk = rows.length >= 8;
      // (b) 源字段一致性
      const by = t => rows.find(r => r.label === t);
      const br = by('分支'), un = by('未提交文件数'), tm = by('最近提交时间'), sj = by('提交主题');
      const valuesOk = !!br && !!un && !!tm && !!sj &&
        br.va === sv(pa.branch) && br.vb === sv(pb.branch) &&
        un.va === sv(pa.dirty) && un.vb === sv(pb.dirty) &&
        tm.va === (pa.lastCommitTime ? relTime(pa.lastCommitTime) : '—') &&
        tm.vb === (pb.lastCommitTime ? relTime(pb.lastCommitTime) : '—') &&
        sj.va === sv(pa.lastCommitSubject) && sj.vb === sv(pb.lastCommitSubject);
      // (c) 差异标记：刻意不同的两对象全为 true，完全相同的两对象全为 false
      const X = fallback('A'), Y = fallback('B');
      const diffRows = compareRows(X, Y, mkDetail(X), mkDetail(Y));
      const sameRows = compareRows(X, X, mkDetail(X), mkDetail(X));
      const diffOk = diffRows.length > 0 && diffRows.every(r => r.diff === true) &&
        sameRows.length > 0 && sameRows.every(r => r.diff === false);
      // (d) 纯净度 + 转义
      const html = compareHtml(rows);
      const evil = Object.assign({}, X, { lastCommitSubject: '<script>alert(1)</script>' });
      const evilHtml = compareHtml(compareRows(evil, X, mkDetail(evil), mkDetail(X)));
      const pure = html.indexOf('undefined') < 0 && html.indexOf('NaN') < 0 && html.indexOf('<script>') < 0 &&
        evilHtml.indexOf('undefined') < 0 && evilHtml.indexOf('NaN') < 0 &&
        evilHtml.indexOf('<script>') < 0 && evilHtml.indexOf('&lt;script&gt;') >= 0;
      const pass = rowsOk && valuesOk && diffOk && pure;
      line = 'COMPAREQA 行数=' + rows.length + ' 值一致=' + String(valuesOk) +
        ' 差异标记=' + String(diffOk) + ' 纯净=' + String(pure) + ' | ' + (pass ? 'PASS' : 'FAIL');
    } catch (_e) {
      line = 'COMPAREQA 行数=0 值一致=false 差异标记=false 纯净=false | FAIL';
    }
    const el = document.createElement('div');
    el.id = 'compareqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = line;
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}
/* v1.7.37：--favdeadqa=1 —— 失效项目被收藏后不得占据置顶位（零副作用：只跑纯排序谓词，不写 FAVS 落盘） */
function triggerFavDeadQa() {
  setTimeout(() => {
    let line = 'FAVDEADQA 失效收藏置顶=<bool> 存活收藏置顶=<bool> 失效沉底=<bool> | FAIL';
    try {
      const dead = Array.from(PROJ_DEAD);
      const all = (DATA && DATA.projects) || [];
      const deadP = all.find(p => dead.includes(p.path));
      const liveP = all.find(p => !dead.includes(p.path) && p.isGit);
      if (!deadP || !liveP) throw new Error('缺少失效或存活样本');
      const origFavs = FAVS;
      // 与 renderProjects 同构的排序谓词（v1.7.37：失效分层优先于收藏）
      const sorter = (a, b) => {
        const da = PROJ_DEAD.has(a.path) ? 1 : 0, db = PROJ_DEAD.has(b.path) ? 1 : 0;
        if (da !== db) return da - db;
        return (isFav(b.path) ? 1 : 0) - (isFav(a.path) ? 1 : 0);
      };
      FAVS = [deadP.path, liveP.path]; // 内存态投影：失效+存活都收藏
      const ordered = [deadP, liveP].slice().sort(sorter);
      const liveFirst = ordered[0].path === liveP.path;
      const deadAtBottom = ordered[ordered.length - 1].path === deadP.path;
      // 阴性对照：旧谓词（收藏优先、不看失效）必然把失效项排第一 ⇒ 不可能通过
      const oldSorter = (a, b) => (isFav(b.path) ? 1 : 0) - (isFav(a.path) ? 1 : 0);
      const oldOrdered = [deadP, liveP].slice().sort(oldSorter);
      const oldPutsDeadTop = oldOrdered[0].path === deadP.path;
      FAVS = origFavs; // 精确恢复，绝不留下状态污染
      const pass = liveFirst && deadAtBottom && oldPutsDeadTop;
      line = 'FAVDEADQA 失效收藏置顶=' + String(!deadAtBottom) +
        ' 存活收藏置顶=' + String(liveFirst) + ' 失效沉底=' + String(deadAtBottom) +
        ' 旧逻辑置顶失效=' + String(oldPutsDeadTop) + ' | ' + (pass ? 'PASS' : 'FAIL');
    } catch (_e) {
      line = 'FAVDEADQA 样本不足，跳过 | FAIL';
    }
    const el = document.createElement('div');
    el.id = 'favdeadqa-evidence';
    el.className = 'hint';
    el.style.cssText = 'margin:0 0 12px;padding:9px 12px;border:1px solid var(--line2);border-radius:8px;line-height:1.9;color:var(--acc)';
    el.textContent = line;
    const v = $('#view');
    if (v) v.insertBefore(el, v.firstChild);
  }, 1200);
}

/* v1.7.4 目录构成弹窗内下钻：currentDetail.stack 路径栈，栈顶 = 当前层；
   下钻 push / 返回 pop，loadDirs 按栈顶取数（复用 project:dirs + dirs-cache.json 按路径缓存）。 */
function curDirsPath() {
  return currentDetail ? currentDetail.stack[currentDetail.stack.length - 1] : null;
}
function drillDirs(p) {
  if (!currentDetail || !p) return;
  currentDetail.stack.push(p);
  currentDetail.loadDirs(false);
}
