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

## PM 自驱层（第十轮起，lead 只做验收）

治理文件（由 PM agent 每轮维护）：

| 文件 | 作用 |
|---|---|
| `pm/PM.md` | 项目经理 agent 角色定义、权力边界、7 步 SOP、质量红线 |
| `pm/STATE.md` | 状态机：当前版本 / 交付态 / 最近一轮 / 下一轮指针 / 里程碑 |
| `pm/BACKLOG.md` | 待办池：READY / DOING / DONE / IDEA，含验收标准；巡检发现的新问题自行补充 |
| `pm/PROMPT.md` | 定时任务投喂的唤醒提示词全文（可审计） |

- 触发器：`schedule_create` 定时任务「工作台 PM 自驱迭代」，target `new_once`，`FREQ=HOURLY;INTERVAL=6`（每 6 小时一次，首触发 2026-11-15 22:00 本地）。
- 每轮由 PM agent 自主执行：巡检 → 选 1 个 READY 项 → 决策留痕 → 实现 → QA 门禁 → 发版 → 更新治理文件。
- **一轮一主题**；QA 不过不硬发版；待办枯竭时只写巡检报告；结束保留打包版运行态。
- 用户已永久授权全部自主决策，PM agent 禁止提问或等待确认。

## 版本入库（每轮收尾）

- 脚本：`workbench-electron/auto-commit.ps1 -Message "<本轮主题：v<版本> <一句话>"`
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
