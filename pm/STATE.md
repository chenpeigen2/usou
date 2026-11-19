# 工作台自驱迭代 · 状态机

> 由 PM agent 每轮 SOP 第 3/7 步更新。这是「记忆」——让每轮唤醒不用重新认识项目。

## 自驱架构（三层 · 持续到 token 耗尽）

> 用户最新指令「继续迭代直到 token 消耗完成」。架构详见 `pm/PM.md` 第五节。

| 层 | 机制 | 职责 | 终止 |
|---|---|---|---|
| L1 微循环 | 7 步 SOP | 一轮一主题：巡检→决策→实现→QA→发版→收尾 | 单轮完成 |
| L2 链式续轮 | goal 自动 continuation（本会话） | 收尾立即进下一轮，不等人 | token 耗尽 / 用户打断 |
| L3 看门狗 | schedule 每 6h 唤醒（target 本会话） | 会话中断后读 STATE/BACKLOG 接手 | 用户删除任务 |

- **造活机制**：READY 清空不是停止信号 —— 按 PM.md 第五节 7 源（深度巡检/代码组织/QA 深化/健壮性/性能/新功能/文档治理）找下一轮主题。
- **异常不终止**：QA/发版失败 → 回滚该轮、记录、跳过继续；agent 无输出 → 自查现场接手不重做。
- **唯一正常终止**：token 耗尽或用户显式打断。
- **看门狗任务**：`schedule-b798db75-cd2e-4d7f-b326-f4badb9a0d01`，每 6 小时，target = 当前会话。

## Git 版本管理（每轮收尾）

- **仓库**：`git@github.com:chenpeigen2/usou.git` · 分支 `main` · remote 已配置
- **入库**：`auto-commit.ps1 -Message "<本轮主题：v<版本> <一句话>"` → 自动 `add -A` + commit（消息含版本号与变更文件数），并报告本地待推送 commit 数
- **只 commit，不 push**：用户明确要求 push 由自己执行，**流程绝不代推**（仅用户显式指示时才用 `-Push`）
- **网络实情**：公司网阻断 GitHub（SSH 22/443 reset；HTTPS TLS 被 DPI 拦）；本机注册表有 Clash/Mihomo 混合端口 `127.0.0.1:7897`，代理启动后即可推。不影响本地 commit
- **`.gitignore` 边界**：排除 Electron 运行时(268MB)、`out\` 产物(465MB)、node_modules、Chromium 缓存、QA 临时探针/截图/隔离 profile —— 只入库源码 + 治理文档 + 可复现构建脚本

## 当前

- **本轮状态**：DONE · 第一百七十三轮 / v1.7.81 · **「筛选 chip 视觉重做 + 工具栏单行 + 导航悬浮更深」**
- **版本**：v1.7.81
- **交付态**：`out\Workbench-Setup-1.7.41.exe`（87,635,507 B）+ `out\Workbench-1.7.41-portable.zip`（118,739,420 B）+ blockmap；打包版 4 进程（ProductVersion 1.7.41.0）运行中，托盘在位；预置数据已刷新为 2026-11-18 17:22 真实扫描（69 项目 / 7 快照）
- **累计成果**：真实缺陷修复 20+ 项；证伪/治理轮 15+；本地 commit 持续增长（只 commit 不 push）
- **READY**：空；IDEA 池 7 项（多机器合并 / 看文件修改 / 全字库拼音 / 数字条换行 / 空间页空态 / +2 既有）
- **下一轮指针**：造活源第 2/5/6 项（代码组织深化 / 性能实测 / 新功能）中任选，本轮 IDEA 已补充两条低风险候选
- **巡检口径提醒**：窗口被遮挡时 `Page.captureScreenshot` 会**挂起不返回**（不是报错）⇒ 截图前先 `SetWindowPos HWND_TOPMOST`；`PrintWindow` 对 Chromium 只回最后一帧缓存（两张不同视图 sha256 相同）⇒ 截图必须验哈希

## 最近一轮（第一百一十轮 / v1.7.42 · 真实缺陷）

- 主题：**项目总体量的嵌套去重** —— 造活源第 1 项「深度巡检」换角度：**拿数据做数学自证**（把 59 个项目体量相加再与界面数字对账）
- 决策：`DECISIONS.md` 第一百零九轮（选题依据 + 双份量化证据 + 实现取舍 + 验证与踩坑）
- **根因**：项目 `sizeMB` 是「递归统计自己全部内容」，而项目发现规则允许父目录与其子目录同时成为项目（本机 5 对）⇒ 直接求和把同一份字节算两遍。旧缓存 59 项目：raw 107.25 GB / 重复 **5.4 GB（5.04%）**；新扫描 69 项目：raw 99.89 GB / 重复 4.46 GB。错值出现在总览数字条 / 项目统计行 / 系统页趋势表 / 折线 4 处。
- 实现（6 文件 + main.js 一行透传，**零新增 IPC / 零 src 改动 / 零数据文件结构改动**）：`format.js` 纯函数 `sizeTotals()`（只累加不在其他项目目录内的项目、三层链只计最外层、路径按 Windows 语义 + 路径边界）；`overview.js` 数字条用去重值 + 悬停说明（`miniStat` 新增 tip 参数）；`lists.js` 统计行「体量 95.43 GB（已去重 5 个嵌套项目 · 4.46 GB）」；`history.js` 对新格式（路径键）快照重算去重、旧格式保留原值 + 口径说明；`qa.js` 新增 `--sizeqa=1`；`state.js`/`main.js` 接线。
- 验证：`node --check` 21/21；`--sizeqa=1` **11/11 PASS**（合成 1500/2300/800 + 边界 3/3 + 历史口径 + 真实双视图）；**阴性对照**：临时改回直接相加 ⇒ `总览=false 旧值未出现=false | FAIL`，还原即 PASS；**数据侧独立互证**：Node 直读 `data\scan-cache.json` 重算与 DOM 逐位一致（102288.4/4563.5/97724.9 MB、5 对嵌套）；**端到端真实扫描**：69 项目/99.8s/7 快照，新快照存 `totalMB=102288`（原始和）而系统页显示 **95.43 GB**；深浅两套六视图对比度 failCount 全 0（深 4.73 / 浅 4.89）；**几何量测**：6 张数字条卡片恒 174×92、新旧数值串换行行为一致 ⇒ 零布局回归；打包版 v1.7.41 CDP 复测同样 PASS、页脚 v1.7.41。
- 发版：`package.json` 1.7.40 → **1.7.41**；杀净实例（remaining=0）、`ELECTRON_RUN_AS_NODE` 不存在、镜像 npmmirror、`npx electron-builder` exit 0；`Compress-Archive` 出 zip；1.7.40 三产物按绝对路径核验 `underOut=True` 后删除（旧版本残留 = 0）；预置 `%APPDATA%\工作台\`（scan-cache + history 刷新为真实扫描）；打包版 4 进程、`app ready / window created / tray created / pulse started` 全 True、本次会话 `[renderer]` 错误 = 0。
- **ACL 事故（本轮开头，已修复）**：会话启动时 `windows-acl workspace grant failed (Win32 5)` —— `D:\code\usou` 缺 `WRITE_OWNER`。用 `diagnose-windows-acl` 脚本一次跑完诊断+修复（备份 `D:\code\acl-recovery-20261118\`、GRANTED 并 verified），随后沙箱恢复正常。**副作用**：该恢复目录落在 `D:\code` 下，被下一次扫描识别为一个 0.1 MB 的非 git「项目」（无害，删目录后下一轮扫描即消失）。
- **踩坑沉淀（3 条）**：① 窗口被遮挡时 `Page.captureScreenshot` **挂起不返回**（`fromSurface:false` 无效）⇒ 先置顶再截；② `PrintWindow(PW_RENDERFULLCONTENT)` 对 Chromium **只回最后一帧缓存**（不同视图 sha256 相同）⇒ 截图必须验哈希，否则把旧画面当新证据；③ **巡检要「算」不要只看**：本轮唯一真实缺陷在四个视图上全都「显示正常」，靠项目体量相加与界面数字对账才暴露。

## 最近一轮（第二十七轮 / v1.7.17 · 链式续批 · 编排侧第 72 轮）

- 主题：**「今日简报的历史对比失真（新提交判定 + 最近改动口径）」** —— READY 池空 ⇒ 本轮**造活**（真实巡检发现并立项）
- 决策：`DECISIONS.md` 第二十七轮（自问自答 7 问 + QA/发版实测回填）
- **根因/机会（两处，同属「过期快照」家族）**：
  - ① **字段名写错 ⇒ 功能静默失效**：`buildBrief()` 判「有新提交」用 `cc.commitTime > pp.time`，但 `pp` 是 `history.json` 里的**项目条目**（契约 `{dirty,sizeMB,commitTime}`，见 `src/store.js` 的 `appendHistory`）—— **根本没有 `time` 字段**（`time` 只是**快照顶层**的扫描时刻）⇒ `pp.time` 恒 `undefined` ⇒ `cc.commitTime > undefined` 恒 false ⇒ **该分支永不触发**。实测：最近两次快照（13:03:10 → 13:47:54）之间 `fcm-helper` **确有新提交**（`2026-11-10 14:15:17` → `2026-11-16 13:35:59`），**旧逻辑识别数 = 0**；逐快照回溯 5 次对比，**旧逻辑一次都没命中**
  - ② **把已删除文件算成「在动」**：「最近改动集中在 X（N 个文件）」取 `DATA.recent.slice(0,40)` 按 `dir` 分组。实测前 40 条里 **36 条磁盘上已不存在（活 = 4）**，报出的 `D:\code\usou → 34 个文件` **全部已删除**（真实活文件 = **0**）⇒ 简报每天播报「最近改动集中在 D:\code\usou（34 个文件）」，而那个目录里**一个活文件都没有**
- 实现（改动面 = **仅 1 文件** `renderer/app.js`，`buildBrief()` 两处）：① 判定改为 `cc.commitTime > pp.commitTime`（**同一维度**；`!pp.commitTime` 分支已覆盖「上次还没有提交」）；② 「最近改动集中在」改为**复用 v1.7.13 已有的失效集合 `RECENT_DEAD`** 剔除失效条目，且**先剔除再取前 40**（否则死条目先占满窗口、把活文件挤到窗口外 —— 实测活文件里 20 条在原下标 40 之后），**无存活文件则不播报该条**；**零新增 IPC、零新增全局状态、main.js/preload.js/src/style.css/index.html 零改动**
- 验证：语法 6/6（实现后 + 发版前各一遍）、重名函数 0、内联 onclick 0、零外部依赖、**零新增 IPC**、零既有数据文件结构改动；**QA 断言 16/16 PASS（dev + 打包版 v1.7.17 各一遍）**（含「数据契约核实：history 项目条目**无** `time` 字段 ⇒ 根因成立」与「**旧逻辑命中 = 0** ⇒ 证明缺陷真实存在」两条**反向断言**）；**独立数据侧互证 3/3 PASS**（Node 直读缓存 + `existsSync`：失效 36/存活 24、活文件最多的目录 = `Downloads` 12、新提交项目 = `fcm-helper` —— 与运行时**完全一致**，不让应用自说自话）；**几何量测**：简报列表 9 项、`scrollHeight 278 > clientHeight 242`（可滚动）、第 9 项 `top=444 bottom=473` **完全落在列表内**（231~473）⇒ 新条目**真实可见**（不是「DOM 里有但滚不到」）；**4 张截图**目检（dev 浅色总览 / dev 滚动到第 9 条 / dev 浅色对比度 / **打包版总览页脚 v1.7.17**）；深浅两套审计 failCount 全 = **0**（241 元素 / min 4.64~4.73）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- 发版：`package.json` 1.7.16 → **1.7.17**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.16 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（**旧版本残留计数 = 0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**（1.7.17.0）、`app ready/window created/tray created/pulse started` **四项全 True**、全日志 `[renderer]`/error 行 = **0**，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.17.exe`（87,610,932 B / 83.56 MB）、`out\Workbench-1.7.17-portable.zip`（118,704,884 B / 113.16 MB）、blockmap（91,868 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.17.0）
- **巡检发现（本轮）**：交付态健康、**渲染层无缺陷**（六视图审计全 0）；本轮修掉 **2 个既有缺陷**（简报「新提交」永不触发 + 简报「最近改动」把死文件算成在动）；**并行巡检的 agent-30 另发现 2 个同族缺陷并已立项 P1**（失效项目仍计入未提交统计 / history 按项目名做 key ⇒ 同名项目塌缩）
- **QA 方法论沉淀（本轮，3 条）**：① **字段名错了 ⇒ 功能静默失效** —— `pp.time` vs `pp.commitTime` 的一字之差让整条分支永不触发，而它**不报错、不空面板、日志全绿** ⇒ **巡检必须做「数据侧独立重算」**，不能只看渲染截图；② **「在动」只属于还存在的文件** —— 失效条目保留「删除前」的 mtime（往往比活文件新）⇒ 任何「最近 N 条」统计若不剔除失效项，就会**陈述不成立的事实**；③ **先剔除再取窗口** —— 先 `slice` 后剔 ⇒ 死条目占满窗口把活文件挤出去（实测 20 条活文件在原下标 40 之后）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第二十六轮 / v1.7.16 · 链式续批 · 编排侧第 71 轮）

