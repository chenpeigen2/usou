# 工作台架构地图（renderer 平铺模块）

> 面向维护者（含看门狗唤醒的新 agent）的"一图流"。仓库已铺平到根，renderer/ 下 **16 个平铺 JS**、无子目录/package、无构建工具、零运行时 npm 依赖。
> 全部是普通 `<script>` 顶层声明、共享同一全局作用域；函数只在**被调用时**访问依赖，唯一入口 `init()` 在最后一个 script（app.js）调用 ⇒ 加载顺序即依赖顺序、调用点零改动。

## 一、模块职责地图（按 index.html 加载顺序）

| # | 模块 | 行数 | 职责 | 关键导出（全局可见） |
|---|---|---|---|---|
| 1 | `state.js` | 212 | 全局状态 + 初始化 + IPC 订阅 | `DATA/SETTINGS/HISTORY/FAVS/...`、`refreshState()`、`init()`、`startScan()` |
| 2 | `contrast.js` | 135 | WCAG 对比度审计 | `auditContrast()`、`_contrast()` |
| 3 | `format.js` | 68 | 纯格式化 + 体量去重 | `fmtMB()`、`sizeTotals()`、`projPathKey()`、`shortPath()` |
| 4 | `theme.js` | 178 | 主题引擎 + 通用工具 + 头像墨色 | `cssVar()`、`applyTheme()`、`relTime()`、`freshness()`、`avatarStyle()` |
| 5 | `history.js` | 114 | 历史快照纯函数 | `normHistoryProjects()`、`historyStats()`、`historyDiffItems()`、`HIST_LEGACY_*` |
| 6 | `brief.js` | 269 | 今日简报子系统 | `buildBrief()`、`briefMarkdown()`、`weeklyMarkdown()`、`refreshBrief()` |
| 7 | `visual.js` | 90 | 机器脉搏 canvas + 热力图 | `drawPulse()`、`heatCard()`、`bindPulse()`、`PULSE` |
| 8 | `search.js` | 115 | 搜索内核（纯函数，可独立单测） | `searchTokens()`、`matchFields()`、`pyInitials()`、`PY_TABLE` |
| 9 | `interaction.js` | 252 | 事件委托 + 命令面板 + doAct 分发 | `doAct()`、`bindDelegation()`、`palIndex()`、`palFilteredFor()` |
| 10 | `detail.js` | 291 | 项目详情弹窗 + 并排对比 | `openProject()`、`openCompare()`、`compareRows()`、`compareMarkdown()` |
| 11 | `system.js` | 204 | 系统页 + 设置页 | `renderSystem()`、`renderSettings()`、`saveSettings()`、`historyTrendHtml()` |
| 12 | `overview.js` | 230 | 总览视图 + 失效检查共用辅助 | `renderOverview()`、`partitionDead()`、`checkProjectExistence()` |
| 13 | `lists.js` | 170 | 项目 + 最近列表视图 | `renderProjects()`、`renderRecent()`、`renderTypeChips()` |
| 14 | `views.js` | 140 | 渲染分发 + 空间分析 | `render()`、`setView()`、`renderDisk()` |
| 15 | `qa.js` | 1085 | 22 个 QA 取证钩子 | `triggerXxxQa()`（只在 URL 带参数时触发） |
| 16 | `app.js` | 22 | 仅入口：`$`/`$$`/`esc` + `init()` | — |

## 二、数据流

```
主进程 main.js ──IPC──> preload.js (contextBridge 白名单 window.wb) ──> renderer
                              │
   state:get ──> refreshState() ──> 填充 DATA/SETTINGS/HISTORY/CAPS/VERSION
                              │
                              ├──> render() ──> 按 view 分发到 overview/lists/views/system
                              ├──> brief.js（简报/周报）
                              ├──> visual.js（脉搏/热力图）
                              └──> qa.js（参数触发时）

   用户交互 ──> interaction.js doAct(act,p) ──> 各业务函数 / window.wb.xxx IPC
   扫描完成 ──> main 广播 scan:done ──> refreshState() + render()
   导入完成 ──> main 广播 data:imported ──> refreshState() + render()（v1.7.46 起，无需重启）
```

**数据源**：扫描缓存 `data/scan-cache.json`（项目/最近/体量/活跃）· 历史 `data/history.json` · 设置 `data/settings.json`。dev 用应用旁 `data/`，打包态自动落 `userData`（%APPDATA%\工作台\）。

## 三、关键不变量（改代码时必须维持）

1. **单一事实源**：数据新鲜度只有 `freshness(scanTime)` 一处；体量只有 `sizeTotals()` 一处（嵌套去重，避免同一磁盘空间算两遍）。
2. **口径成对**：给失效项目加"标记"时必须同步改所有"统计口径"（否则同屏自相矛盾）。
3. **动态文本必转义**：所有注入 DOM 的文本走 `esc()`，Markdown 走 `mdEsc()`；禁止内联 onclick（CSP）。
4. **IPC 只增不改名**：契约见 AGENTS.md；`window.wb` 是冻结对象（contextBridge），无法替换方法——QA 钩子用静态 DOM 断言。
5. **零机器特异性**：扫描根/强制目录/快捷入口从 settings 读，源码无写死盘符/项目名/主机名。
6. **加载顺序**：新模块必须在 index.html 按依赖顺序加入、app.js 永远最后；删/加模块后跑 `verify-delivery.ps1`（已改为动态枚举 renderer\*.js）。
7. **数据自证**：体量口径只能来自 `sizeTotals()` 一处；`verify-invariants.js` 用 Node 独立加载纯函数对 scan-cache 做 6 项数学自证（raw≥unique/dup=raw-unique/count/嵌套父/路径边界），任何 iteration 破坏去重口径都会被门禁拦下。

## 三·五、验证工具（发版前必跑）

| 脚本 | 职责 | 门禁项 |
|---|---|---|
| `verify-delivery.ps1` | 14 项交付门禁（进程/产物/版本/旧版清理/日志/治理/语法/时序/机器特异性/数据不变量） | 全部 |
| `verify-invariants.js` | Node 独立加载 format.js 纯函数，对 scan-cache 做 6 项数学自证（零依赖只读） | 第 14 项 |
| `auto-commit.ps1` | 只 commit 不 push（用户自行 push），报告待推送数 | 收尾 |

> 两个 verify 脚本路径均从自身位置推导（`$PSScriptRoot` / `__dirname`），不含机器特异性硬编码。

## 四、IPC 契约（main.js 实际注册）

- **handle（有返回）**：`state:get` `scan:start` `path:open/show/exists` `open:in` `git:detail` `project:detail/dirs` `disk:analyze` `settings:set` `login-item:set` `brief:copy/export` `scan-errors:clear` `data:export/import/peek`
- **on（单向）**：`pulse:start/stop` `win:minimize/maximize/close`
- **主进程广播**：`pulse` `scan:progress/done/error/persist-error` `analyze:progress/done/error` `scan-errors:changed` `scan:auto` `data:imported`

## 五、自驱架构

三层（L1 微循环 / L2 链式续轮 / L3 看门狗）+ 7 造活源，详见 `pm/PM.md` 第五节。状态机 `pm/STATE.md`，决策库 `DECISIONS.md`，交付说明 `DELIVERY.md`，QA 探针范式 16 条见 `AGENTS.md`。
