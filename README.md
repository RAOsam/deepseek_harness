# DeepSeek Harness Desktop

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![.NET](https://img.shields.io/badge/.NET_8-512BD4?style=for-the-badge&logo=.net&logoColor=white)]()
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)]()

> 一个 Windows 桌面客户端 + 插件生态系统，基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建。

DSH 将 DeepSeek AI 的 Web GUI 封装为完整的桌面体验 —— 系统托盘管理、自动服务生命周期，以及不断扩展的插件生态。

---

## ✨ 功能特性

### 🖥️ 桌面外壳

#### 🔷 WPF 原生外壳（推荐）

纯 .NET 8 + C# + WPF + WebView2。**约 35MB 轻量体积**，零 Chromium 开销。

| 功能 | 状态 |
|---|---|
| 窗口关闭最小化到托盘 | ✅ 不退出程序 |
| 托盘菜单（重启服务、开机自启、安全模式） | ✅ 含气泡提示反馈 |
| 服务状态实时通知 | ✅ 启动/停止/错误提示 |
| 一键清理 WebView2 缓存 | ✅ |
| 内置日志查看器 | ✅ `LogViewer.xaml` |
| 崩溃防护（安全模式/看门狗） | ✅ 通过 HTTP 桥接 |
| 皮肤热加载 | ✅ `SkinWatcher.cs` |
| DSH CLI 全局路径解析 | ✅ 支持全局 npm 安装 |
| 体积 | 🟢 ~35 MB |

**核心组件：**
- `MainWindow.xaml.cs` — WebView2 GUI 宿主
- `App.xaml.cs` — 托盘菜单、服务生命周期管理
- `LogViewer.xaml.cs` — 系统日志面板
- `SessionToolsServer.cs` — 3090 API 处理器（health / info / restart / open / reveal / dom）
- `CrashRecovery.cs` / `CircuitBreaker.cs` — 故障隔离
- `DshServiceManager.cs` — DSH 服务进程管理
- `SkinWatcher.cs` — 皮肤热加载

源码：`desktop-native/DeepSeekHarnessDesktop/`

#### 💙 旧版外壳

`desktop/main.js` — 完整桌面实现，包含托盘、自启、崩溃恢复、安全模式隔离。

| 功能 | 状态 |
|---|---|
| 自动服务启动/停止 | ✅ |
| 托盘菜单（重启、自启、安全模式） | ✅ |
| 崩溃自恢复（~2s 重启） | ✅ |
| 皮肤支持 | ✅ |
| 峰谷计费倒计时 | ✅ |
| 一键更新检查 | ✅ |

### 🔌 插件生态

每个插件使用 **Cordis 架构**：`lib/index.js`（服务端路由）+ `lib/client.js`（UI 插槽）。所有插件注册在 `profiles/web/cordis.patch.yml`。

| 插件 | 用途 | 关键特性 |
|---|---|---|
| `${b}dsh-memory${b}` | 长期记忆 | 分类分组、BM25 去重、图片 OCR |
| `${b}dsh-persona-manager${b}` | 角色管理 | 多角色创建、Toast 提示、持久化 |
| `${b}dsh-prompt-enhancer${b}` | 提示词增强 | 3 种模式、自定义模型、连通性测试 |
| `${b}dsh-skin-switch${b}` | 皮肤切换器 | 设置一级标签页、GitHub 仓库链接、支持鲸鱼娘昼夜皮肤 |
| `${b}deepseek-balance${b}` | 余额监控 | 用量统计、柱状图、实时更新 |

---

## 🚀 安装