- 主题：**「失效条目沉底（最近动态 / 项目雷达）」** —— READY 池已空 ⇒ 本轮**造活**（真实巡检发现并立项）
- 决策：`DECISIONS.md` 第二十六轮（自问自答 7 问 + QA/发版实测回填）
- **根因/机会**：v1.7.13 只给「最近动态」加了「已删除」角标、v1.7.15 只给「项目雷达」加了 —— 两处都**只解决「标出来」，没解决「排序」**。两个列表都按**快照里的 mtime** 排序，而失效条目保留了「删除前」的 mtime（往往比活文件新）⇒ 实测「最近动态」60 条里 **36 条失效**且**占据前 37 位**（下标 0..33,35,36），**24 条真实文件全被挤出首屏**；项目雷达 59 条里 2 条失效插在**第 3、4 位**；总览「最近动态」卡（取前 9 条）**长期显示 9 条全是死条目**
- 实现（改动面 = **仅 2 文件**）：`renderer/app.js` 新增纯函数 `partitionDead(list, deadSet)`（保持各自原序）+ `recentOrdered()`；`renderRecentList()` 分区渲染（活 → `.deadsep` 分隔行 → 失效）+ 统计行「· 已删除 N（已沉底）」；`renderProjectList()` 比较器加第三级（**收藏 > 存活 > 失效**，收藏是用户显式意图优先）+ 统计行同款文案；总览卡改用 `recentOrdered()`（**与明细视图共用同一套顺序** ⇒ 同一概念两处答案一致）；`checkRecentExistence()` 失效集合变化时**最近视图只重绘 `#recent-list`**（保住搜索框焦点，v1.7.12 同款考量）、其他视图整页重绘；`renderer/style.css` 新增 `.deadsep`（**复用** `--muted2`/`--panel2`/`--hairline`，零新增 CSS 变量）；`CONTRAST_TARGETS` 增 `.deadsep`（新样式**本身**进审计）；**零新增 IPC、main.js/preload.js/src 零改动**
- **本轮自查发现并修复 1 个既有缺陷（非本轮引入）**：浅色主题 `.badge.Android` 在**行被 hover** 时对比度 **4.36:1 < AA**（不 hover 4.67:1 通过）—— 根因是**审计器只量「当前鼠标位置」下的状态** ⇒ 鼠标移开就全过，把缺陷系统性掩盖了。修法：① 浅色 `--green` `#0b7a55` → **`#0a6f4d`**、`--soft-green` 同步 `rgba(10,111,77,.10)`（hover **4.98:1** / 常态 5.36:1 / 对白 6.19:1）；② **审计器增加 hover 态复测**（`.waudit-hover` 强制底色与真实 `:hover` 一致）⇒ 采样量翻倍 **123→238**
- 验证：语法 6/6、重名函数 0、内联 onclick 0（5 处全是既有 JS 属性赋值）、零外部依赖、**零新增 IPC**、零既有数据文件结构改动；**断言 22/22 PASS（dev + 打包版 v1.7.16 各一遍）** + **独立数据侧互证 2/2 PASS**（Node 直接读缓存 + `existsSync` 算出的 36 / 2 与 DOM 完全一致）；**几何量测** `.deadsep` h=32px、fs=11.5px、前一行=活 / 后一行=失效；**深浅两套六视图审计 failCount 全 = 0**（采样量翻倍后：深色全 4.73 / 浅色 4.64~5.07），**打包版 v1.7.16 复测同样 12/12 全 0**；**阴性对照 PASS**（临时注入旧绿 ⇒ 审计器立刻报 3 处 `4.36:1`，还原后归零 ⇒ 证明「全过」不是审计器坏了）；**8 张截图**目检（dev 最近首屏=全活文件 / dev 分隔行 / dev 项目 / dev 总览 / dev 浅色两视图 / **打包版最近（页脚 v1.7.16）** / **打包版分隔行**）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- 发版：`package.json` 1.7.15 → **1.7.16**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.15 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（**旧版本残留计数 = 0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**（1.7.16.0）、`app ready/window created/tray created/pulse started` **四项全 True**、新增 `[renderer]`/error 行 = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.16.exe`（87,610,358 B / 83.56 MB）、`out\Workbench-1.7.16-portable.zip`（118,704,147 B / 113.16 MB）、blockmap（91,811 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.16.0）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；本轮修掉 **2 个既有缺陷**（浅色 hover 态对比度 4.36:1 + 审计器的 hover 盲区）
- **QA 方法论沉淀（本轮，3 条）**：① **对比度审计器必须量 hover 态** —— 此前只量「当前鼠标位置」⇒ 缺陷被系统性掩盖；现在强制复测 + 采样量翻倍，**且必须配阴性对照**（否则「全过」可能只是审计器坏了）；② **「排序」与「标注」是两件事** —— 标注解决「看不出来」，排序解决「挡在前面」，**两者都要做**；③ **总览卡与明细视图必须共用同一套顺序**（同一个 `partitionDead()` 纯函数），否则同一概念在两处给出两种答案
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

- **版本**：v1.7.81
- **交付态**：`out\Workbench-Setup-1.7.15.exe` + `out\Workbench-1.7.15-portable.zip` + blockmap；打包版运行中（含托盘，4 进程，ProductVersion = **1.7.15.0**）
- **运行时数据**：`%APPDATA%\工作台\`（scan-cache.json / history.json / settings.json / main.log；无 dirs-cache.json / scan-errors.json，交付态干净，settings theme=dark · autoScanHours=0 默认）
- **最后巡检**：2026-11-16 18:49 —— 打包版 **4 进程**（`out\win-unpacked\工作台.exe`，ProductVersion = 1.7.15.0）、启动日志 `app ready / window created, query={} / tray created / tray menu rebuilt (启动) / autoScan off (autoScanHours=0) / state:get invoked / pulse started` **四项标志全 True**、全日志 `[renderer]` 行 = **0** / error 行 = **0**、托盘在位（菜单含「上次扫描：5 小时前（13:47）」「未提交：5 个仓库 / 8 个文件」）
- **已知遗留（非本轮缺陷）**：缓存里存着的已删除 QA 临时文件（`pm-r65-*`）已由 v1.7.13 修（不再静默失败、已标注「已删除」），但它们本身要等下一次真实扫描才会从缓存里消失（扫描只收录磁盘上存在的文件 ⇒ 届时 36 条自动清空）；本轮标注的 `D:\wt-demo` / `D:\wt-prev` 同理 —— 它们是**真实用户数据**（不是 QA 临时文件），下次真实扫描后就不再出现在雷达里

## 最近一轮（第二十五轮 / v1.7.15 · 链式续批 · 编排侧第 70 轮）

- 主题：**「项目雷达里的失效项目视觉标注」** —— READY 池最后一项 P3（上一轮自查亲手立项）
- 决策：`DECISIONS.md` 第二十五轮（自问自答 7 问 + QA/发版实测回填）
- **根因/机会**：v1.7.13 只给「最近动态」加了「已删除」角标，**项目视图没有** ⇒ 本机真实数据里 `D:\wt-demo` / `D:\wt-prev` 两个项目**磁盘上已不存在，却仍完整显示在雷达里**（头像/分支/提交/未提交/体量一应俱全）⇒ 用户必须点 💻/⌨️/📂 才会收到「路径已不存在」才知道它没了。**失效路径保护的三个出口（`path:open` / `path:show` / `open:in`）至此全部闭环**，但**视觉层**仍缺最后一块
- 实现（改动面 = **仅 2 文件**）：`renderer/app.js` 新增 `PROJ_DEAD` / `projCheckKey` / `projCheckToken` + `checkProjectExistence()`（**一次批量 IPC，复用 v1.7.13 已有的 `path:exists` 通道 ⇒ 零新增 IPC、main.js/preload.js 零改动**；三防抖与 `checkRecentExistence` 完全同构；失效集合变了**只调 `renderProjectList()` 重绘 `#proj-list` 子容器**，**不调 `render()`** —— 后者在 projects 视图会重建 `#q` 搜索框 ⇒ 用户打字时焦点丢失、输入被清空）；`prow(p)` 失效行加 `is-dead` 类、**「类型徽标」那一格换成 `.deadtag`「已删除」**（⇒ 网格列数不变、零布局位移）、副标题改显「该路径已不存在（可能已被删除或移动）」、体量列改显「—/已失效」、**去掉过期快照的「未提交 ●N」与 `has-dirty` 琥珀条**（目录都没了还标「未提交」= 陈述不成立的事实）；`renderProjectList()` 统计行追加「· 已删除 N」；`renderer/style.css` 新增 `.prow.is-dead` 族 + `.deadhint` + `.deadstat`（**复用 `--muted2` / `--red`，零新增 CSS 变量**）；`CONTRAST_TARGETS` 增 3 条（失效名称/副标题/角标）⇒ **失效样式本身进审计**
- **本轮自查发现并修复 1 个既有布局缺陷（非本轮引入）**：`.prow` 的 `grid-template-columns` 声明了 **5 条轨道**，但 `.prow` 只有 **4 个子元素**（avatar / p-main / p-size / p-actions）⇒ `.p-actions` 被塞进 96px 的第 4 轨，而它要装 5 个按钮（≈189px）⇒ flex 溢出**向左**压到「体量」列文字上（实测存活行重叠 **34~35px**、失效行 26px），同时末尾还留着一条**空轨道**在右侧空出 ≈186px 死区。修法：改为 **4 条轨道**、末轨交给 `.p-actions` 自适应（`minmax(170px,auto)`）⇒ 实测**全表重叠 = 0px**、右侧死区消失。**纯目检只会觉得「有点挤」，是几何量测（`Range.getBoundingClientRect()`）才抓出来的**
- 验证：语法 6/6（实现后 + 改 CSS 后 + 发版前各一遍）、重名函数 0、内联 onclick 0（5 处全是既有 JS 属性赋值）、零外部依赖、**零新增 IPC**、零既有数据文件结构改动；**QA 断言 16/16 PASS（dev + 打包版 v1.7.15 各一遍）**（含「存活 57 行均未被误标」防过度修法）；**跨进程 tasklist 监控 delta = {Code:0, WindowsTerminal:0, cmd:0, wt:0}** ⇒ 点击失效项目**零外部窗口**；**CDP 真实鼠标管线**点失效项目 💻 → 错误 toast「路径已不存在（可能已被删除或移动）」；**深浅两套六视图审计 failCount 全 = 0**（深色 overview 5.16 / projects 5.20 / recent 5.20 / disk 5.54 / system 5.20 / settings 5.54；浅色 5.06 / 4.66 / 4.99 / 5.11 / 4.89 / 4.89）；**7 张截图**目检（dev 项目视图 / dev 失效行放大 / dev 修前修后对照 / dev 浅色 / dev 总览（脉搏波形正常 CPU 14% MEM 86%）/ dev 点击失效项目 toast / **打包版项目视图（页脚 v1.7.15）**）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- 发版：`package.json` 1.7.14 → **1.7.15**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.14 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**，现仅 1.7.15 三产物 + `builder-debug.yml`）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**（1.7.15.0）、`app ready/window created/tray created/pulse started` **四项全 True**、全日志 `[renderer]`/error 行 = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.15.exe`（87,608,948 B / 83.56 MB）、`out\Workbench-1.7.15-portable.zip`（118,702,625 B / 113.16 MB）、blockmap（91,844 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.15.0）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；本轮修掉一个**既有布局缺陷**（`.prow` 栅格 5 轨 vs 4 子元素 ⇒ 按钮压住体量列文字，重叠 34~35px）
- **QA 方法论沉淀（本轮，3 条）**：① **CSS 改动后必须重载页面才生效** —— 改完 `.prow` 栅格后连测 3 次重叠仍是 34~35px，`location.reload()` 后立刻变 **0px** ⇒ 改 CSS ⇒ **先 reload 再量**（否则会误判「改了没用」而去改 JS）；② **窗口最小化时脉搏是空的** —— 主进程 `samplePulse()` 里 `if (!win.isMinimized()) send('pulse', ...)` ⇒ 最小化时 CPU/内存显示 `--%`、canvas 0 个非空像素，**这是环境行为不是应用缺陷** ⇒ 取证前先 Win32 `ShowWindow(SW_RESTORE)` + `SetForegroundWindow` + `RedrawWindow`（恢复后 CPU 15% / MEM 86% / canvas **2718** 个非空像素）；③ **断言集要同时证「该标的标了」与「不该标的没标」** —— 只断言「失效行 = 2」不够（**全体置灰**也能通过）⇒ 追加「存活 57 行均未带 is-dead」+「存活行仍显示类型徽标 57/57」+「失效行 `.p-line` 子元素数与存活行一致」
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起


- **交付态**：`out\Workbench-Setup-1.7.14.exe` + `out\Workbench-1.7.14-portable.zip` + blockmap；打包版运行中（含托盘，4 进程，ProductVersion = **1.7.14.0**）
- **运行时数据**：`%APPDATA%\工作台\`（scan-cache.json / history.json / settings.json / main.log；无 dirs-cache.json / scan-errors.json，交付态干净，settings theme=dark · autoScanHours=0 默认）
- **最后巡检**：2026-11-16 17:53 —— 打包版 **4 进程**（`out\win-unpacked\工作台.exe`，ProductVersion = 1.7.14.0）、启动日志 `app ready / window created, query={} / tray created / tray menu rebuilt (启动) / autoScan off (autoScanHours=0) / state:get invoked / pulse started` **四项标志全 True**、全日志 `[renderer]` 行 = **0** / error 行 = **0**、托盘在位（菜单含「上次扫描：4 小时前（13:47）」「未提交：5 个仓库 / 8 个文件」）
- **已知遗留（非本轮缺陷）**：缓存里存着的已删除 QA 临时文件（`pm-r65-*`）已由 v1.7.13 修（不再静默失败、已标注「已删除」），但它们本身要等下一次真实扫描才会从缓存里消失（扫描只收录磁盘上存在的文件 ⇒ 届时 36 条自动清空）

## 最近一轮（第二十四轮 / v1.7.14 · 链式续批 · 编排侧第 69 轮）

- 主题：**「用 VS Code / 在终端打开」的失效路径保护** —— READY 池最后一项 P3（上一轮自查亲手立项）
- 决策：`DECISIONS.md` 第二十四轮（自问自答 8 问 + QA/发版实测回填）
- **接手线索的自查（本轮第一件事）**：本轮提示要求「先读 STATE 的『第 67 轮中断线索』章节，把线索 B 跑出结论再修」。**核验结论：线索 A 与线索 B 已在第二十三轮（v1.7.13）全部结清** —— 逐行核对 `main.js`：`pathExists(p)`（L584）、`OPEN_PATH_TIMEOUT`（L587）、`path:open` 先判存在性 + 不调 shell + `Promise.race` 15s（L589-609）、`path:show` 返回 `{ok, reason}`（L610-623）、批量 `path:exists`（L627-634）全部在位；渲染层 `checkRecentExistence()`（app.js L1587）+ `RECENT_DEAD` + `.ritem.is-dead` / `.deadtag` 亦在位；BACKLOG 中两条线索对应条目均已 DONE；DECISIONS 第二十三轮已记录探针实测（`shell.openPath(<缺失>)` Promise **5/5 永不落地** + 弹原生模态框，但**主进程事件循环健康** ⇒ 真因是「IPC Promise 悬空 + 原生弹窗」而非「主进程冻结」；`shell.showItemInFolder(<缺失>)` **同步返回、什么都不做** ⇒ 静默失败）。⇒ **不重复跑探针**（那会零新增信息 + 在用户桌面留原生弹窗），改为取 READY 池剩余项
- **根因（探针实测，零副作用）**：`src/scanner.js` 的 `openIn()` **不判存在性** ⇒ 对失效路径**照样 spawn** VS Code / Windows Terminal（用户桌面弹出**它们自己的报错窗**），却回报 `{ok:true}`（谎报成功）⇒ 渲染层 `if (!r.ok) toast(...)` **永不触发** ⇒ **纯静默失败**；其**兜底分支直调 `shell.openPath(p)`** ⇒ 命中 v1.7.13 实测的「Promise 永不落地 + 原生模态弹窗」隐患
- **真实数据侧**：缓存 59 个项目里 **2 个磁盘上已不存在**（`D:\wt-demo`、`D:\wt-prev`，`Test-Path` 双向确认 = False）⇒ 不是假线索
- 实现（改动面 = **仅 2 文件**）：`src/scanner.js` 新增 `OPEN_IN_TIMEOUT=15000` + `openIn` **入口统一判存在性**（空/非字符串 → `{ok:false,msg:'路径无效'}`；不存在 → `{ok:false,msg:'路径已不存在（可能已被删除或移动）'}`、**不 spawn、不调 shell**；存在时行为完全不变；兜底分支加 `Promise.race` 15s 超时 + `catch` 兜底）；`renderer/app.js` 的 `case 'vscode' / case 'term'` 各补 **`.catch()`** 兜底 + 收紧判空（`!r || !r.ok`）；**零新增/改名 IPC**（`open:in` 通道名与 `{ok,msg}` 契约均未变）、零外部依赖、零数据文件结构改动、`main.js`/`preload.js`/`index.html`/`style.css` **零改动**
- 验证：语法 6/6（实现后 + 发版前各一遍）、重名函数 0、内联 onclick 0（5 处命中全是既有 `el.onclick = ...` **JS 属性赋值**、非 HTML 内联）、零外部依赖、**零新增 IPC**；**模块级零副作用探针**（spawn 记录器 + 假 electron 模块）逐条对照：修前失效路径 `spawned=1`/`openPathCalled=1` 且 `{ok:true}` ⇒ 修后 **`spawned=0`/`openPathCalled=0`** 且 `{ok:false,msg:'路径已不存在…'}`，**存在路径行为不变**；**QA 断言 10/10 PASS（dev + 打包版 v1.7.14 各一遍）**；**跨进程 `tasklist` 监控 33 样本 delta = {Code:0, WT:0, cmd:0}** ⇒ 点击失效项目**零外部窗口**；**CDP 真实鼠标**点失效项目 💻 → **658ms** 出错误 toast「路径已不存在（可能已被删除或移动）」（dev 与打包版各一遍，opacity=1）；深色六视图审计 failCount 全 = 0（overview 5.16 / projects 4.73 / recent 4.73 / disk 5.54 / system 5.20 / settings 5.54，与 v1.7.13 基线一致 = 零回归）；**7 张截图**目检（dev 项目视图+toast / dev 干净 / dev 浅色 / dev 总览 / dev 鼠标移开 / **打包版项目视图+toast（页脚 v1.7.14）** / 打包版总览）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- 发版：`package.json` 1.7.13 → **1.7.14**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；旧版本产物按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**，现仅 1.7.14 三产物 + `builder-debug.yml`）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**（1.7.14.0）、`app ready/window created/tray created/pulse started` **四项全 True**、全日志 `[renderer]`/error 行 = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.14.exe`（87,607,553 B / 83.56 MB）、`out\Workbench-1.7.14-portable.zip`（118,700,746 B / 113.16 MB）、blockmap（91,841 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.14.0）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；**自查发现 1 个同款缺陷并立项**：**项目雷达里的失效项目没有视觉标注**（v1.7.13 只给「最近动态」加了「已删除」角标，项目视图没有）⇒ `D:\wt-demo` / `D:\wt-prev` 已不存在却仍显示在雷达里，用户要点按钮才知道 ⇒ 已写入 BACKLOG 的 READY 区（P3）
- **QA 方法论沉淀（本轮，3 条）**：① **回归「成功路径」绝不能在用户实例里真调 `openIn(存在路径)`** —— 本轮第一版 QA 这么做，**真的拉起 12 个 `Code.exe`**（用户桌面开了一排 VS Code 窗口）⇒ 回归必须用**模块级 spawn 记录器**（只记录「本来要 spawn 什么」而不执行）；已按启动时间精确清理自己起的 12 个，未动用户原有进程。② **CDP 截图会把鼠标指针一起拍进去** —— 某行曾出现「叠字伪影」，用**几何重叠检测**证明 overlap = 0 + 鼠标移开重拍 ⇒ 确认是**指针不是布局 bug** ⇒ 截图里的「重叠」先量几何再下结论。③ **本机 Chromium 在窗口被遮挡时把 CSS 动画冻结在 `currentTime = 0`** ⇒ toast 停在 `slideIn` 的 from 态（opacity: 0），**DOM 断言说「在」但截图里看不见**（dev 与打包版**同款** ⇒ 环境问题、非应用缺陷，v1.7.8 换肤过渡已踩过同款坑）；解法 = Win32 `SetForegroundWindow` + `RedrawWindow` **置前并强制重绘**（比 `Emulation.setDeviceMetricsOverride` 可靠，后者会破坏页面导致后续 CDP `fetch failed`）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起


