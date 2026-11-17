# 工作台 · 交付总览

> 本文件是接手人/新会话的快速上手入口。所有数字来自本机实测与 git 仓库状态，非推演。
> 迭代日志见 [DECISIONS.md](../workbench/DECISIONS.md)（2323 行），版本变更流水见 [README.md](README.md)。

## 一、这是什么

一个**纯本地、零运行时依赖**的 Electron 桌面工作台，用于管理本机项目、分析磁盘空间、快速启动与生成每日简报。

- 技术栈：Electron 33.4.11（内置运行时）+ 原生 Node 模块 + 原生 JS/CSS，**无前端框架、零 npm 运行时依赖**。
- 数据：全部本地文件（`scan-cache.json` / `history.json` / `settings.json` 等），**对用户项目文件只读**。
- 安全：contextIsolation 开 / nodeIntegration 关 / CSP 白名单 / preload `contextBridge` 白名单 `window.wb`。
- 规模：git 跟踪 29 个源码文件，JS/HTML/CSS 合计约 5300 行。

## 二、交付状态（当前）

> **以下为写入本文时的快照值，会随迭代变化；当前真实值请按括注命令查询，勿以本文为准。**

| 项 | 写入时快照 | 当前值查询命令 |
|---|---|---|
| 当前版本 | v1.7.36 | `Get-Content package.json -Raw \| ConvertFrom-Json \| Select -Expand version` |
| 安装包 | `out\Workbench-Setup-<版本>.exe` | `Get-ChildItem out\Workbench-Setup-*.exe` |
| 便携版 | `out\Workbench-<版本>-portable.zip` | `Get-ChildItem out\*portable.zip` |
| 交付运行态 | 打包版 `out\win-unpacked\工作台.exe`，4 进程常驻，托盘可用 | `Get-Process 工作台 \| Measure` |
| 验收门禁 | `verify-delivery.ps1` 12 项全 PASS | `pwsh -NoProfile -File verify-delivery.ps1` |
| Git | 本地 commit 持续增长，**未推送远端**（按用户要求只 commit 不 push） | `git rev-list --count HEAD` / `git status` |

> 旧版本产物在每次发版时按绝对路径核验后清除，`out\` 只保留当前版本。

## 三、代码结构

```
workbench-electron/
├─ main.js              主进程：窗口/托盘/自启/扫描调度/IPC/导出
├─ preload.js           contextBridge 白名单（window.wb，22 方法）
├─ src/scanner.js       扫描内核：项目发现/git/体量/活动/最近/工具链（只读）
├─ src/store.js         持久化：扫描缓存/设置/历史/错误诊断
├─ renderer/
│  ├─ index.html        六视图骨架 + 无框架标题栏
│  ├─ app.js            渲染逻辑：视图/搜索/简报/周报/对比/QA 钩子
│  └─ style.css         设计系统（语义 CSS 变量、深浅双主题）
├─ public/build/        图标生成
├─ electron-builder.yml 打包配置（electronDist 复用本地运行时）
├─ auto-commit.ps1      只 commit 不 push 的入库脚本
├─ verify-delivery.ps1  12 项交付验收门禁
└─ pm/                  PM 自驱治理（仅 4 文件，其余不相干文件禁止入内）
   ├─ PM.md / PROMPT.md / STATE.md / BACKLOG.md
```

## 四、六视图与核心功能

| 视图 | 功能 |
|---|---|
| 总览 | 机器简报（可复制/导出 Markdown）、脉搏波形、编码热力图、磁盘环、KPI、最近动态 |
| 项目 | 项目雷达（搜索/筛选/收藏置顶/失效标注）、**项目对比视图** |
| 最近 | Top-60 最近改动（含源码内层、失效沉底 + 标注） |
| 空间 | 磁盘目录构成分析与下钻 |
| 系统 | 扫描历史趋势、工具链版本 |
| 设置 | 外观主题、自动扫描、额外根目录、扫描错误诊断 |

其他：Ctrl+K 万物直达（分词 AND + 拼音首字母 + 相关性排序）、托盘常驻与自动扫描气泡、窗口状态记忆、开机自启、**每周节奏周报**。

## 五、迭代成果（第 28–52 轮）

- 修复 **15 项**深度/新视角巡检遗留缺陷（同屏口径不一致、历史快照 key 塌缩、时间标签假陈述、失效项目统计、命令面板错误动作、持久化失败误报、扫描器覆盖/深度/cutoff 等）。
- 新增 **3 个**功能增量：每周节奏周报、项目对比视图、配套导出前缀机制。
- 多轮**证伪巡检**（搜索召回 / 浅色对比度 / 收藏闭环 / 打包版 IPC / 扫描中关窗），确认无真实缺陷、不强行立项。
- QA 基建审计：22 个 QA 钩子 CLI 透传完整，8 个关键钩子动态冒烟全 PASS。

> 详细决策与自问自答见 `workbench\DECISIONS.md`。

## 六、开发与验收约定（必读）

1. **先杀净所有实例再构建**（否则 EBUSY），构建前清 `ELECTRON_RUN_AS_NODE`。
2. 镜像：`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。
3. 产物名 ASCII、应用名中文；便携 zip 用 `Compress-Archive`。
4. **截图 QA 必做**：`--qashot=<dir>` 主进程逐视图 capturePage（抗桌面焦点抢占），六视图对比度 failCount 必须 0。
5. **阴性对照**：每个修复必须有「旧逻辑不可能通过」的断言，防止碰巧对。
6. **零副作用 QA**：绝不在真实实例里调 `openPath(存在路径)` / `openIn(存在路径)`（会拉起外部窗口），改用 stub recorder。
7. 改用户可见文案时，**同步清点所有依赖该文案字符串做匹配的 QA 钩子**（历史上曾两次因此假 FAIL）。
8. 每轮收尾：`auto-commit.ps1 -Message "..."`，**只 commit，绝不 push**；发布 `verify-delivery.ps1` 全过；保持打包版运行态。

## 七、Git 与推送

```
remote: git@github.com:chenpeigen2/usou.git
branch: main
提交数: 持续增长（当前值查 `git rev-list --count HEAD`），全部本地未推送
```

**推送由用户手动执行**（本 agent 按明确要求从不 push）：
```
cd D:\code\usou
git push -u origin main
```

> 网络实情：本机 SSH/HTTPS 到 GitHub 受 DPI 干扰（SSH 在 kex 阶段 reset、HTTPS schannel 握手失败、代理离线），TCP 连通/curl 200 均为假阳性；推送失败多为网络原因，非仓库问题。

## 八、关键不变量（防回归）

- 失效项目（磁盘上已不存在）在**所有**统计口径中剔除：总览数字条 / 类型 chip / 列表统计 / 托盘 / 简报。
- 「未提交」「有新提交」等陈述必须与同屏其他视图一致；时间标签随数据新鲜度切换「N 分钟前」⇄「于 MM-DD HH:mm」。
- 历史快照：旧 name-key 快照标 `legacy`，新 path-key 快照按绝对路径配对；同名项目不塌缩、跳转按 path。
- 所有用户可见文案的度量值，都必须能被独立重算复现（数据侧独立重算是本项目的核心巡检方法）。