**前置要求：**
- Windows 10/11
- [Node.js](https://nodejs.org/) ≥ 20
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

### 方式一 — 安装包（最快）

[下载最新安装包 →](https://github.com/RAOsam/deepseek_harness/releases)

### 方式二 — 从源码构建

```powershell
git clone https://github.com/RAOsam/deepseek_harness.git
cd deepseek_harness

# 安装 DSH CLI
npm install -g @deepseek-ai/dsh

# 构建 WPF 原生外壳
cd desktop-native/DeepSeekHarnessDesktop
dotnet build -c Release

# 启动（DSH 服务 + 桌面客户端）
dsh web --port 3080
# 另开终端启动桌面客户端
start bin/Release/net8.0-windows/"DeepSeek Harness Desktop.exe"
```

---

## 📁 项目结构

```
deepseek_harness/
+-- desktop/                         # 旧版桌面外壳
+   +- main.js                       # 主进程（托盘、防崩溃、安全模式）
+   +- preload.js                    # IPC 桥接
+   +- assets/                       # 图标与资源
+   +- test-anticrash-deep.js        # 13 项故障注入测试
+   +- release/                      # 构建产物
+-- desktop-native/                  # WPF 原生外壳
+   +- DeepSeekHarnessDesktop/       # WPF + WebView2 项目
+       +- App.xaml.cs               # 托盘菜单、服务管理
+       +- MainWindow.xaml.cs        # WebView2 宿主窗口
+       +- Services/
+           +- DshServiceManager.cs  # DSH 进程管理
+           +- CrashRecovery.cs      # 崩溃恢复
+           +- SessionToolsServer.cs # 3090 HTTP 桥
+           +- SkinWatcher.cs        # 皮肤监控
+-- docs/
+   +- native-desktop-analysis.md
+   +- optimized-memories.md         # 项目知识库
+-- plugins/                         # DSH 插件
+   +- dsh-memory/
+   +- dsh-persona-manager/
+   +- dsh-prompt-enhancer/
+   +- dsh-skin-switch/
+   +- deepseek-balance/
+-- README.md
```

---

## 🔧 开发

### 插件规范

每个插件需要三个文件：
- `lib/index.js` — 服务端端点（Host）
- `lib/client.js` — UI 插槽注册（Client）
- `package.json` — 包描述文件

**必须遵守：**
1. 仅使用 ESM 模块 — 不允许 `require()`，使用 `import`
2. 必须在 `profiles/web/cordis.patch.yml` 的 `- insert:` 条目中注册
3. 不允许重复的 `const` 声明
4. `inject` 数组只列出实际依赖项
5. 部署前使用 `node --check` 验证语法

### 3090 HTTP 桥接端点

所有桌面行为通过此统一桥接服务器路由。

| 端点 | 方法 | 描述 |
|---|---|---|
| `${b}/health${b}` | GET | 健康检查 |
| `${b}/health?probe=liveness${b}` | GET | 存活探针 — ping 3080 |
| `${b}/health?probe=readiness${b}` | GET | 就绪探针 — 状态 + 安全模式 |
| `${b}/health?probe=metrics${b}` | GET | 内存/运行时间/崩溃次数 |
| `${b}/restart${b}` | GET | 重启 DSH 服务（频率限制） |
| `${b}/open?path=${b}` | GET | 打开文件 |
| `${b}/reveal?path=${b}` | GET | 在资源管理器中显示 |
| `${b}/dom?q=${b}` | GET | 查询 DOM 元素 |

### 🛡️ 防崩溃机制

三层防御，灵感来自 Netflix Hystrix + Kubernetes 健康检查 + Sentinel 限流。

| 层级 | 机制 | 效果 |
|---|---|---|
| L1 进程守护 | 崩溃归因 + 自动重启 | 退出码/信号/stderr 分析 |
| L1 频率限制 | 指数退避 + 熔断器 | 1s→2s→4s… 上限 60s；冷却 120s |
| L1 安全模式 | 连续崩溃降级 | 3 次以上崩溃 → 禁用非核心插件 |
| L2 看门狗 | 运行时存活探针 | 每 5s 检测；3 次失败后 kill |
| L3 持久化 | ${b}crash-state.json${b} | 历史记录跨重启保留 |

恢复链路：`kill` → `cause=runtime` → 退避 1s → 启动 → 约 **~2 秒**恢复。

测试：`node desktop/test-anticrash-deep.js`（13 个场景，含真实崩溃测试）。

---

## 🤝 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 核心框架
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 侧边栏设计参考
- [deep-whale-day-night-theme](https://github.com/GGBond2424648901/deep-whale-day-night-theme) — 鲸鱼娘昼夜皮肤

---

## 📄 许可证

MIT