## 最近一轮（第二十三轮 / v1.7.13 · 链式续批 · 编排侧第 68 轮）

- 主题：**失效路径保护（打开前判存在性）** —— 接手第 67 轮（编排侧）中断留下的两条线索；**按要求先花小成本把线索 B 跑出结论，再据结论定修法**；B 与 A 同根因 ⇒ 合成一个主题「打开路径链路的失效保护」
- 决策：`DECISIONS.md` 第二十三轮（自问自答 7 问 + QA/发版实测回填）
- **线索 B 结论（探针实测，一半成立、一半被证伪）**：`shell.openPath(<不存在的路径>)` 返回的 Promise **5/5 用例永不落地**（25s 超时未 settle：ps1 / txt / 无扩展名 / md / 目录），且 Windows 会弹出一个**模态原生错误框**（`EnumWindows` 实测：窗口标题就是那个缺失路径，另有标题 `Error` 的伴随窗口）⇒ 渲染层 `await` 永远挂着 ⇒ **「点了没反应」+ 弹窗挡窗口**；**但主进程并没有被挂起**（25s 内 100ms 心跳跑了 **230~231 次**、最长间隔 **0~7ms**）⇒ 真因是「**IPC Promise 悬空 + 原生模态弹窗**」，**不是**线索 B 字面所说的「主进程冻结 / IPC 通道堵死」。另一侧 `shell.showItemInFolder(<不存在的路径>)` **同步返回、什么都不做**（0ms、`undefined`、不弹窗、不报错、窗口枚举器看不到任何新窗口）⇒ 线索 A 的「点『打开所在目录』**静默失败**」确认（且它连 Promise 都不悬空 —— 因为 `path:show` 直接 `return true`、渲染层完全忽略返回值）
- 实现（改动面：main.js + preload.js + renderer/app.js + renderer/style.css）：`main.js` 新增 `pathExists(p)` 与 `OPEN_PATH_TIMEOUT=15000`；`path:open` **先判存在性**（缺失直接返回「路径已不存在（可能已被删除或移动）」、**不调 shell** ⇒ 既不悬空也不弹原生框），存在则 `Promise.race([shell.openPath, 15s])` 兜底 + `catch` 兜底；`path:show` 改为返回 `{ok:true}` / `{ok:false, reason}`；**新增**批量通道 `path:exists`（数组上限 500，返回 `{路径:bool}`）⇒ `preload.js` 新增 `pathExists` 桥接；`renderer/app.js` 新增 `RECENT_DEAD` / `recentCheckKey` / `recentCheckToken` 与 `checkRecentExistence()`（**一次批量 IPC**，同批路径只查一次、只采纳最后一次结果、失效集合变了才重绘），`recentRow()` 对失效行加 `is-dead` + **「已删除」角标占用「文件类型」那一格（网格列数不变 ⇒ 零布局位移）**，`doAct` 的 `case 'show'` **新增「`ok===false` → toast」**（此前完全忽略返回值 = 静默的根源）；`renderer/style.css` 新增 `.ritem.is-dead`（置灰 + 划线）与 `.deadtag`（红色角标，**刻意不用 opacity** —— 审计器不计 opacity，v1.7.9 踩过）
- 验证：语法 6/6、重名函数 0、内联 onclick 0、零外部依赖、既有 IPC 零改名（只新增 `path:exists`）、零数据文件结构改动；**QA 断言 14/14 PASS，dev 态与打包版 v1.7.13 各跑一遍**：最近视图 60 行 / **失效恰好 36 条**（与 Node 侧独立算出的 36 条一致：ps1×11 png×23 json×1 log×1）/ 角标 36 个；**CDP 真实鼠标管线**点失效行「📂」→ **1ms** 出 toast「路径已不存在，无法打开所在目录」（修前静默）、点文件名 → **1ms** 出「路径已不存在（可能已被删除或移动）」（修前永远挂起）；直接量 `openPath(缺失文件/缺失目录)` 均 **0~1ms** 返回错误串；**存在分支未被写反**（`pathExists → true`、`path:show → {ok:true}`）；深色六视图审计 failCount 全 = 0（recent/projects min 4.73 = 失效行置灰色，仍过 AA）、浅色最近视图 failCount = 0（min 4.99）；**3 张截图**目检（dev 最近视图 / dev 浅色 / 打包版最近视图，侧栏页脚 v1.7.13）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- 发版：`package.json` 1.7.12 → **1.7.13**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.12 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**（1.7.13.0）、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error 行 = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.13.exe`（87,606,827 B / 83.56 MB）、`out\Workbench-1.7.13-portable.zip`（118,699,521 B / 113.16 MB）、blockmap（91,839 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.13.0）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；**自查发现 1 个同款缺陷并立项**：`src/scanner.js` 的 `openIn(p,'vscode'|'terminal')` **不判存在性** → 对已删除目录会拉起 VS Code / Windows Terminal 的报错窗，而应用回报 `{ok:true}` ⇒ **与本轮修掉的静默失败同款**；其兜底分支还**直接调 `shell.openPath(p)`**（未经存在性判断）⇒ 命中本轮实测的「Promise 永不落地」隐患 —— 已写入 BACKLOG 的 READY 区（P3）
- **QA 方法论沉淀（本轮，3 条）**：① `shell.openPath` 对缺失路径会弹**原生模态框** ⇒ **任何调用它的探针都必须跑在可随时 kill 的隔离进程里**（否则会给用户桌面留下弹窗，本轮已实拍到窗口并及时清理）；② 判断「主进程是否被挂起」**不能只看 Promise 有没有落地** —— 必须同时量**事件循环心跳**（本轮心跳证明主进程健康 ⇒ 把修法从「防主进程冻结」纠正为「判存在性 + 不调 shell」）；③ 「静默失败」要用**窗口枚举器**佐证（`showItemInFolder` 缺失路径时不产生任何窗口 ⇒ 真的什么都没发生）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起



## 最近一轮（第二十二轮 / v1.7.12 · 链式续批 · 编排侧第 66 轮）

- 主题：**搜索能力补齐（分词 AND + 拼音首字母 + 子序列模糊 + 相关性排序）** —— READY 池空 ⇒ 按 PM.md 第一节「待办池枯竭时自己造活」升级 IDEA「Ctrl+K 拼音首字母匹配」，评估后发现根因更大（见下）
- 决策：`DECISIONS.md` 第二十二轮（自问自答 8 问 + QA/发版实测回填）
- 根因/机会：**旧搜索内核只有一种匹配** —— `it.keys.includes(qk)` 要求查询串在整条 keys 里**连续出现** ⇒ **多词查询 100% 失效**。用探针跑真实扫描缓存量化：雷达里有 **7 个 TclLauncher 项目**，而「tcl launcher」「code launcher」「tcl launcher hotapp」「tcllnch」「3dww」「gzq」**全部 0 命中**（项目视图 `hay.includes(q)` 同款缺陷，同一数据同一结果）；根因是 `keys` 里 name 是 `TclLauncher`（**无空格**），整串不连续。另发现两处真实缺陷：「最近」视图 60 条记录**没有搜索框**（项目视图却有 ⇒ 同应用内交互不一致）；palette 的 `keys` 在 `p.branch` 为 null 时拼出**字面量 `undefined`**（搜 "undefined" 会命中所有非 git 项目）
- 实现：`renderer/app.js` 新增**搜索内核**（`searchTokens` 分词 / `subSeqMatch` 子序列 / `scoreToken` 四档打分：字段前缀 100 · 字段包含 60 · 拼音前缀 40 · 拼音包含 25 · 标签子序列 8 / `matchItem` 分词 AND / `matchFields` **AND 失败时降级为「仅名称字段 OR」**（得分 ×0.6-1 ⇒ 恒排在 AND 结果之后）/ `pyInitials` 拼音首字母）+ **拼音表 419 字**（按首字母分组）+ `palFilteredFor()` 重写（相关性**稳定**排序 ⇒ v1.7.1 的「收藏恒置顶」不受破坏）+ **最近文件进命令面板**（PAL 81 → 143 条）+ 项目视图搜索改用同一内核 + **最近视图补搜索框**（`#rq` + 子容器 `#recent-list`，只重绘子容器 ⇒ 输入框不失焦）+ `--searchqa=` QA 钩子（5 条断言 + 取证徽标，`textContent` 写入）；`renderer/index.html` 仅改 placeholder 文案；`renderer/style.css` 仅增 `.qa-search-note`（fixed 定位，零布局位移）；`main.js` 仅增 `--searchqa=` 透传；**零新增/改名 IPC、零外部依赖、preload 与 src 零改动、零数据文件结构改动**
- **拼音表不是手写的**：用 Node 内置 ICU 的 `zh-u-co-pinyin` 排序推断（锚点取各首字母组的**最早音节**：啊/八/擦/搭/婀/发/嘎/哈/击/咔/拉/妈/拿/噢/趴/七/然/撒/他/挖/西/鸭/匝，双向夹逼「不早于本组锚点、不晚于下一组锚点」）+ **355 条已知拼音的 ground-truth 断言自证**（生成器自检 0 不符）→ 再由**独立脚本反查**表内 419 字：**0 违规 / 0 不符**。未收录字优雅降级（保留原字，拼音不命中而已，绝不产生错误结果）
- 验证：语法 6/6（实现后 / 两次改动后 / 发版前各一遍）、重名函数 0、无内联 onclick、零外部依赖；**搜索内核量化测试 15/15 PASS**（`node pm/_test-search.js`）+ 新旧对比表（6 条查询从 0 命中 → 命中，`tcl` 基线 10 → 10 零回归）；**CDP 真实输入管线**（`Input.dispatchKeyEvent` 真打字）实测：命令面板输「tcl launcher」→ **14 条**结果（首 5 条全为 TclLauncher 系）、项目视图同查询 → **14 项**、最近视图输「png」→ **匹配 24 / 60 条**；**打包版 v1.7.12 隔离 `--user-data-dir` 复测同一路径**（徽标 5 条断言 **全 ✔**、PAL 143、结果一致）；**6 张截图**目检（命令面板 / 最近搜索 / 项目搜索 / 总览 / 打包版复测）；深色六视图对比度审计 failCount 全 = 0（overview 5.16 / projects 5.20 / recent 5.20 / disk 5.54 / system 5.20 / settings 5.54，与 v1.7.11 基线完全一致 = 零回归）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- **本轮自查发现并修复 1 个自身引入的真实缺陷**：OR 降级若对**全字段**做，「code launcher」会命中 **43/59 个项目**（噪声）→ 限制为**仅名称字段** OR，降到 21 个且排序在 AND 结果之后
- 发版：`package.json` 1.7.11 → **1.7.12**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.11 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 11 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.12.exe`（87,604,771 B / 83.56 MB）、`out\Workbench-1.7.12-portable.zip`（118,696,645 B / 113.16 MB）、blockmap（91,857 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.12.0）
- **巡检发现（本轮）**：交付态健康；**两条真实遗留问题已写入 BACKLOG**（① 缓存里存着已删除的 QA 临时文件，点「打开所在目录」必然失败 —— 根因是「快照 = 那一刻的真相」+ 彻底修需新增 IPC 批量存在性检查；② 扫描时间与系统时钟疑似时区偏移）；沉淀 3 条 QA 方法论：③ **本机 `Microsoft.VisualBasic.Strings::StrConv(..., Phonetic)` 与 `LCMapStringEx` 均无法产出可用的拼音**（前者原样返回、后者的 zh-CN 输出是汉字注音变体）⇒ **必须用 ICU 的拼音排序 + ground-truth 断言自证**来生成拼音表，且**表不是手写**这件事本身要在代码注释里写清，避免后人误以为可信；④ **Node 22+ 内置全局 `WebSocket`** ⇒ CDP 取证脚本零外部依赖（无需 `ws` 包）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第二十一轮 / v1.7.11 · 链式续批 · 编排侧第 65 轮）

- 主题：**托盘菜单动态信息（P3）** —— READY 池仅剩此 1 项，按 STATE 下一轮指针取该 P3
- 决策：`DECISIONS.md` 第二十一轮（自问自答 9 问 + QA/发版实测回填）
- 根因/机会：托盘菜单是**后台常驻应用唯一的入口**，但此前只有 4 个静态项，且 `buildTrayMenu()` **只在切换「开机自启」时重建一次** ⇒ 菜单里的信息长期是过期快照（甚至与缓存矛盾）；用户在**不打开主窗口**时完全看不到「数据有多旧」「有几个仓库没提交」
- 实现：`main.js` 抽出 `trayStatus()`（纯读 `store.getScan()` → `{scanTime, clock, ageText, ageMinutes, projectCount, dirtyProjects, dirtyFiles}`）+ `relAgeText`（与渲染层 `freshness()` 同口径）+ `trayMenuTemplate()`（纯函数产出菜单模板）；`buildTrayMenu()` → `refreshTrayMenu(reason)`（构建 + `tray.setContextMenu` + tooltip 同步 + 写日志 `tray menu rebuilt (<reason>): <labels>`，**label 列表无变化则跳过**避免无谓重建）；**三条重建路径**：数据变化（`scan:done`）、设置变更（`settings:set`）、60s 定时（相对时间不冻结）；新增 `--trayqa=<json|popup|popupmenu>` QA 钩子（主进程消费，序列化**真正挂在托盘上的 Menu 实例**的 `items` + 弹出真实原生菜单供截图）；**零新增 IPC、零外部依赖、渲染层/preload/src 零改动、零既有数据文件结构改动**
- 验证：语法 6/6（实现后 + 三次改动后 + 重建前各一遍）、重名函数 0、`buildTrayMenu` 旧引用 0；**原生托盘菜单真实截图**（dev + 打包版各一张，菜单实际显示「上次扫描: 17 分钟前（13:47）」「未提交: 5 个仓库 / 8 个文件」）；**主进程序列化** `liveItemsMatchLabels = true`（读的是 `setContextMenu` 挂上去的那个 Menu 实例，不是模板复刻）+ **与原始 scan-cache.json 逐项核对四项全等**；**三条重建路径均用真实事件实测**（真实扫描 51s → `tray menu rebuilt (扫描完成)` 且数字更新为「刚刚（13:47）」「5 个仓库 / 8 个文件」；`settings:set` → 「自动扫描：关」→「每 1 小时」；60s 定时 → 「1 分钟前」→「2 分钟前」）；深色六视图审计 failCount 全 = 0（与 v1.7.10 基线一致 = 零回归）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- **口径加固**：未提交仓库数改为 `p.isGit && p.dirty > 0`（与渲染层数字条严格同口径）⇒ **源码变更后主动重建了一次**，保证产物与源码严格一致
- 发版：`package.json` 1.7.10 → **1.7.11**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.10 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 10 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.11.exe`（87,600,073 B / 83.56 MB）、`out\Workbench-1.7.11-portable.zip`（118,690,343 B / 113.16 MB）、blockmap（91,837 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.11.0）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；沉淀 3 条 QA 方法论：① **托盘原生菜单用「`Menu.popup` 弹出 + 屏幕定点连拍」取证**（`EnumWindows` 枚举不到 `#32768`、UIA 也读不到 `MenuItem`）；② 弹窗前必须 `win.setAlwaysOnTop(true)` 否则菜单被桌面焦点抢占关闭；③ **本机 PowerShell 的 `catch ($var)` 语法报「Catch 块缺少语句块」**，须用裸 `catch { }`
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第二十轮 / v1.7.10 · 链式续批 · 编排侧第 64 轮）

