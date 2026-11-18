/* 可视化渲染（机器脉搏 canvas + 编码热力图，v1.7.41 抽为独立文件平铺在 renderer/）。依赖 cssVar/window.wb/document/DATA/esc 均在调用时延迟访问，在 app.js 之前加载、全局可见，init/渲染调用点零改动。 */
/* ---------- 机器脉搏 ---------- */

const PULSE = { samples: [], max: 120, started: false };

function bindPulse() {
  window.wb.onPulse(s => {
    PULSE.samples.push(s);
    if (PULSE.samples.length > PULSE.max) PULSE.samples.shift();
    drawPulse();
  });
  window.wb.pulseStart();
  PULSE.started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) window.wb.pulseStop();
    else window.wb.pulseStart();
  });
}
function pathOf(ctx, key, w, h) {
  const arr = PULSE.samples;
  const stepX = w / (PULSE.max - 1);
  arr.forEach((s, i) => {
    const x = w - (arr.length - 1 - i) * stepX;
    const y = h - (s[key] / 100) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
}
function drawPulse() {
  const cv = document.getElementById('pulse-cv');
  const last = PULSE.samples[PULSE.samples.length - 1];
  const c1 = document.getElementById('pn-cpu'), c2 = document.getElementById('pn-mem');
  if (c1) {
    c1.textContent = last ? last.cpu + '%' : '--%';
    c1.style.color = last && last.cpu > 80 ? 'var(--red)' : '';
  }
  if (c2) {
    c2.textContent = last ? last.mem + '%' : '--%';
    c2.style.color = last && last.mem > 85 ? 'var(--red)' : '';
  }
  if (!cv || !cv.clientWidth || !PULSE.samples.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = cssVar('--canvas-grid', 'rgba(255,255,255,.05)');
  ctx.lineWidth = 1;
  [25, 50, 75].forEach(p => {
    const y = h * p / 100;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    const x = w * p / 100;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  });
  const arr = PULSE.samples;
  const stepX = w / (PULSE.max - 1);
  // CPU：渐变填充 + 线（颜色取自 CSS 变量，随主题切换）
  ctx.beginPath();
  pathOf(ctx, 'cpu', w, h);
  ctx.strokeStyle = cssVar('--acc', '#4d9fff'); ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(w - (arr.length - 1) * stepX, h);
  ctx.closePath();
  ctx.fillStyle = cssVar('--canvas-fill', 'rgba(77,159,255,.13)');
  ctx.fill();
  // 内存：纯线
  ctx.beginPath();
  pathOf(ctx, 'mem', w, h);
  ctx.strokeStyle = cssVar('--acc2', '#a78bfa'); ctx.lineWidth = 1.6; ctx.stroke();
  // 最新点
  const lx = w, ly = h - (last.mem / 100) * (h - 8) - 4;
  ctx.beginPath(); ctx.arc(lx - 2, ly, 2.5, 0, Math.PI * 2); ctx.fillStyle = cssVar('--acc2', '#a78bfa'); ctx.fill();
}

/* ---------- 热力图 ---------- */

function heatCard() {
  const act = DATA.activity || [];
  const max = Math.max(1, ...act.map(a => a.count));
  const cells = act.map(a => {
    let cls = '';
    if (a.count > 0) {
      const r = a.count / max;
      cls = r < .25 ? 'l1' : r < .5 ? 'l2' : r < .75 ? 'l3' : 'l4';
    }
    return '<div class="hcell ' + cls + '" title="' + esc(a.date) + ' · ' + a.count + ' 个文件变动"></div>';
  }).join('');
  const active = act.filter(a => a.count > 0).length;
  const busiest = act.slice().sort((a, b) => b.count - a.count)[0];
  return '<div class="b-sec-t"><span>编码节奏<span class="muted small" style="margin-left:6px">近 90 天</span></span>' +
    '<span class="muted small">' + active + ' 天活跃 · 峰值 ' + (busiest ? busiest.count : 0) + '</span></div>' +
    '<div class="heat">' + cells + '</div>' +
    '<div class="heat-legend">少 <div class="hcell"></div><div class="hcell l1"></div><div class="hcell l2"></div><div class="hcell l3"></div><div class="hcell l4"></div> 多</div>';
}
