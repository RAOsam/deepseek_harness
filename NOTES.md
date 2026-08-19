# DeepSeek Harness Desktop — 项目笔记（永久决定）

> **最重要的一条（用户明确要求，永久生效）：**
> **永远不要添加外壳（Electron shell sidebar / 右侧桌面侧栏）。**
> 工作区文件树是 **GUI 功能**（`dsh-workspace-tree` 插件，网页端右侧），
> 不是桌面外壳的一部分。桌面窗口只有 DSH GUI（WebContentsView 占满全窗口）。

## 架构要点

- **窗口布局**：`main.js` 中 `layoutViews()` 让 `dshView`（WebContentsView）占满整个窗口。
  曾经有右侧外壳 sidebar（`sidebar.html/js/css`，已删除），禁止再加回来。
- **工作区文件树** = GUI 插件 `D:\deepseek_harness\plugins\dsh-workspace-tree`：
  - 客户端注册进 `shell.overlay` 槽，右缘 "📁 工作区" tab → 打开面板。
  - **停靠式**：面板打开时 `#root { margin-right: 280px }` 把整个 shell 左推，
    面板占据让出的右条——**不覆盖任何内容**（header/composer/对话全部可见）。
  - **z-index 免疫**：会话 header 是 `z-index: 21`，面板所在 overlay 层原为 20，
    曾被 header 盖住顶部左侧。插件 CSS 里 `[data-shell-overlay] { z-index: 100 !important; }`
    永久解决。不要移除这行。
  - 功能 = 旧外壳 sidebar 的完整复刻：🐋 工作区 header、根路径、目录优先排序、
    ▸/▾ 展开收起、📁/📂/📄 图标、文件大小（B/KB/MB/GB）、⟳ 刷新、
    📂 在资源管理器中显示、点击文件用默认程序打开、状态栏（N 个目录 · M 个文件）、
    峰谷倒计时（北京时间 UTC+8，高峰 9-12/14-18）。
  - 数据来自 DSH host `/api/workspace-tree/root|list|read`（根 = `DSH_WORKSPACE_ROOT`）。
  - 打开文件/显示在资源管理器走**桌面应用 3090 桥**（main.js `startSessionToolsServer`：
    `/open`、`/reveal`，Electron shell API，路径越界校验 `resolveBridgePath`）。
- **服务生命周期**：DSH 服务 detached 独立运行，`keepServerOnQuit=true`；
  `releasePort()` 杀掉 3080 的 node 监听者防 EADDRINUSE；重启应用不会杀服务。
- **CDP 调试**：`settings.json` 里 `debugPort: 9222`（永久开启）。
  main.js 在 app ready 前先 loadSettings 再 `appendSwitch('remote-debugging-port', ...)`。
  用 Chrome/Edge `chrome://inspect` 调试 GUI 页面。`/dom` 端点可远程读 GUI DOM。
- **3090 桥端点**：`/backup` `/restore` `/rollback` `/health` `/open` `/reveal` `/dom`。
- **会话安全网**：`userData/session-backups/`，5 分钟自动备份 + 重启前备份（保留 24 份）；
  GUI 的 ⟲回退/⟳恢复按钮（`dsh-session-tools` 插件）走 3090 桥。
- **皮肤**：maid-atelier（深海女仆工坊）永久启用，patch 行 `ui-skin-maid-atelier`。
  `dsh-skin-switch` 插件负责皮肤切换（重启服务生效）。
- **人设**：`dsh-persona-manager` 插件，设置页面「人设」+ session header 快速切换。
  用 `ctx.systemPrompt.context()` 注入人设（不能用 `section()`，会与内置 `deployment:persona` 冲突）。
  支持导入/导出（JSON 文件）、人设预览。
- **记忆**：`dsh-memory` 插件，设置页面「记忆」+ AI 工具（`memory_save` / `memory_search`）。
  按重要性注入记忆到系统提示词。5 个分类：偏好/信息/事件/规则/背景。
  注册工具用 `harness.registerTool(ctx, toolDef)`。
- **防崩溃系统**（watchdog）：main.js 内置三层防护——
  1. **预检验证**：`restartServer()` 前检查 patch.yml 的每个插件是否存在于 node_modules、
     package.json 有 `type:"module"` + `exports`。失败则阻止重启并显示错误。
  2. **实时崩溃上报**：DSH 子进程 stderr 流解析，匹配 `failed to apply loader entry`
     和 `Cannot find package...imported from` 模式，写入 `userData/crash-report.json`。
  3. **Watchdog**：10 秒间隔健康检查。启动后 30 秒冷静期（只检查进程存活）。
     连续失败时读 crash-report.json 识别问题插件，写入
     `userData/disabled-by-watchdog.yml`（`--patch` 覆盖层，不碰 patch.yml）。
     连续 3 次失败 → 安全模式（禁用所有自定义插件，只保留皮肤+会话工具）。
  4. **loading 页面状态显示**：插件崩溃/安全模式时在启动页显示黄色警告。
- **打包**：`desktop/package.json` → `npm run dist`（electron-builder NSIS），
  产物 `release/DeepSeek Harness Desktop-<ver>-setup.exe`。
- **服务重启**：用户手动通过托盘菜单「重启 DSH 服务」，不要由 agent 杀进程重启。
  杀 DSH 服务 = 杀 harness 会话 = 中断对话。

## 新插件开发清单（血泪教训）

创建新 DSH 插件时必须检查以下 **5 个条件**，缺一不可：

1. **`package.json`** 必须包含：
   - `"type": "module"`（DSH 期望 ES 模块）
   - `"dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-runtime"] } }`（客户端配置）
   - `"exports": { ".": "./lib/index.js", "./client": "./lib/client.js", "./package.json": "./package.json" }`
2. **`lib/index.js`** 必须用 ES 模块语法（`import/export`，不能用 `require/module.exports`）
3. **`profiles/web/cordis.patch.yml`** 必须有 insert 行（编辑后用 `--dump-config` 验证）
4. **`lib/index.js`** 的 `export const inject` 必须声明所有硬依赖的服务
5. **不要用 `file:` 依赖**指向源码目录——加载器从 `profiles/node_modules/` 解析，
   源码目录没有 node_modules 会导致 `ERR_MODULE_NOT_FOUND`

**系统提示词陷阱**：`deployment:persona` section 已被系统提示词构造器注册，
不能再用 `ctx.systemPrompt.section()` 注册同名 section（会报 "already registered"）。
必须用 `ctx.systemPrompt.context()` 注入人设文本。

**验证方法**：`dsh --profile web --dump-config` 查看组合后的 entry 列表，
确认插件 id 出现。用 `/api/personas` 等端点验证路由注册。

**Watchdog 禁用机制**：`userData/disabled-by-watchdog.yml` 通过 `--patch` 注入，
不修改用户的 `cordis.patch.yml`。删除该文件或删除其中一行即可重新启用插件。

## 插件安装位置（用户机器）

- 插件源码：`D:\deepseek_harness\plugins\*`
- 运行安装：`C:\Users\lenovo\.dsh\profiles\node_modules\*`
  （修改后需 Copy-Item 同步；客户端 bundle 由服务即时从磁盘读取，无需重启服务，
  但页面需重载；host 端改动需重启 DSH 服务）
- 配置：`C:\Users\lenovo\.dsh\profiles\web\cordis.patch.yml`（insert 行加载插件）、
  `package.json`（deps + bundles）。