- 主题：**自动扫描启动即检（P3）** —— P0/P1/P2 已全部 DONE，按 STATE 下一轮指针取该 P3
- 决策：`DECISIONS.md` 第二十轮（自问自答 9 问 + QA/发版实测回填）
- 根因/机会：`setupAutoScan()` 只挂一个 `setInterval(15min)`，**首次到期判定要等满 15 分钟** —— 早上开工第一次打开工作台，缓存已过期 20 小时（实测 age = 1207 分钟）而「自动扫描明明开着」，自动扫描在**一天里第一次打开**这个最典型的场景中实际不生效；且用户无从判断自动扫描到底在不在管事
- 实现：`main.js` 抽出 `autoScanDueState(hours)`（纯判定，返回 `{due, ageMs, why}`）+ `runAutoScanCheck(reason)`（统一入口：判定 → 记日志 → 推 `scan:auto` → 到期才 `startScanRun`）；`setupAutoScan(reason)` 增 3 秒「启动即检」定时器（`whenReady` 传 '启动'、`settings:set` 传 '设置变更'，并随设置变更重建/清除）；新增 `scan:auto` 推送 + `state:get` **增** `autoCheck` 字段（纯增量，v1.7.3 加 `scanErrors` 同款做法）；`renderer/app.js` 新增全局 `AUTO_CHECK` + `autoCheckHtml()` + 设置页 `#auto-check` 常驻区块（复用既有 `.hint`/`.muted`/`.small` 类，**零新增 CSS**）+ `scan:auto` 订阅（局部刷新区块 + toast + 扫描日志行 + 标题栏状态）+ `init()` 后 5s 补一次 `refreshState()` 兜底；说明段补一句启动即检；**零改名/删除既有 IPC、零外部依赖、零既有数据文件结构改动、preload 零改动**（`window.wb.on` 已支持任意通道）
- 验证：语法 6/6（实现后 + 三次改动后 + 发版前各一遍）、重名函数检查 0 个；**判定两条分支均用真实启动实测**（到期 → `autoScan check (启动): 数据已过期 · 数据年龄=180 分钟前 · 间隔=1h · due=true` → `autoScan triggered (启动)` → 真实扫描，**启动后 3 秒**触发；未到期 → `due=false` 无触发；设置变更 → 复检并触发；关闭 → 无任何 check 行）；**打包版 v1.7.10 用隔离 `--user-data-dir` 复测同一条真实路径**（隔离目录独立 `main.log` 实测同样触发，设置页 DOM 实测「已过期，已自动刷新」、页脚 v1.7.10）；**11 张截图**目检（到期/未到期/关闭三态 + 浅色主题 + 总览 + 打包版 + 交付态）；CDP **真实鼠标管线**点「💾 保存设置」→ 真实 IPC → 真实到期检查 → 真实触发扫描；深浅两套六视图审计 failCount 全 = 0（与 v1.7.9 基线一致 = 零回归）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- **本轮自查发现并修复 3 个额外真实缺陷**（均非日志报错，靠截图目检 + 真实路径取证暴露）：① **既有缺陷** —— `render()` 无条件回填 `idleStatus()`，把标题栏 `⏳ 扫描进行中` 抹成「数据 N 前更新」（自动扫描后台触发时尤其明显）→ 改为「仅当标题栏不是 ⏳ 开头时才回填」（✔/✘ 按原逻辑回填，完成态另有 2.5s 延时、失败原因另有 toast + 日志 + 持久化错误诊断兜底）；② **既有缺陷** —— 间隔下拉无匹配项时回落显示「关闭」（与实际生效值不符，用户以为自动扫描关着其实开着）→ 值不在表内时动态补选项；③ **竞态** —— 启动即检事件可能早于页面订阅而丢失 → `state:get.autoCheck` 兜底 + `init()` 后 5s 补拉 `refreshState()`
- 发版：`package.json` 1.7.9 → **1.7.10**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.9 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`（QA 期间人为改旧的 `meta.scanTime` 已还原为真实扫描完成时间 13:03:10）；打包版 `Start-Process` 等 10 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.10.exe`（87,597,632 B / 83.56 MB）、`out\Workbench-1.7.10-portable.zip`（118,687,657 B / 113.16 MB）、blockmap（91,823 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.10.0，侧栏页脚 v1.7.10）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；实证本机桌面 `CopyFromScreen` 仍会截到用户 IDE ⇒ 桌面截图不作验收依据，全用 CDP `Page.captureScreenshot`（沿用第十六轮起的取证路线）；另实证 **CDP 端口偶发不可连**（9333 一次 `fetch failed`，换 9335/9336/9337 即恢复）⇒ 每轮 QA 启动 dev/打包实例后应先 `Invoke-WebRequest http://127.0.0.1:<port>/json` 探活再取证
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第十九轮 / v1.7.9 · 链式续批 · 编排侧第 63 轮）

