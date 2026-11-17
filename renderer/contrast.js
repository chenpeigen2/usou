/* 对比度审计（v1.7.8 建立，v1.7.41 按 nodebestpractices 1.3 抽为独立文件，平铺在 renderer/）
   把「浅色下文字可读」从主观目检变成可复现的数字：
   取关键文本元素的计算后前景色，逐层向上求有效背景色（含渐变首色 + alpha 合成），
   按 WCAG 相对亮度公式算对比度 —— 大号文字阈值 3:1，其余 4.5:1。
   与 app.js 同为普通 <script> 顺序加载，_contrast/auditContrast 在全局可见
   （avatarInk 用 _contrast、QA 钩子与 qashot 用 auditContrast，调用点零改动）。 */
const CONTRAST_TARGETS = [
  ['.greet-main', '总览·主标题'], ['.greet-sub', '总览·副标题'],
  ['.stat .big', '卡片·数值'], ['.stat .lbl', '卡片·标签'],
  ['.mini .big', '数字条·数值'], ['.mini .lbl', '数字条·标签'],
  ['.d-item', '总览·简报条目'], ['.d-item b', '总览·简报加粗'], ['.b-sec-t', '总览·区块标题'],
  ['.lcard .p', '总览·入口路径'],
  ['.prow .nm', '项目·名称'], ['.p-sub', '项目·副标题'], ['.p-size .v', '项目·体量'],
  ['.p-size .u', '项目·单位'], ['.badge', '项目·类型徽章'], ['.dmark', '项目·未提交标记'],
  ['.ritem .name', '最近·文件名'], ['.ritem .s', '最近·大小'], ['.ritem .t', '最近·时间'],
  ['.ritem .d', '最近·目录'], ['.ritem .ext', '最近·类型徽章'],
  ['.an-row .nm', '空间·目录名'], ['.num', '空间·数值'],
  ['.ucard .n', '系统·文件名'], ['.uitem .m', '系统·元信息'], ['.ucard h3 span', '系统·统计'],
  ['table.sys td', '系统·表格'], ['table.sys th', '系统·表头'],
  ['.hint', '提示'], ['.empty', '空态'], ['.ckrow', '设置·开关'],
  ['.field label', '设置·标签'], ['.err-empty', '设置·诊断空态'], ['.err-t', '设置·诊断时间'],
  ['.err-k', '设置·诊断类型'], ['.err-m', '设置·诊断信息'],
  ['#side-foot', '侧栏·页脚'], ['.nav-cap', '侧栏·分组'], ['#nav button.on', '侧栏·选中项'],
  ['#tb-clock', '标题栏·时钟'], ['#tb-status', '标题栏·状态'],
  ['.tb-title', '标题栏·标题'], ['.tb-host', '标题栏·主机'],
  ['.chip', '项目·过滤chip'], ['.chipbtn', '项目·过滤按钮'], ['.btool', '总览·简报按钮'],
  ['.heat-legend', '总览·图例'], ['.d-line', '磁盘·说明'], ['.ritem .name', '最近·文件名'],
  // v1.7.15：失效项目的样式**本身**必须进审计（否则等于没测新样式）
  ['.prow.is-dead .nm', '项目·失效名称'], ['.prow.is-dead .p-sub', '项目·失效副标题'],
  ['.deadtag', '项目·失效角标'], ['.deadstat', '项目·失效计数'], ['.deadhint', '项目·失效说明'],
  // v1.7.16：失效沉底分隔行**本身**进审计（新增样式必须自己证明达标）
  ['.deadsep', '最近·失效分隔行']
];
function _parseColor(s) {
  const t = String(s || '').trim();
  const m = t.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  if (/^#[0-9a-f]{6}$/i.test(t)) return { rgb: [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)], a: 1 };
  if (/^#[0-9a-f]{3}$/i.test(t)) return { rgb: [parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16), parseInt(t[3] + t[3], 16)], a: 1 };
  return null;
}
function _lum(rgb) {
  const c = rgb.map(v => {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function _effectiveBg(el) {
  const cs = getComputedStyle(el);
  let c = null;
  const bi = cs.backgroundImage;
  if (bi && bi !== 'none' && bi.indexOf('gradient') >= 0) {
    // 渐变：取全部色标并按通道平均（文字往往压在渐变中段，平均比取首色更接近真实观感）
    const stops = (bi.match(/rgba?\([^)]+\)/gi) || []).map(_parseColor).filter(Boolean);
    if (stops.length) {
      const avg = [0, 1, 2].map(i => Math.round(stops.reduce((s, x) => s + x.rgb[i], 0) / stops.length));
      const a = stops.reduce((s, x) => s + x.a, 0) / stops.length;
      c = { rgb: avg, a: a };
    }
  }
  if (!c) c = _parseColor(cs.backgroundColor);
  const parentBg = el.parentElement ? _effectiveBg(el.parentElement) : [255, 255, 255];
  if (!c || !(c.a > 0.02)) return parentBg;
  const a = Math.min(1, c.a);
  return [0, 1, 2].map(i => Math.round(c.rgb[i] * a + parentBg[i] * (1 - a)));
}
function _contrast(fg, bg) {
  const l1 = _lum(fg), l2 = _lum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function auditContrast() {
  const rows = [];
  let checked = 0;
  // 量测前冻结过渡：否则读到的是「渐变中间值」而非换肤后的最终值（且窗口被遮挡时 Chromium 会冻结动画，颜色会停在旧主题）
  const freeze = document.createElement('style');
  freeze.id = '__wb_audit_freeze';
  freeze.textContent = '*{transition:none !important}';
  document.head.appendChild(freeze);
  void document.body.offsetHeight;
  // v1.7.16：**hover 态也要审计** —— 浅色主题的 `.badge.Android` 只有在行被 hover
  // （行底由 --panel 变 --panel2）时才跌到 4.36:1，而审计器此前只量「当前鼠标位置」下的状态
  // ⇒ 「鼠标移开就全过」掩盖了真实缺陷。这里用额外的 class（:where 不提升特异性）
  // 给**每个采样元素**的祖先行加上强制 hover 底色，再量一次。
  const hoverSheet = document.createElement('style');
  hoverSheet.id = '__wb_audit_hover';
  // 与各组件真实的 :hover 底色保持一致（.prow/.ritem → --panel2；.d-item → --hover-veil）
  hoverSheet.textContent =
    '.waudit-hover{background:var(--panel2) !important}' +
    '.waudit-hover.d-item{background:var(--hover-veil) !important}';
  document.head.appendChild(hoverSheet);
  for (const pair of CONTRAST_TARGETS) {
    const sel = pair[0], label = pair[1];
    const els = Array.from(document.querySelectorAll(sel)).slice(0, 12);
    for (const el of els) {
      const cs = getComputedStyle(el);
      const fg = _parseColor(cs.color);
      if (!fg) continue;
      // 文字画在「自身背景」上：自身透明则逐层向上找（渐变取首色 + alpha 逐层合成）
      const bg = _effectiveBg(el);
      const fs = parseFloat(cs.fontSize) || 14;
      const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
      const large = fs >= 24 || (fs >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      const ratio = _contrast(fg.rgb, bg);
      checked++;
      rows.push({ sel: label + '<' + sel + '>', ratio: ratio, need: need, fg: cs.color, bg: 'rgb(' + bg.join(',') + ')', fs: fs });
      // —— hover 态复测：把最近的「行」祖先强制切到 hover 底色，再量一次 ——
      const row = el.closest('.prow,.ritem,.ucard,.b,.lcard,.d-item,.ckrow') || el.parentElement;
      if (row && row !== el) {
        row.classList.add('waudit-hover');
        const cs2 = getComputedStyle(el);
        const fg2 = _parseColor(cs2.color);
        const bg2 = _effectiveBg(el);
        if (fg2) {
          const r2 = _contrast(fg2.rgb, bg2);
          checked++;
          rows.push({ sel: label + '<' + sel + '>·hover', ratio: r2, need: need, fg: cs2.color, bg: 'rgb(' + bg2.join(',') + ')', fs: fs });
        }
        row.classList.remove('waudit-hover');
      }
    }
  }
  freeze.remove();
  hoverSheet.remove();
  const min = rows.length ? Math.min.apply(null, rows.map(r => r.ratio)) : 0;
  const fail = rows.filter(r => r.ratio < r.need);
  const bodyCs = getComputedStyle(document.body);
  return {
    total: checked, min: min, fail: fail, rows: rows,
    bodyColor: bodyCs.color,
    bodyBg: (function () { const b = _effectiveBg(document.body); return 'rgb(' + b.join(',') + ')'; })()
  };
}
