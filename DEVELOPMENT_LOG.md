
### 为什么 deepseek-balance 和侧边卡片没丢失？

**Cordis 有两层加载机制，patch.yml 只管 Layer 2。**

| 层级 | 来源 | 注册方式 | 示例 |
|------|------|----------|------|
| **Layer 1 — Bundles** | `package.json → dsh.profile.bundles` | 包自带 `cordis.patch.yml` + `dsh.bundle.patch` | deepseek-balance ✅, dsh-better-sidebar ✅ |
| **Layer 2 — Patch** | `~/.dsh/profiles/web/cordis.patch.yml` | 用户手动写的 `-insert:` 块 | 7 个插件全部 ❌ |

- `deepseek-balance/package.json` 有 `dsh.bundle.patch` → 自动注册
- 其他 5 个插件（skin-switch/session-tools/persona-manager/memory/prompt-enhancer）没有 bundle.patch → 只能走 Layer 2

# DSH Development Log

> 记录项目开发过程、架构决策、踩过的坑。方便回溯，避免重复犯错。

---

## 2026-08-29: 完整项目审计与清理

### 背景
项目经历了多次迭代和插件修改，积累了冗余文件和混乱的目录结构。进行了一次全面审计。

### 操作：删除项

| 路径 | 大小 | 原因 |
|------|------|------|
| `_github_repo/` | 79 个文件 | **完整项目复制品**，嵌套结构混乱（如 `desktop/desktop/.gitignore`)，无任何独立价值 |
| `fix-shortcut.ps1` | 1 个文件 | 一次性调试脚本（修复桌面快捷方式图标），任务已完成，无后续复用价值 |
| `desktop/test-anticrash-deep.js` | 350 行 | Electron 壳时代遗留测试代码，核心逻辑已迁移到原生 C# 的 `CrashRecovery.cs`，不再维护 |
| `desktop/test-anticrash.js` | 少量 | Electron 壳时代遗留测试代码，不再维护 |

### 操作：保留项（全部验证通过）

| 路径 | 状态 | 说明 |
|------|------|------|
| `.gitignore` | ✅ | 版本控制配置，条目合理（双壳架构 + Cordis 生态） |
| `cordis.patch.yml` | ✅ | 全局 Cordis patch 配置文件（含 pwsh-sandbox / compaction-basic / tool-result-pruner 及 6 个 insert 注册） |
| `README.md` | ✅ | 用户文档，功能完整（双壳介绍 + 插件列表 + 安装指南） |
| `NOTES.md` | ✅ | 架构决策笔记，包含用户永久约束条件（禁止添加桌面侧栏等） |
| `desktop/` | ✅ | Electron 遗留壳（双壳之一），作为参考保留 |
| `desktop-native/DeepSeekHarnessDesktop/` | ✅ | **生产级原生 WPF 应用**（.NET 8 + WebView2） |
| `docs/anti-crash-optimization.md` | ✅ | 防崩溃分层防御方案 v1.0（502 行参考文档） |
| `docs/native-desktop-analysis.md` | ✅ | Electron→WPF 可行性分析（215 行） |
| `docs/optimized-memories.md` | ✅ | 快速参考指南（插件开发规则、SPA 特性等） |
| `plugins/*/` | ✅ | 6 个 Cordis 插件，完整代码库 |

### 最终项目树（排除 bin/obj/node_modules）

```
dsh/
├── .gitignore              # 版本控制配置
├── cordis.patch.yml        # 全局 Cordis patch 配置
├── NOTES.md                # 架构决策笔记（永久有效）
├── README.md               # 用户文档
├── desktop/                # Electron 遗留壳（双壳之一，供参考）
│   ├── assets/             # 图标资源
│   ├── scripts/            # 辅助脚本
│   └── main.js / package.json / preload.js
├── desktop-native/         # ✅ 生产环境：原生 WPF 壳
│   └── DeepSeekHarnessDesktop/
│       ├── Services/       # CircuitBreaker, CrashRecovery, SkinWatcher...
│       ├── MainWindow.xaml
│       └── icon.ico        # 嵌入 exe 的图标
├── docs/                   # 架构文档
└── plugins/                # 6 个 Cordis 插件
    ├── dsh-skin-switch/    # 皮肤切换（含 maid-atelier 内置皮肤）
    ├── dsh-session-tools/  # 会话备份/回滚
    ├── dsh-persona-manager/# 人设管理
    ├── dsh-memory/         # 长期记忆
    ├── dsh-prompt-enhancer/# 提示词增强
    └── deepseek-balance/   # DeepSeek 余额监控
```