- 主题：**深色主题次要文字对比度 (P2)** —— P0/P1 已全部 DONE，按 STATE 下一轮指针 + P0>P1>P2 与「同级改动面最小」取该 P2
- 决策：`DECISIONS.md` 第十九轮（自问自答 8 问 + QA/发版实测回填）
- 根因/机会：v1.7.8 把**浅色**主题做到 WCAG AA 达标，却把一直存在的**深色主题**次要文字缺陷量化了出来 —— 且 v1.7.8 自带的审计器**每选择器只取前 12 个元素**（抽样 113 处失败）掩盖了真实规模。本轮用 CDP 拉起真实实例做**不限元素数的全量扫描**（1352 个文本元素，且对 `opacity<1` 元素按**实际合成色**重算 —— 内置审计器已知的量测盲区），实测**深色主题 299 处低于 WCAG AA**，集中在两类根因：① `--muted2:#5d6f8c`（次要文字档）3.17~3.79:1，涉最近·时间/目录、系统·元信息、项目·单位、总览·入口路径/图例、侧栏·页脚/分组、标题栏·主机、提示；② 渐变底上的白字 `.btn` / `.chipbtn.on` 仅 **2.78:1**（深色主题 `--grad` 是**亮**色系，白字必然不够）；另查出头像首字母最低 **2.25:1**（白字压 `hsl(hue,52%,46%)`）
- 实现：`renderer/style.css` 深色 `:root` 的 `--muted2` `#5d6f8c`→`#7b8ca8`（最差 4.73:1，**含 hover 态 panel2**）且同步 `--muted` `#8fa1bd`→`#a3b8d8`（**保住四档视觉台阶** 15.34/10.49/8.79/5.20，ΔRGB 与原设计接近）；新增语义变量 **`--on-grad`**（叠在渐变上的文字色：深色=深墨 `#0b1220` 6.88:1 / 浅色=白 6.53:1 —— 浅色渐变本就够暗 ⇒ **浅色主题零视觉回归**）；`.btn` / `.chipbtn.on` 文字色 `#fff`→`var(--on-grad)`；简报入口箭头 `.di-go` opacity `.4`→`.9`（1.56→7.28:1，它是「这行可点」的唯一线索）；命令面板 `.pi-hint` 改 `var(--muted)`（选中行蓝底上 4.16→7.03:1）；文件类型徽标 `.ritem .ext` 去掉 `opacity:.9`（合成后最低 4.02→4.99:1）；`renderer/app.js` 新增纯函数 `_hslToRgb()` / `avatarInk()` / `avatarStyle()` —— **按色相逐个计算头像墨色**（白墨优先 → 深墨 → 两者皆不足时逐级降亮度，72 色相中 37 个需降亮至 31%~46%），供 4 处头像渲染复用；**零新增/改名 IPC、零外部依赖、零既有数据文件结构改动**
- 验证：语法 6/6；**内置审计器深色六视图 failCount 全 = 0**（最低 5.16:1，修复前 2.78:1）；**独立全量探针 1352 元素 × 2 主题 = 0 失败**（含 opacity 实际合成量测，比内置审计器更严）；**浅色主题最低 4.67:1 与 v1.7.8 基线完全一致 = 零回归**；**弹窗 + 命令面板**（不在六视图内）双主题 failCount = 0；**10 张截图逐张目检**（深色六视图 + 浅色总览/项目 + 深色项目详情弹窗）；CDP **真实鼠标管线**（`Input.dispatchMouseEvent`）验证标题栏主题按钮 dark→light→dark **双向生效**、项目视图选中 chip 仍可点、命令面板可输入过滤（"Tcl" → 10 候选）；头像前 12 个实测 4.82~7.58:1 全 PASS；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0
- **本轮自查发现并修复 2 个额外真实缺陷**（均为「内置审计器不计 opacity / 不采样选中态」盲区，靠全量探针与目检暴露）：① 命令面板**选中行**的 `.pi-hint` 压在 `--nav-sel` 蓝色高亮上 = 4.16:1 → 改 `var(--muted)`（7.03:1）；② 文件类型徽标 `opacity:.9` 在浅色主题合成后最低 4.02:1 → 去掉该 opacity（两主题均提升）
- 发版：`package.json` 1.7.8 → **1.7.9**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`（核验 `present=False`）、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive -CompressionLevel Optimal` 出 zip；1.7.8 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = **0**）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.9.exe`（87,595,659 B / 83.55 MB）、`out\Workbench-1.7.9-portable.zip`（118,685,155 B / 113.16 MB）、blockmap（91,757 B）、`out\win-unpacked\工作台.exe`（当前运行中，ProductVersion = 1.7.9.0，侧栏页脚 v1.7.9）
- **打包版实测**：`out\win-unpacked\工作台.exe --remote-debugging-port=9334` 起 → **全量 1352 元素 × 2 主题 failCount = 0**、内置审计六视图 failCount = 0 → **修复在真实交付产物中生效**（非仅 dev 态）；验证后已用**无 QA 参数**的干净启动恢复交付态
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；另实证本机桌面 `CopyFromScreen` 截图**仍会截到用户的 IDE**（Android Studio 窗口），与第十六/十七轮一致 ⇒ 桌面截图不作验收依据，只用 CDP `Page.captureScreenshot`（该截图含用户屏幕内容，已删除）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第十八轮 / v1.7.8 · 链式续批 · 编排侧第 62 轮）

- 主题：**浅色主题 (P2)** —— P0/P1 已全部 DONE，按 STATE 下一轮指针 + P0>P1>P2 与「同级改动面最小」取该 P2
- 决策：`DECISIONS.md` 第十八轮（自问自答 6 问 + QA/发版实测回填）
- 根因/机会：本应用是常驻托盘型看板，深空蓝配色在白天靠窗/投影/强光环境下对比度差、易疲劳；用户每天要看它数小时，但**没有任何浅色选项**
- 实现：`renderer/style.css` 把 40+ 处硬编码颜色收敛为 **70+ 个语义 CSS 变量**（面板底/内凹面/描边/强调文字/遮罩/浮层/徽标/渐变/图标底色/图表网格…）+ `[data-theme="light"]` 整块换肤（组件规则一行不改）；`renderer/app.js` 新增 `applyTheme()` / `setTheme()` / `toggleTheme()` / `cssVar()` / **`auditContrast()`（WCAG 对比度审计器）**；设置页新增「外观」区块（深色/浅色 chip，即时生效 + 跨重启保留）；`renderer/index.html` 标题栏加 `#tb-theme` 🌙/☀️ 按钮（`addEventListener`/属性赋值，无内联 onclick）；`src/store.js` `DEFAULTS` 增 `theme:'dark'`；canvas（脉搏/趋势图）与 JS 内联配色（`EXT_COLOR_LIGHT`）按主题取色；`main.js` 仅增 `--themeqa=` / `--qashot=` 两个 QA 钩子 + 窗口底色随主题；**零新增/改名 IPC、零外部依赖、零既有数据文件结构改动**
- 验证：语法 6/6（实现后/颜色修正后/缺陷修复后/发版前各一遍）；**浅色六视图逐屏截图目检 + 每视图 WCAG 对比度审计，failCount 全 0**（最低 4.67~5.11:1）；命令面板 + 项目详情弹窗浅色态 130 元素 / 0 未达标；**真实鼠标管线**（CDP `Input.dispatchMouseEvent`）点标题栏按钮 light→dark→light 双向生效；**跨重启持久化实证**（另起进程仍为 light + `settings.json` 落盘 `"theme":"light"` 且其余字段未丢）；打包版 v1.7.8 浅色态冒烟（页脚 v1.7.8 + 123 元素 / 0 未达标）；深色态截图与 v1.7.7 视觉一致（无回归）；dev/打包态新增 `[renderer]` 行 = 0、error 行 = 0
- **本轮自查修复 2 个自身引入的真实缺陷**：① 换肤过渡在窗口被遮挡时被 Chromium 冻结 → 部分元素颜色停在旧主题值（侧栏选中项仍是深色 #8fa1bd）→ 引入 `.theme-swap` 换肤期间冻结过渡 + 审计器量测前冻结过渡；② `applyTheme` 静默模式不重渲染 → JS 生成的主题相关配色（最近视图文件类型徽标）不跟随换肤，打包版浅色下徽章对比度仅 2.55:1 → 改为换肤必重渲染（**打包版修复后重建了一次**）
- 发版：`package.json` 1.7.7 → **1.7.8**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive` 出 zip；1.7.7 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧版本残留计数 = 0）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.8.exe`（87,594,788 B / 83.54 MB）、`out\Workbench-1.7.8-portable.zip`（118,683,971 B / 113.17 MB）、blockmap（91,807 B）、`out\win-unpacked\工作台.exe`（当前运行中）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；本轮用新审计器查出**深色主题 45 处次要文字低于 WCAG AA**（`--muted2:#5d6f8c` 压面板底仅 3.45:1，最近视图文件类型徽标最低 2.66:1）—— 属**既有**缺陷（本轮未改深色调色板），已记入 BACKLOG 列为 P2 READY；16 张临时截图 + 全部 QA 脚本/探针已删除，dev `data\settings.json`（QA 产物）已删除
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第十七轮 / v1.7.7 · 链式续批 · 编排侧第 61 轮）

