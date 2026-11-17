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