---

## 2026-08-29: DSH 前端卡加载问题根因复盘

> **重要性：10/10 — 以后遇到插件加载失败必须先对照 node_modules 做差异分析**

### 根因链

1. `cordis.patch.yml` 引用了不存在的插件（5 个核心 + 2 个外部皮肤）
2. DSH 安全模式尝试禁用有问题的插件时，写入失败——文件被设为只读 (ReadOnly)
3. 前端 `dsh-web-app` 使用 `Promise.all` 等待所有注册插件，任意一个缺失则永久挂起
4. 用户被迫手动删掉引用、改 patch 才修好

### 我的核心错误

| # | 错误 | 教训 |
|---|------|------|
| 1 | 只看 git 源码 (`D:\deepseek_harness\plugins\`) 不看运行时 (`node_modules`) | Cordis 只认 node_modules 里的包，不是 git 源码目录 |
| 2 | 编辑 YAML 直接覆盖写入，没有用 diff 验证完整性 | 丢失了全部 `-insert:` 块 → 所有插件注册失效 |
| 3 | 安全模式失效时没排查文件系统属性 (只读) | 诊断方向完全偏了 |
| 4 | 诊断顺序反了 —— 应先对比「引用的 vs 安装的」，再决定改什么 | 应该在写任何文件之前先收集数据 |
| 5 | `dsh-skin-switch` 内置皮肤优先级高于外部皮肤（按 id 去重时 built-in wins） | 自定义皮肤被覆盖忽略，应让内置扫描自动发现 |

### 修复方法

1. 从 git 源部署所有插件到 `web/node_modules` + `shared/node_modules`
2. maid-atelier 改为由 `dsh-skin-switch` 内置扫描自动发现（不用手动注册）
3. `.csproj` 添加 `<ApplicationIcon>` 嵌入 ico 图标
4. `dotnet clean && dotnet build --no-incremental` 重新构建
5. 快捷方式 `IconLocation` 指向独立 `.ico` 文件

---

## 2026-08-29: 原生应用图标修复

### 问题
桌面快捷方式图标空白 —— WPF 应用的 `.csproj` 没有嵌入 `icon.ico`，`ExtractAssociatedIcon(exe)` 读取空图标。

### 解决

1. 复制 `icon.ico` 到 `desktop-native/DeepSeekHarnessDesktop/icon.ico`
2. `.csproj` 添加 `<ApplicationIcon>icon.ico</ApplicationIcon>`
3. `dotnet clean && dotnet build --no-incremental` 重新编译 apphost（生成带内嵌图标的 `.exe`）
4. 快捷方式 `IconLocation` 指向 `C:\Users\lenovo\.dsh\harness-icon.ico`（独立副本，更可靠）
5. Windows 资源管理器需刷新（F5）或重启 Explorer 才能显示新图标

---

## 开发铁律（从踩坑中总结）

### 1. 永远先对照实际运行时目录做差异分析
- Cordis 从 `~/.dsh/profiles/web/node_modules/<name>/package.json` 解析包名
- 改了 git 源码 ≠ 改了运行时的加载结果
- 必须同步到两个位置：
  - `~/.dsh/profiles/web/node_modules/<name>/` — 客户端加载
  - `~/.dsh/profiles/node_modules/<name>/` — 服务端加载

### 2. 编辑 YAML 前必须先读后验证
- YAML 缩进即逻辑
- 覆盖写入前用 diff/对比工具确认完整性
- 丢失 `- insert:` 块会直接导致全部插件注册失效
- **原则：读 → 对比 → 改 → 再读一次确认**

### 3. 安全模式失效时排查文件系统属性
- DSH 安全模式通过写 `cordis.patch.yml` 禁用有问题的插件
- 如果文件被设为只读 (ReadOnly)，写入静默失败
- 前端 `Promise.all` 挂死是最终表现，不是根因

### 4. dsh-skin-switch 内置皮肤优先级高于外部皮肤
- 扫描路径：`profiles/node_modules/@dsh-external/` → `plugins/dsh-skin-switch/skins/`
- 按 id 去重时 **built-in wins**
- 自定义皮肤即使部署成功也会被忽略
- 应让内置扫描自动发现，不要手动注册重复 id

### 5. C# 应用图标嵌入
- `.csproj` 添加 `<ApplicationIcon>icon.ico</ApplicationIcon>`
- 托盘图标通过 `ExtractAssociatedIcon(exe 路径)` 从 exe 读取
- 快捷方式需要单独设置 `IconLocation`
- 修改 `.csproj` 后必须 `dotnet clean` 再重建（不 clean 只更新 dll）

---

*最后更新: 2026-08-29*

---

## 待解决问题（P0-P1）

> 以下问题已确认但尚未修复，按优先级排列。每次开发前检查是否涉及这些范围。

### P0 — 托盘图标随窗口关闭而消失

| 项目 | 详情 |
|------|------|
| **现象** | 关闭窗口后，系统托盘图标同时消失，无法通过托盘菜单判断服务状态（运行中/已停止/出错） |
| **预期行为** | 即使主窗口隐藏，托盘图标应保持显示，点击可弹出状态菜单（查看 GUI / 重启服务 / 安全模式 / 退出） |
| **涉及代码** | `App.xaml.cs` 的托盘初始化逻辑、MainWindow 的 onClosing/onClosed 事件处理 |
| **影响** | 用户无法远程获知 DSH 服务健康状况，必须重新打开窗口才能检查 |

### P0 — 服务崩溃时前端加载页背景切换

| 项目 | 详情 |
|------|------|
| **现象** | 当 DSH 服务崩溃触发自动重启时，前端页面会短暂切换到「深海女仆工坊」皮肤背景，然后才恢复默认白底或 loading 动画 |
| **原因推测** | 皮肤热更新机制 (SkinWatcher) 在服务启动前就生效，导致 loading 页面也应用了皮肤 CSS；或者皮肤注册时机与前端就绪不同步 |
| **预期行为** | 加载过渡期间使用纯色/渐变背景（无皮肤样式），服务就绪后才平滑过渡到目标皮肤 |
| **涉及代码** | `Services/SkinWatcher.cs`、frontend loading HTML、皮肤注入时序 |
| **影响** | 视觉闪烁干扰用户体验，可能让用户误以为皮肤被错误激活 |

### P1 — 人设不能绑定相应会话

| 项目 | 详情 |
|------|------|
| **现象** | 在人设管理器中选择的人设配置，在切换会话或刷新后丢失，未持久化到当前会话的上下文 |
| **原因推测** | ~23:19 日志记录：人设切换 API 调用失败或未返回成功响应 → 未能将人设数据写入会话状态对象 |
| **预期行为** | 选择人设后立即绑定到当前会话，刷新/切会话保持该人设直到手动更换 |
| **涉及代码** | `dsh-persona-manager/` 插件客户端（UI）、服务端注入逻辑、会话状态管理 |
| **影响** | 用户需要反复选择人设，核心体验受损 |

### P1 — 防崩溃功能状态不可见

| 项目 | 详情 |
|------|------|
| **现象** | 安全模式和安全恢复模式运行时，用户无法直观看到当前处于什么保护级别、触发了多少次、还剩多少容错次数 |
| **预期行为** | 托盘菜单或 GUI 设置页显示实时状态面板：<br>- 当前状态（正常 / 安全模式 / 降级模式）<br>- 连续崩溃次数 / 最大容忍次数<br>- 最近一次崩溃原因和时间<br>- 一键跳转到详细日志 |
| **涉及代码** | `Services/CrashRecovery.cs`、`Services/CircuitBreaker.cs`、GUI 设置页 UI 组件 |
| **影响** | 用户不知道系统是否在自我保护，也不清楚何时该手动干预 |

### P1 — 桌面端框架外观待美化

| # | 子项 | 现象 | 方案 | 涉及文件 |
|---|------|------|------|----------|
| 1 | **Mica/Acrylic 材质** | 窗口边框是死板的灰色，缺乏现代感 | 调用 DWM API 开启 Mica 材质（Win11 原生模糊半透明），保留系统边框。改动不到 20 行 | `MainWindow.xaml.cs` OnSourceInitialized() 后注入 |
| 2 | **自绘标题栏（无边框模式）** | 原生 Windows 标题栏与 WebView2 内容风格不统一 | `WindowStyle="None"` → 自定义顶栏：左侧 logo+应用名 + 右侧 min/max/close 按钮。浏览器内容延伸到标题栏区域，类似 VS Code/Notion 效果 | `MainWindow.xaml` Grid 布局拆分为 TitleBar(48px) + WebView2(剩余空间) |
| 3 | **圆角窗口** | Win11 应用普遍使用圆角窗口，当前为直角 | XAML 中用 `CornerRadius` 给顶层 Border 设置圆角（4-8px）。配合无边框模式可实现完整四角圆润 | `MainWindow.xaml` Root Border |
| 4 | **全局主题色统一** | 托盘状态颜色固定、Loading 进度条配色与前端皮肤不一致 | 定义一套 ColorResource 字典：主色 #4A90D9、状态绿/橙/红三色。Loading Overlay、托盘气球、托盘图标均引用同一色值 | `App.xaml` ResourceDictionary + `TrayIcon.cs` / LoadingOverlay |
| 5 | **托盘图标状态化** | 托盘图标单一颜色，无法直观区分服务状态 | 根据 Server.Status 切换 icon.ico 的 overlay 或替换不同颜色的 .ico 文件（绿=运行/黄=启动中/红=出错） | `App.xaml.cs` TrayIcon 创建逻辑 |
| 6 | **动画过渡** | 窗口打开/关闭/隐藏无过渡效果，体验生硬 | Window Show/Hide 添加 FadeIn/FadeOut (OpacityAnimation, 200ms)。最小化到 tray 时缩小动画 | `MainWindow.xaml.cs` Loaded/Closing 事件 |
| 7 | **LogViewer 样式统一** | 日志面板可能使用默认 SystemFonts，与整体设计脱节 | LogViewer.xaml 复用 MainWindow 的颜色资源，统一字体/间距/边距 | `LogViewer.xaml` |

**优先级建议：** 先做第 1 项 Mica（半天搞定，效果立竿见影），再做第 2 项自绘标题栏（一周内），其余逐步完善。

**参考对标：** Electron 壳 (`desktop/main.js`) 有更成熟的 loading 动画和加载页 CSS 样式，可作为视觉对比基准。
### P2 — patch.yml 自愈机制（短期止血）+ Bundle 化转型（长期治本）

| 项目 | 详情 |
|------|------|
| **现象** | 手动编辑 cordis.patch.yml 时可能丢失 `- insert:` 块，导致全部插件注册失效；安全模式因只读属性无法自动修复 |
| **根因** | Cordis 有两层加载：Layer 1 bundles（自动）、Layer 2 patch（手动维护）。patch.yml 丢了就全盘崩溃 |
| **短期方案：自愈** | 1. 启动前校验所有 insert ID 是否在 node_modules 中存在<br>2. 写入前自动备份 + 检测只读属性<br>3. 校验失败时提前返回错误并提示恢复路径 |
| **长期方案：Bundle 化** | 将 5 个 Layer 2 插件改造为自带 cordis.patch.yml + dsh.bundle.patch，走 Layer 1 自动注册。<br>**需要：** 逐个改 package.json、创建 patch 文件、peerDep 验证、npm registry 发布。估计 2-3 周 |
| **优先级调整** | P1 -> P2（自愈短期可上线，Bundle 化是独立大工程） |
| **涉及代码** | desktop/main.js startServer()、各插件 package.json + cordis.patch.yml |

| 项目 | 详情 |

#### P3 — Windows 安装包制作（Inno Setup + CI/CD）

| 项目 | 详情 |
|------|------|
| **现象** | README.md 写着 Method 1 Installer，链接指向 GitHub Releases，但该仓库从未发布过任何安装程序，页面是空的 |
| **难点评估** | 低。项目已配置 PublishSingleFile=true + IncludeNativeLibrariesForSelfExtract，dotnet publish 直接输出单文件 exe |
| **推荐方案** | Inno Setup（免费、Windows 行业标准脚本），约 40 行可覆盖所有需求：安装目录、快捷方式、卸载入口 |
| **自动化** | PowerShell 打包 -> iscc.exe -> 上传到 GitHub Releases |
| **预期工作量** | 本地跑通半天，CI/CD 接入一天 |