- 主题：**简报导出（P2）** —— P0/P1 已全部 DONE，按 STATE 下一轮指针 + P0>P1>P2 与「同级改动面最小」取该 P2
- 决策：`DECISIONS.md` 第十七轮（自问自答 5 问 + QA/发版实测回填）
- 根因/机会：总览「今日机器简报」每条已是可点击入口（v1.7.0），但**整份简报无法带走** —— 想贴进周报/工位交接/Issue 只能逐条手抄 9 条
- 实现：`renderer/app.js` 的 `buildBrief()` 每条新增纯文本 `text` 字段（复制/导出不再从 HTML 反推）；新增 `briefMarkdown()`（标题 + 主机/扫描/导出时间 + 条目数 + 编号条目 + 可选「目标：路径」行 + 落款）+ `mdEsc()`/`mdPath()` 转义 + `copyBrief()` / `exportBrief()` + 模块级 `lastBriefCopy`/`lastBriefExport`；总览简报卡头新增「📋 复制简报」「⬇ 导出 Markdown」两个 `data-act` 按钮（无内联 onclick）；导出后卡片内常驻「已导出：<路径> · 📂 打开文件夹」（复用既有 `path:show`）；`preload.js` 增 `briefCopy`/`briefExport` 两个桥接方法；`main.js` 增 `brief:copy`（主进程 Electron `clipboard` 写入 + 立即 `readText()` 回读自证）与 `brief:export`（`fs.writeFileSync` 落 `Documents\工作台\简报-YYYYMMDD-HHmm.md`，返回绝对路径与字节数）两个 handler + `--briefqa=` 透传；**零改名/删除既有 IPC、零外部依赖、零既有数据文件改动**
- 验证：语法 6/6（实现后 + 改名修复后 + 发版前各一遍）；**3 张截图**目检（A dev `--briefqa=both` 取证徽标「条目=8 · 复制 IPC 成功=是 · 剪贴板回读=633 · 导出成功=是 · 导出字节=981」/ B dev 干净总览无 QA 污染 / C 打包版 v1.7.7 新功能可见）；**两条独立证据互证**：PowerShell `Get-Clipboard` 读系统剪贴板（633 字符 / 8 条 / 标题+落款齐全）与读导出 `.md` 文件（981 B）→ `-ceq` **逐字节相同 = True**；CDP `Input.dispatchMouseEvent` **真实鼠标管线**点击两按钮均生效（复制覆盖既有剪贴板 = 是；导出落盘 = 是）；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0；无内联 onclick、动态文本全 esc()
- **本轮自查修复（自身引入的真实缺陷）**：QA 钩子函数名 `triggerBriefQa` 与既有 `--brief` 钩子**重名** —— 函数声明提升致后定义者覆盖先定义者，旧的 `--brief` QA 钩子被静默失效（巡检时总览视图被顶到「项目」页才暴露）；已改名 `triggerBriefExportQa`，并加「重名函数」静态检查（现 0 个重名）
- 发版：`package.json` 1.7.6 → **1.7.7**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive` 出 zip；1.7.6 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧产物全清）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.7.exe`（87,588,268 B / 83.53 MB）、`out\Workbench-1.7.7-portable.zip`（118,675,135 B / 113.17 MB）、blockmap（91,773 B）、`out\win-unpacked\工作台.exe`（当前运行中）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；本轮发现并修复 1 个**自身引入**的 QA 钩子重名缺陷（详见上）；另再次实证 `ELECTRON_RUN_AS_NODE=1` 残留会让打包版**静默不启动**（pwsh 会话继承 DSH 环境变量），已在发版流程中固化为「每次启动前显式清 env + 核验 `present=False`」
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第十六轮 / v1.7.6 · 链式续批 · 编排侧第 60 轮）

