'use strict';
/* 工作台渲染进程入口（v1.6 建立，v1.7.41 按职责彻底拆分为平铺模块）
   全部通过 preload 暴露的 window.wb 与主进程通信。

   模块加载顺序（index.html 中 <script> 顺序即依赖顺序，全部同目录平铺、无构建工具）：
     contrast.js   对比度审计（WCAG 计算）
     format.js     格式化工具（fmtMB/hueOf/greet…）
     theme.js      主题引擎 + 通用工具（cssVar/relTime/avatarStyle…）
     history.js    历史快照纯函数（normHistory/historyStats/historyDiff…）
     brief.js      今日简报子系统（buildBrief/briefMarkdown/weeklyMarkdown…）
     visual.js     可视化渲染（脉搏 canvas / 热力图）
     search.js     搜索内核（分词 AND/拼音/模糊）
     interaction.js 事件委托 + 命令面板（doAct/palIndex…）
     views.js      视图渲染层（render/setView + 六视图）
     qa.js         22 个 QA 取证钩子
     app.js        本文件：仅全局工具 $/$$/esc + 启动 init()

   为什么这样拆可行：所有模块都是普通 <script> 顶层声明，函数/变量在同一全局作用域；
   每个模块的函数只在**被调用时**才访问其他模块的依赖，而唯一入口 init() 在本文件最后调用，
   那时全部模块已加载完毕 ⇒ 依赖永远就绪、调用点零改动。 */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

init();
