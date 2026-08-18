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
- **打包**：`desktop/package.json` → `npm run dist`（electron-builder NSIS），
  产物 `release/DeepSeek Harness Desktop-<ver>-setup.exe`。

## 插件安装位置（用户机器）

- 插件源码：`D:\deepseek_harness\plugins\*`
- 运行安装：`C:\Users\lenovo\.dsh\profiles\node_modules\*`
  （修改后需 Copy-Item 同步；客户端 bundle 由服务即时从磁盘读取，无需重启服务，
  但页面需重载；host 端改动需重启 DSH 服务）
- 配置：`C:\Users\lenovo\.dsh\profiles\web\cordis.patch.yml`（insert 行加载插件）、
  `package.json`（deps + bundles）。