- 主题：**磁盘环 hover 明细（P2）** —— P0/P1 已全部 DONE，按 STATE 下一轮指针 + P0>P1>P2 与「同级改动面最小」取该 P2
- 决策：`DECISIONS.md` 第十六轮（自问自答 5 问 + QA/发版实测回填）
- 根因/机会：总览磁盘环卡片右侧只写「已用 X GB / 剩 Y GB」两行，**缺「共 Z GB」总容量**，环中央只有百分比无分母 → 用户无法一眼判断某盘总量与占用比例
- 实现：`renderer/app.js` 的 `driveCard()` 环加 `data-ring="<盘符>"` + `aria-label`（保留可访问名，**刻意不设原生 `title`**，避免与自定义浮层叠成「双 tooltip」）；新增 `showRingTip()` / `hideRingTip()`（浮层内容从 `DATA.drives` 按盘符**反查真实数据**，动态文本全 `esc()`）；`#view` 上 mouseover/mouseout **事件委托**（冒泡事件、容器常驻 → 只绑一次、无重复绑定）+ `#main` scroll/wheel 收起 + `render()` 开头收起；浮层 `position:fixed; z-index:120` + 视口边界钳制（右侧放不下自动翻到左侧）；`--ringqa=1` QA 钩子（**fixed 定位**取证徽标，零布局位移）；`main.js` 仅增 `--ringqa=` 透传；**零新增/改名 IPC、零数据文件改动、点击环仍 = 打开该盘**
- 验证：语法 6/6（实现后 + 末次改动后各一遍）；**5 张截图**目检（A dev 真实鼠标悬停 C 环 / B dev `--ringqa=1` 取证徽标 / C dev 干净总览无 QA 污染 / D 打包版悬停 D 环 / E 打包版悬停 E 环）；**CDP 真实输入管线**（`Input.dispatchMouseEvent` mouseMoved）额外取证：`tipHidden: false → true`（移出即收起）、`position=fixed / z-index=120`、`tipText` 含「已用/剩余/共」、`aria-label` 正确；dev/打包态新增 `[renderer]` 错误 = 0、error 行 = 0；无内联 onclick、动态文本全 `esc()`、零外部依赖
- 发版：`package.json` 1.7.5 → **1.7.6**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive` 出 zip；1.7.5 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除（`out\` 旧产物全清）；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.6.exe`（87,585,925 B / 83.52 MB）、`out\Workbench-1.7.6-portable.zip`（118,672,280 B / 113.17 MB）、blockmap（91,730 B）、`out\win-unpacked\工作台.exe`（当前运行中）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；`out\` 历史残留产物本轮按 AGENTS.md 协议第 5 条**全清**（历轮遗留的 6 个 1.1.0~1.5.0 blockmap 终于清空）；另发现本机桌面有其他应用（IDE / 浏览器）会抢占前台焦点，**桌面全屏截图不可靠** → 本轮改用 **CDP `Page.captureScreenshot`（渲染进程直抓）+ `Input.dispatchMouseEvent`（真实输入管线）** 取证，抗焦点抢占，此法沉淀为本项目后续 QA 取证首选
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 最近一轮（第十五轮 / v1.7.5 · 链式续批）

- 主题：**数据新鲜度文案（P2）** —— P0/P1 已全部 DONE，按 STATE 下一轮指针 + P0>P1>P2 与「同级改动面最小」取该 P2
- 决策：`DECISIONS.md` 第十五轮（自问自答 4 问 + QA/发版实测回填）
- 根因：`base()` 返回 `DATA.meta.scanTime`，`relTime(scanTime)` 是 self 比较恒为 0 → 标题栏/侧栏/概览永远显示「数据 刚刚前更新」，用户无法判断缓存有多旧；且「刚刚前更新」为病句
- 实现：新增 `freshness(s)`（以 `Date.now()` 为基准，返回完整「数据 …更新」文案，含 <1 分钟「刚刚更新」）；3 处调用（标题栏 `idleStatus` / 侧栏 `renderFoot` / 概览 greet-sub，innerHTML 处全 `esc()`）；`clockTick` 空闲态每 30s 重算（不覆盖 ⏳✔✘ 扫描态）+ F5 走既有 `scan:done→refreshState→render` 同步刷新；`--freshqa=1` QA 钩子（`textContent` 持久取证行）；`main.js` 仅增 `--freshqa=` 透传；`relTime`/`base()` 与提交/文件时间快照语义完全不动
- 验证：语法 6/6；**5 张截图**目检（A dev `--freshqa=1` 取证行「scanTime=16:47:41 · 距今=428 分钟 · 旧=刚刚 · 新=数据 7 小时前更新 · 三处=是 · 模拟重扫=数据 刚刚更新」 / B dev 干净总览无 QA 污染无回归 / C dev 设置页证全局生效 / D 打包版 `--freshqa=1` 新功能可见 v1.7.5 / E 交付态 v1.7.5 干净）；dev 全日志仅 1 条历史 `[pal] open` 信息行、dev/打包态新增 `[renderer]` 错误 = 0；无内联 onclick、动态文本全 `esc()`、零外部依赖、**零新增/改名 IPC、零数据文件改动**
- 发版：`package.json` 1.7.4 → **1.7.5**；构建前 `remaining app instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive` 出 zip；1.7.4 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 `[renderer]`/error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.5.exe`（87,584,027 B / 83.52 MB）、`out\Workbench-1.7.5-portable.zip`（118,670,060 B / 113.17 MB）、blockmap（91,822 B）、`out\win-unpacked\工作台.exe`（当前运行中）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；上轮遗留的 P2「数据新鲜度文案」本轮已修（标题栏/侧栏/概览三处均显示真实距今时长）；`out\` 仍残留 6 个历史 blockmap（非本轮产物、不影响交付，按「只删上一版」协议未清理）
- 规则：批次到顶不再停（PM.md 第五节）；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 上一轮（第十四轮 / v1.7.4 · 新链式批次第 1 轮）

- 主题：**目录构成弹窗内下钻（P1）** —— P0 已全部 DONE，按 STATE 下一批指针 + P0>P1 排序取唯一 P1
- 决策：`DECISIONS.md` 第十四轮（自问自答 4 问 + QA/发版实测回填）
- 根因/机会：弹窗「目录构成 Top12」每行一律 `data-act="open"`（点击只能跳资源管理器），与空间视图已支持的 `drill` 下钻能力不一致；且 `loadDirs` 成功后 `w2.innerHTML = head + dirsRows(dd)` 会移除 `#dirs-body`，导致二次加载（下钻/返回/重算）因 `$('#dirs-body')` 为 null 提前 return
- 实现：复用 `project:dirs`（任意路径 + `dirs-cache.json` 按路径缓存，**零新增/改名 IPC**）；`renderer/app.js` 增 `currentDetail.stack` 路径栈 + `curDirsPath/drillDirs/dirsUp` + `dirsdrill/dirsup` 两个动作 + `dirsRows` 目录行下钻（🔗 符号链接除外）+ `loadDirs` 重构（只操作 `#dirs-wrap`、导航条含「⬆ 返回上级 / 路径面包屑 / 📂 打开 / ↻ 重算 / 来自缓存」、过期结果丢弃）+ `--dirsqa` QA 钩子；`renderer/style.css` 增 `.dirs-nav` 与 `▸` 下钻提示；`main.js` 仅增 `--dirsqa=` 透传
- 验证：语法 6/6（实现后 + 末次改动后各一遍）；**5 张截图**目检（A 下钻态 11 行子项 + 返回按钮 + 取证行 / B 总览六区块无回归 / C `,up` 变体证「返回上级=通过 + 二次下钻来自缓存=是」 / D 打包版新功能可见 / E 交付态 v1.7.4 干净）；dev `dirs-cache.json` 实证新增 `D:\code\Poker\node_modules`（11 项 / 129.5 MB）→ 复用缓存成立；dev/打包态新增 `[renderer]` 错误 = 0；无内联 onclick、动态文本全 `esc()`、零外部依赖
- 发版：`package.json` 1.7.3 → **1.7.4**；构建前 `remaining instances after kill = 0`、清 `ELECTRON_RUN_AS_NODE`、镜像 npmmirror；`npx electron-builder --win --publish never` **exit 0**；`Compress-Archive` 出 zip；1.7.3 的 Setup/zip/blockmap 按绝对路径核验 `underOut=True` 后删除；`data\scan-cache.json` + `history.json` 复制 `%APPDATA%\工作台\`；打包版 `Start-Process` 等 9 秒 → **4 进程**、`app ready/tray created/pulse started` 全 True、新增 error lines = 0，**运行态已保留**
- 产物：`out\Workbench-Setup-1.7.4.exe`（87,582,778 B / 83.52 MB）、`out\Workbench-1.7.4-portable.zip`（118,668,530 B / 113.17 MB）、blockmap（91,840 B）、`out\win-unpacked\工作台.exe`（当前运行中）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**；已知 P2「数据新鲜度文案」标题栏仍「数据 刚刚前更新」（已在 BACKLOG，一轮一主题未修）；`out\` 仍残留 `Workbench-Setup-1.1.0~1.5.0.exe.blockmap` 共 6 个历史文件（非本轮产物、不影响交付，按「只删上一版」协议未清理）
- 规则：批次到顶不再停（PM.md 第五节），下方「本链式批次结束（3/3 到顶）」为上一批历史记录；本轮收尾后由编排器立即拉起下一轮，本轮不自起

## 上一轮（第十三轮 / v1.7.3 · 上一链式批次第 3/3 轮收官）

- 主题：**扫描错误可见诊断（P1）** —— P0 已全部 DONE（收藏/置顶 v1.7.1、保存 TypeError 修复 v1.7.2），按 STATE 指针 + P0>P1 排序选取
- 决策：`DECISIONS.md` 第十三轮（自问自答 4 问 + QA/发版实测回填 + 本批次结束说明）
- 根因：`scan:error` / `analyze:error` 只有 2.2s toast；`logLine` 写进 `#scan-log` 但每次 `render()` 重建 `#view` 即被清空，切视图/重启后「为什么失败」完全不可查
- 实现：`src/store.js` 增 `getScanErrors/appendScanError/clearScanErrors`（`scan-errors.json`，上限 50）；`main.js` `state:get` 增 `scanErrors` 字段 + `pushScanError()` 写入器 + `startScanRun().catch`/`disk:analyze().catch` 各接一行 + 新增 `scan-errors:clear` IPC + `--scanerrqa=` 透传；`preload.js` 增 `scanErrorsClear`；`renderer/app.js` 增 `SCAN_ERRORS` 全局/`refreshState` 读回/`scan-errors:changed` 订阅局部刷新/`doAct:clearScanErrors`/`clearScanErrors()`/`scanErrorsHtml()`/设置页「扫描错误诊断」区块/`triggerScanErrQa()`；`renderer/style.css` 增诊断样式。`index.html`/`run-scan.js` 未动
- 验证：语法 6/6；4 张截图目检（A 设置页诊断区 1 条真实 ENOENT 错误 + 持久取证行 `当前错误条数=1 · DOM=有` / B 总览六区块无回归 / C 另起进程设置页仍显示同一条错误 → 跨重启持久化 / D 打包版 v1.7.3 干净空态交付态）；dev `data\scan-errors.json` 实证落盘一条真实 ENOENT；dev/打包态新增日志 `[renderer]` 错误 = 0；构建前 `remaining instances after kill = 0`；builder exit 0；打包版 4 进程、`app ready/tray created/pulse started` 三项全 True、新增 error lines = 0
- 产物：`out\Workbench-Setup-1.7.3.exe`（87,581,310 B / 83.52MB）、`out\Workbench-1.7.3-portable.zip`（118,666,337 B / 113.17MB）、blockmap（91,749 B）；1.7.2 的 Setup/zip/blockmap 按绝对路径核验后删除；`data\scan-cache.json`+`history.json` 已复制到 `%APPDATA%\工作台\`；dev QA 产物 `data\scan-errors.json` 与本轮 4 张临时截图已删除；`%APPDATA%` 无 scan-errors.json、settings 保持 autoScanHours=0（干净）
- **巡检发现（本轮）**：交付态健康、**无新应用缺陷**。已知 P2「数据新鲜度文案」标题栏仍显示「数据 刚刚前更新」（已在 BACKLOG，一轮一主题未修）；另 `out\` 目录残留 `Workbench-Setup-1.1.0~1.5.0.exe.blockmap` 共 6 个历史文件（非应用缺陷、不影响交付，本轮未清理，记录备查）

## 本链式批次结束（3/3 到顶）〔上一批历史记录 · 按 PM.md 第五节链式规则不作终止〕

- 三轮：第十一轮 v1.7.1（项目收藏/置顶）→ 第十二轮 v1.7.2（设置页保存 TypeError 修复）→ 第十三轮 v1.7.3（扫描错误可见诊断）。每轮独立发版、构建前杀净实例、QA 全过、结束保留运行态，零「带病连跑」。按 PM.md 第五节链式上限 3 轮即停；下一批由编排器/看门狗唤醒后续跑最多 3 轮。

## 第 67 轮中断线索（编排侧 job 记录丢失，agent 全 inactive，需接手）—— **已于第二十三轮结清**

> 第二十二轮（v1.7.12）发版成功后，下一轮（项目内应为第二十三轮）在 **QA 阶段**因作业记录丢失而中断，
> **未留下任何源码改动**（源码最后修改 14:38 < 打包 14:40，语法 6/6，v1.7.12 交付物与源码一致）。
> 它留下的 15 个 CDP 探针脚本揭示了它在追查的**两个真实问题**。**第二十三轮（v1.7.13）已把两条线索全部结清**，结论如下（细节见 DECISIONS.md 第二十三轮）：

### 线索 A：最近动态含已删除文件（P3-A）—— **已修复（v1.7.13）**
- 根因（实测确认）：扫描缓存 `scan-cache.json` 的 `recent` 数组里存着**磁盘上已不存在**的条目 —— 实测当前缓存 **60 条里有 36 条失效**（ps1×11 / png×23 / json×1 / log×1，全是上一轮遗留的 QA 临时文件；线索里写的 34 条是旧缓存的数字）。
- 症状（实测确认）：`shell.showItemInFolder(<缺失路径>)` **同步返回、什么都不做**（0ms、无窗口、无报错）⇒ 点「打开所在目录」**100% 静默失败**。
- 修法（v1.7.13）：主进程 `path:show` **先判存在性**，缺失返回 `{ok:false, reason}`；渲染层按 `ok===false` 弹 toast（**此前完全忽略返回值 = 静默的根源**）；再加**批量** `path:exists` 通道，失效行**置灰 + 划线 + 红色「已删除」角标**（角标占用「文件类型」那一格 ⇒ 零布局位移）。
- 验收：最近视图**恰好标出 36 条**（与 Node 侧独立计算一致）、角标 36 个；点失效行的「📂」**1ms** 内弹出「路径已不存在，无法打开所在目录」。

### 线索 B：`shell.openPath` 对不存在路径是否挂起主进程 —— **已证伪一半、证实一半（v1.7.13）**
- **证实**：`shell.openPath(<缺失路径>)` 返回的 Promise **5/5 用例永不落地**（25s 超时未 settle：ps1 / txt / 无扩展名 / md / 目录），且 Windows 会弹一个**模态原生错误框**（窗口标题 = 缺失路径）⇒ 渲染层 `await` 永远挂着 ⇒「点了没反应」+ 弹窗挡住工作台窗口。
- **证伪**：**主进程并没有被挂起** —— 25s 内 100ms 心跳跑了 **230~231 次**、最长间隔 **0~7ms** ⇒ 事件循环健康；真因是「**IPC Promise 悬空 + 原生模态弹窗**」，不是「主进程冻结 / IPC 通道堵死」（照字面修会修错方向）。
- 修法（v1.7.13）：主进程 `path:open` **先判存在性**（缺失直接返回错误串、**根本不调 shell** ⇒ 既不悬空也不弹原生框），存在再走 `Promise.race([shell.openPath, 15s])` 兜底。
- 验收：`openPath(缺失文件/缺失目录)` 均 **0~1ms** 返回错误串（修前：永不落地）；真实鼠标点击失效条目文件名 → **1ms** 出错误 toast。

### 其他中断残留（已清理，不必重查）
- `pm\_qa_profile\`（隔离 user-data，含旧 scan-cache/history）、`pm\_shots\`、`pm\_probe*.js`（15 个）、`pm\_cdp.js`、`pm\_diag.js`
  —— 均已由编排侧删除；CDP 取证方法（`Page.setWebLifecycleState:'active'` + `Page.captureScreenshot`）
  已固化在下方「QA 取证方法沿用」小节，继续沿用。
- **第二十三轮自己的探针/截图/隔离 profile 也已全部删除**（`pm\` 目录现只有 4 个治理文件，接手成本保持低位）。

## 下一轮指针（供编排器立即拉起下一轮）

- **剩余 READY**：**0 项**（P3 ·「项目雷达里的失效项目没有视觉标注」已于第二十五轮（v1.7.15）结清）
- **指针**：
  1. **READY 池已空 ⇒ 按 PM.md 第一节「待办池枯竭时自己造活」** —— 下一轮**先做真实巡检**（启动打包版用 **CDP `Page.captureScreenshot` + `Page.setWebLifecycleState:active` 逐视图目检** + 读 `%APPDATA%\工作台\main.log` 尾部 + `Get-Process -Name 工作台`），找**真实问题**再立项；巡检无新问题则从 IDEA 池升级：
      - **每周开发节奏周报**（复用 v1.7.7 的 `brief:export` 通道 + `history.json`，改动面最小；但产出不可见，验收需读文件）
      - **项目对比视图**（两个 git 仓库的分支/提交/未提交并排；改动面大，需新开并排布局）
      - **多机器数据合并**（涉及导入流程与冲突规则，改动面大）
      - **拼音首字母全字库支持**（当前内置表 419 字，未收录字优雅降级为「不拼音命中」）
  2. **巡检纪律（沿用历轮教训）**：任何看起来像 bug 的现象**先量化证伪再立项**；涉及 `shell.openPath` / `spawn` 的探针**必须零副作用或跑在可 kill 的隔离进程里**（缺失路径会弹原生模态框；真 spawn 会拉起用户桌面上的外部程序窗口 —— 第二十四轮实测：真调 `openIn(存在路径)` 一次就拉起 **12 个 `Code.exe`**）；**改 CSS 后必须 `location.reload()` 再量**（第二十五轮教训）；**截图里看着「挤」的布局先量几何**（第二十五轮靠 `Range.getBoundingClientRect()` 才抓出 34px 的「按钮压住体量列文字」缺陷）。
  3. **若下一轮巡检无新问题且 IDEA 无法升级**：只写巡检结论、**不发版**，返回 `STATUS: EXHAUSTED`、`READY_LEFT: 0`。
- **要求**：一轮一主题；发版前杀净实例；版本号 +1 patch（1.7.15 → 1.7.16）；结束保留运行态；批次到顶不再停，收尾后由编排器立即续拉下一轮
- **QA 取证方法（v1.7.12 新增，沿用并扩充）**：
  ① **CDP `Page.setWebLifecycleState:{state:'active'}`** + `Emulation.setFocusEmulationEnabled` + `Page.bringToFront` 后 `Page.captureScreenshot`（直抓工作台窗口，不受桌面焦点抢占影响）；
  ② 桌面 `CopyFromScreen` **仅作局部取证**（整屏截图会截到用户 IDE，不可作验收依据）；
  ③ **原生 OS 菜单（托盘右键菜单）取证路线**：`Menu.popup({window, x, y})` 弹出真实菜单 + 弹窗前 `win.show() / win.setAlwaysOnTop(true) / app.focus({steal:true})`（否则菜单被桌面焦点抢占关闭）+ PowerShell `CopyFromScreen` 定点连拍菜单所在区域（`EnumWindows` 枚举不到 `#32768`、UIA 也读不到 `MenuItem`）；
  ④ 启动 dev/打包实例后先 `Invoke-WebRequest http://127.0.0.1:<port>/json` **探活**（本机 CDP 端口偶发 `fetch failed`）；
  ⑤ dev 实例必须加 `--user-data-dir=<临时目录>` 隔离单实例锁（否则会被打包版挤掉并**静默退出**）；打包版 QA 用 `--user-data-dir=<隔离目录>` + **预置 `scan-cache.json`/`history.json`**（否则隔离实例无缓存会触发一次全量扫描）；
  ⑥ **v1.7.12 新增**：**CDP 脚本零外部依赖** —— Node 22+ 有内置全局 `WebSocket`，`pm\_cdp.js` 直接用它连 CDP（**不需要 `ws` 包**，本机没有）；**真实输入管线**用 `Input.dispatchKeyEvent`（`text` 字段逐字符）可真实打字进输入框，比 `Runtime.evaluate` 直接改 value 更接近用户；
  ⑦ **v1.7.12 新增**：**纯函数量化测试**优先于截图 —— 把 `renderer/app.js` 里的纯函数按边界切片抠出来（`new Function` 组装），喂真实 `scan-cache.json`，跑断言集 + 新旧对比表；这能把「搜得准不准」从主观目检变成可复现的数字（脚本见 `pm\_test-search.js`，**本轮结束后按收尾纪律删除**）。
  ⑧ **v1.7.14 新增（3 条，重要）**：① **回归「成功路径」绝不能在用户实例里真调 `openIn(存在路径)`** —— 那会**真的拉起 12 个 `Code.exe`**（用户桌面开一排 VS Code 窗口）；回归必须用**模块级 spawn 记录器**（`child_process.spawn` 换成记录器 + `require.cache` 注入假 electron 模块，**零副作用**）；② **CDP 截图会把鼠标指针一起拍进去** —— 疑似「叠字」先用 `getBoundingClientRect` **量几何重叠**再下结论（本轮实测 overlap = 0 ⇒ 是指针不是布局 bug）；③ **窗口被遮挡时 Chromium 会把 CSS 动画冻结在 `currentTime = 0`** ⇒ toast 停在 from 态（`opacity: 0`，**DOM 断言说「在」但截图里看不见**，dev 与打包版同款 ⇒ 环境问题非应用缺陷）⇒ 取证前先用 Win32 `SetForegroundWindow` + `RedrawWindow` **置前并强制重绘**（**不要**用 `Emulation.setDeviceMetricsOverride`，会破坏页面导致后续 CDP `fetch failed`）。
