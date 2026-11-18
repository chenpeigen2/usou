# 工作台多 Agent 迭代框架

> 由 lead（编排者）驱动，各 Agent 按文件所有权分工作业，互不覆写。
> 每轮迭代流程：拆解 → 并行开发 → QA 门禁 → 打包发版 → 交付运行态。

## 角色与所有权

| Agent | 职责 | 文件所有权（只能改） | 禁止触碰 |
|---|---|---|---|
| **lead** | 自问自答拆需求、编排调度、验收集成、写决策记录 | AGENTS.md / DECISIONS.md / README.md | 业务代码 |
| **backend-agent** | 主进程功能：托盘常驻、关闭拦截、窗口状态记忆、开机自启、脉搏采样频率 | main.js、preload.js、src/store.js | renderer/*、package.json、electron-builder.yml |
| **frontend-agent** | 渲染层视觉与交互打磨 | renderer/app.js、renderer/style.css、renderer/index.html | main.js、preload.js、src/*、package.json |
| **qa-agent** | 语法门禁、逐屏截图目检、小问题修复+复验、产出 qa-report.md | renderer/*（仅修复）、qa-report.md | 主进程逻辑、打包配置 |
| **build-agent** | 版本号、electron-builder 打包、便携 zip、数据预置、冒烟与托盘/单实例实测 | package.json(version)、out/* | 业务逻辑 |

## IPC 契约（只增不改名）

- `state:get` → `{ cache, settings, caps, history, loginItem, version }`
- `scan:start / path:open / path:show / open:in / git:detail / disk:analyze(root, force) / settings:set`
- `project:detail(p)` → `{ git, readme }`（详情弹窗）；`project:dirs(p)` → `{ root, totalSize, items }`（目录构成，异步懒加载）
- `pulse:start / pulse:stop` + 推送 `pulse`（1s 采样）
- `win:minimize / win:maximize / win:close / win:state`
- `login-item:set(open)` → 开机自启

## 设置项（settings.json）

`skipSizes` · `extraRoots` · `trayMinimize`(默认 true) · `winBounds` / `winMaximized`(窗口记忆) · `autoScanHours`(默认 0=关，自动扫描间隔)

## QA 门禁（qa-agent 必须全过）

1. `node --check` 全部 JS 零错误
2. 六视图（overview/projects/recent/disk/system/settings）逐屏截屏目检
3. 检查清单：无空面板/多余遮罩、脉搏有波形、热力图铺满、磁盘环按用量变色、简报时间轴、SVG 图标、标题栏刷新按钮、布局无破碎
4. 打包版冒烟：进程存活、日志无 [renderer] 错误、pulse started、单实例锁生效

### QA 探针范式（避免「假缺陷」—— 第 51/64/67/68 轮教训）

巡检/验收时先确认探针本身正确，再判断是否真有缺陷。反复踩过的坑：

1. **走用户真实路径，不直接调底层 bridge**：主题切换走 `setTheme()`（applyTheme 立即生效 + saveSettings 落盘），直接调 `saveSettings({theme})` 只会落盘不更新 DOM ⇒ 误报「切换无效」（第 67 轮）。`saveSettings` 的 patch 不含 theme/extraRoots 之外的很多字段。
2. **CDP `Runtime.evaluate` 里 await 必须包在 async IIFE 中**：`JSON.stringify(await window.wb.xxx())` 会语法错；用 `(async()=>{...})()` 包裹（第 51/64 轮）。
3. **批量 IPC 要传对参数类型**：`path:exists` 收数组返回 `{path:bool}` 映射，传单字符串返回 `{}` 是正确的（第 51 轮）。
4. **读 DOM 统计只取目标元素 textContent**：不要对 `parentElement.textContent` 做 `replace(/[^0-9]/g,'')`（会把其他数字一起抓进来，第 68 轮误报 47/36/2）。
5. **「恢复/回滚」后必须立即验证结果**：不能凭「执行了复制命令」就声称恢复成功 —— 备份要在变更前建立（第 57 轮 dev 缓存未真正恢复却在记录里写了「已还原」）。
6. **改用户可见文案时同步清点依赖该字符串的 QA 钩子 finder**（第 35/36 轮 `--dayqa` finder 假 FAIL）。
7. **零副作用**：绝不在真实实例里调 `openPath(存在路径)` / `openIn(存在路径)`（会拉起外部窗口），改用 stub recorder（第 24/32 轮）。
8. **PowerShell 函数名不要与外部命令同名**（第 72 轮真实 bug）：`auto-commit.ps1` 里 `function Git` + `$git='git'` ⇒ `& $git` 匹配到同名函数自身 → **无限递归溢出**。改用 `RunGit` 这类不会撞命令名的前缀。脚本路径一律从 `$PSScriptRoot` 推导，不写死本机目录。
9. **CDP CSS 选择器里冒号值要转义或用属性匹配**（第 93/107 轮）：`[data-act=recent:deadonly]` 的冒号被当作伪类 ⇒ 选择器失效误判「按钮不存在」；改用 `Array.from(document.querySelectorAll('.chipbtn')).find(b=>b.dataset.act==='recent:deadonly')` 或 `querySelector('[data-act=compare\\:open]')`。
10. **DOM 选择器要跟实际类名走，不要凭记忆猜**（第 106 轮）：总览 KPI 用 `.mini .big` 不是 `.stat .big`；类型筛选按钮用 `.chipbtn` 不是 `.chip`。取 0 时先 dump `Array.from(...).map(e=>e.className)` 看真实结构，再判断是否缺陷。
11. **跨文件抽取后必须重新定位行号**（第 86/87 轮）：从大文件抽走一段后，后续段的起始行号全变；按旧行号截取会截断函数 IIFE ⇒ `node --check` 报 Unexpected end of input。每次抽取前用 `Select-String` 重新确认边界，抽完先 `node --check` 新文件。
12. **打包版 CDP 不要调会弹原生对话框的 IPC**（第 102 轮）：`data:import` 会弹 `showOpenDialog` 阻塞测试；这类 IPC 只验证函数暴露（`typeof window.wb.dataImport`）与 UI 接线，核心逻辑在隔离临时目录用 Node 实测。
13. **`Page.captureScreenshot` 在窗口被遮挡时 Promise 永不 resolve**（第 109 轮，非报错非空图）：必须加硬超时（60s）；`fromSurface:false` 无效；解法是先把窗口置顶（`SetWindowPos HWND_TOPMOST`）再截，或用「DOM 断言 + PrintWindow」双通道。
14. **`PrintWindow(PW_RENDERFULLCONTENT)` 对 Chromium 返回最后一帧缓存**（第 109 轮）：两张不同视图截图 sha256 完全相同 ⇒ **每张截图必须验哈希变化**，否则会把旧画面当新证据。
15. **contextBridge 暴露的 window.wb 是冻结对象**（第 110 轮）：`Object.isFrozen(window.wb)=true`，方法 `writable:false/configurable:false`，**无法替换做记录器**（如 `wb.analyze=spy` 静默失败）；QA 钩子验证点击接线改用静态 DOM 断言（按钮 `data-p` 与行路径一致）。证据行注入到 `document.body` 而非 `#view`（视图重绘会冲掉内部节点）。
16. **巡检要「算」不要只看**（第 109 轮真实缺陷来源）：把 59 个项目体量相加与界面数字对账，才发现嵌套目录重复计 5.4GB——四种视图全都「显示正常」。数据自证是发现同族「陈述不成立」缺陷的最高产手段。

> 疑似缺陷先按上述清单自查探针（尤其第 9/10 条的"选择器错误"是近期最高频误判源），确认不是测试方式问题后再立项 —— BACKLOG 攒满假线索会消耗后续判断力。

## PM 自驱层（第十轮起，lead 只做验收）

治理文件（由 PM agent 每轮维护）：

| 文件 | 作用 |
|---|---|
| `pm/PM.md` | 项目经理 agent 角色定义、权力边界、7 步 SOP、质量红线 |
| `pm/STATE.md` | 状态机：当前版本 / 交付态 / 最近一轮 / 下一轮指针 / 里程碑 |
| `pm/BACKLOG.md` | 待办池：READY / DOING / DONE / IDEA，含验收标准；巡检发现的新问题自行补充 |
| `pm/PROMPT.md` | 定时任务投喂的唤醒提示词全文（可审计） |

- 触发器：`schedule_create` 定时任务「工作台 PM 自驱迭代」，target 当前会话，`FREQ=HOURLY;INTERVAL=6`（每 6 小时，仅会话中断后保活；正常由 L2 链式连续跑）。
- 三层自驱架构（持续到 token 耗尽）见 `pm/PM.md` 第五节：L1 微循环（7 步 SOP）/ L2 链式续轮 / L3 看门狗；**待办枯竭时按 7 造活源找下一主题，不停止迭代**。
- 每轮由 PM agent 自主执行：巡检 → 选 1 个 READY 项 → 决策留痕 → 实现 → QA 门禁 → 发版 → 更新治理文件。
- **一轮一主题**；QA 不过不硬发版（回滚该轮、记录、继续下一轮）；结束保留打包版运行态。
- 用户已永久授权全部自主决策，PM agent 禁止提问或等待确认。唯一正常终止 = token 耗尽或用户显式打断。

## 版本入库（每轮收尾）

- 脚本：`auto-commit.ps1 -Message "<本轮主题：v<版本> <一句话>"`
- 行为：自动 `git add -A` + commit（消息含版本号与变更文件数），并报告本地待推送 commit 数。
- **默认只 commit，绝不代为 push**——用户明确要求 push 由自己执行。仅在用户显式指示时才使用 `-Push` 开关。
- 仓库：`git@github.com:chenpeigen2/usou.git`，分支 `main`，remote 已配置。

## 打包协议（build-agent）

1. **先杀干净所有实例再构建**（历史教训：运行中重建会 EBUSY / 打断运行态）
2. 镜像：`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
3. `electronDist` 复用本地运行时；产物名 ASCII、应用名中文
4. 便携 zip 用 `Compress-Archive`（7za 在本机不可靠）
5. **清理历史残留**：`out\` 下只保留当前版本的 Setup / zip / blockmap——删除**所有**旧版本号产物
   （`Workbench-Setup-<旧版本>.exe`、`.zip`、`.blockmap`），避免历轮反复列为遗留风险；
   删除前必须核验绝对路径位于 `out\` 之内。
6. 预置 `%APPDATA%\工作台\`（scan-cache.json + history.json）实现首启秒开
7. 结束保留打包版运行态 = 交付状态