- **本机 PowerShell 陷阱**：`catch ($var)` 语法报「Catch 块缺少语句块」（任意变量名均触发）⇒ 一律用**裸 `catch { ... }`**。
- **本机拼音能力实测（v1.7.12 新增，重要）**：`Microsoft.VisualBasic.Strings::StrConv(..., Phonetic)` **原样返回中文**（本机没装中文拼音 NLS 数据）；`LCMapStringEx(zh-CN, LCMAP_PHONETIC)` 输出的是**汉字注音变体**（U+71CE 燎 / U+CE13 츓…），**不是拼音**；`Microsoft.International.Converters.PinYinConverter` DLL **不存在** ⇒ 本机**无法**靠系统 API 生成拼音表。唯一可靠路径 = **Node 内置 ICU 的 `zh-u-co-pinyin` 排序 + ground-truth 断言自证**。
- **审计器边界**：`auditContrast()` 每选择器取前 12 个元素、只评文本对比度、不计元素 opacity；改配色时须用全量探针验收（第十九轮已实测抽样会漏 2/3 问题）。
- **发版流程补充**：pwsh 会话继承 DSH 注入的 `ELECTRON_RUN_AS_NODE=1`，不清掉打包版会**静默不启动**；每次启动前显式 `Remove-Item Env:ELECTRON_RUN_AS_NODE` + 核验 `present=False`。**打包版 QA 实例会与交付态实例抢单实例锁并静默退出** ⇒ 做打包版 QA 前必须**先停掉交付态实例**，QA 完再干净启动恢复交付态。
- **产物一致性纪律**：若实现期中途又改了源码（哪怕只是口径加固），**必须重建一次**（重跑 builder + zip + 清旧产物 + 预置数据 + 冒烟），否则产物与源码不一致 —— v1.7.11 主动做了一次。
- **新能力提示**：`main.js` 新增 `--qashot=<目录>` 钩子（主进程逐视图 `capturePage` 落盘 + 对比度审计，输出 `pm-r62-audit.json`）；`--view=xxx` / `--detail=xxx` / `--themeqa=` / `--freshqa=` / `--trayqa=` / `--searchqa=` 等 QA 钩子均可用。


## 里程碑

| 轮次 | 版本 | 一句话 |
|---|---|---|
| 1-2 | v1.0 / 静态版 | 探索整机 → 静态仪表盘 → 用户要求改为 Electron |
| 3 | v1.1 | 视觉精细化 + 图标 + NSIS 打包 |
| 4 | v1.2 | 五个创意点（脉搏/简报/热力/命令面板/Bento） |
| 5 | v1.2.1 | 隐形遮罩事故修复 + 截图 QA 制度 |
| 6 | v1.3.0 | 多 agent 框架 + 托盘/窗口记忆/自启 |
| 7 | v1.4.0 | 项目详情弹窗 + 自动扫描 |
| 8 | v1.5.0 | 性能 3.6× |
| 9 | v1.6.0 | 补完 + 动态版本号 + 历史趋势 |
| 10 | v1.7.0 | **PM agent 首轮自驱 · 简报可操作化** |
| 11 | v1.7.1 | **链式批次 1/3 · 项目收藏 / 置顶**（星标持久化 + 置顶 + Ctrl+K 优先 + 数字条收藏数） |
| 12 | v1.7.2 | **链式批次 2/3 · 设置页保存 TypeError 修复**（settings:set 返回合并对象 + renderer 防御合并 + --saveqa 取证） |
| 13 | v1.7.3 | **链式批次 3/3 · 扫描错误可见诊断**（scan-errors.json 持久化 + 设置页诊断区块 + --scanerrqa 取证）；本批次收官 |
| 14 | v1.7.4 | **新链式批次 1 · 目录构成弹窗内下钻**（stack 路径栈 + 返回上级 + 复用 dirs-cache 缓存 + 修 loadDirs 二次加载缺陷） |
| 15 | v1.7.5 | **链式续批 · 数据新鲜度文案**（freshness() 以 now 为基准修 self 比较恒「刚刚」+ 三处文案 + clockTick 空闲重算 + --freshqa 取证） |
| 16 | v1.7.6 | **链式续批 · 磁盘环 hover 明细**（自定义浮层「已用/剩余/共」+ 事件委托 + 视口钳制 + --ringqa 取证 + out 旧产物全清） |
| 17 | v1.7.7 | **链式续批 · 简报导出**（复制简报 / 导出 Markdown 共用一份产物 + 主进程 clipboard 回读自证 + Documents\工作台 落盘 + --briefqa 取证） |
| 18 | v1.7.8 | **链式续批 · 浅色主题**（70+ 语义 CSS 变量整体换肤 + 设置页/标题栏双入口 + WCAG 对比度审计器 浅色六视图 0 未达标 + --themeqa/--qashot 取证） |
| 19 | v1.7.9 | **链式续批 · 深色主题次要文字对比度**（全量扫描 1352 元素查出 299 处 < WCAG AA → --muted/--muted2 提亮 + 新增 --on-grad 渐变墨色 + 头像逐色相计算墨色 + 简报箭头/面板 hint/类型徽标修正；深浅两套 failCount 全 0） |
| 20 | v1.7.10 | **链式续批 · 自动扫描启动即检**（启动后 3s 先做一次到期检查 + 与定时器共用同一判定函数 + 设置页常驻「上次检查」+ 修 3 个自查发现的真实缺陷：标题栏进度被重渲染抹掉 / 间隔下拉回落显示「关闭」/ 启动即检事件早于订阅丢失） |
| 21 | v1.7.11 | **链式续批 · 托盘菜单动态信息**（菜单常驻「上次扫描：X 前（HH:mm）」+「未提交：N 个仓库 / M 个文件」，与缓存同源同值；三条重建路径：数据变化 / 设置变更 / 60s 定时；--trayqa= 序列化取证 + 原生菜单真实截图） |
| 22 | v1.7.12 | **链式续批 · 搜索能力补齐**（修「整串连续子串」内核导致的多词查询 100% 失效 + 拼音首字母（ICU 排序 + 355 条 ground-truth 断言生成的 419 字表）+ 子序列模糊 + 相关性稳定排序 + 最近视图补搜索框 + 最近文件进命令面板 + 修 palette 脏键 "undefined"） |
| 23 | v1.7.13 | **链式续批 · 失效路径保护**（打开前判存在性：path:open 先 stat 不调 shell + 15s 超时兜底；path:show 返 {ok,reason}；新增批量 path:exists；最近视图失效条目置灰 + 「已删除」角标；探针实测 openPath 缺失路径 Promise 5/5 永不落地但主进程心跳健康 ⇒ 真因是「Promise 悬空 + 原生弹窗」而非主进程冻结） |
| 24 | v1.7.14 | **链式续批 · 「用 VS Code / 在终端打开」的失效路径保护**（openIn 入口统一判存在性：缺失 → {ok:false,msg} 且不 spawn 不调 shell，兜底分支加 Promise.race 超时；探针实证修前失效路径照样 spawn VS Code/WT 却回报 ok:true；跨进程 tasklist 监控 delta=0；真实点击 658ms 出错误 toast；零新增 IPC、仅 2 文件改动） |
| 25 | v1.7.15 | **链式续批 · 项目雷达里的失效项目视觉标注**（复用既有批量 path:exists 通道，零新增 IPC；失效行置灰 + 划线 + 红色「已删除」角标占用类型徽标格 + 去掉过期快照的未提交标记 + 统计行「已删除 N」；**本轮自查并修复既有布局缺陷**：.prow 栅格 5 轨 vs 4 子元素 ⇒ 操作按钮溢出压住体量列文字 34~35px ⇒ 改 4 轨后全表重叠 = 0px） |
| 26+ | — | 由编排器立即拉起下一轮续写（指针：READY 池已空 ⇒ 先做真实巡检找问题，否则从 IDEA 池升级「每周开发节奏周报」） |

























































