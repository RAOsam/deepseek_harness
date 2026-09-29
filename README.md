# DeepSeek Harness 插件集

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)]()
[![.NET](https://img.shields.io/badge/.NET_8-512BD4?style=for-the-badge&logo=.net&logoColor=white)]()
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)]()

> 官方 [DeepSeek Harness](https://www.deepseek.com/en/download/) 桌面端的插件集合。
> 仓库中的自建桌面外壳已被官方桌面端取代，保留供查阅。

---

## 📌 关于本仓库

本仓库最初是 DSH 的自建 Windows 桌面外壳（Electron + WPF 双实现），外加一套 Cordis 插件。

**官方 DeepSeek Harness 桌面端发布后，外壳部分已被取代。** 官方桌面端自带原生窗口、托盘、
自动更新和服务生命周期管理，不需要再套一层壳；它也有内置的插件系统，本仓库的插件正是通过
这套机制装进去的，不依赖本项目的外壳。

| 部分 | 现状 |
|---|---|
| `plugins/` | ✅ **仍在使用** —— 装进官方桌面端 |
| `desktop/`（Electron 外壳） | ⚠️ 已归档，被官方桌面端取代 |
| `desktop-native/`（WPF 外壳） | ⚠️ 已归档，被官方桌面端取代 |

---

## 🔌 插件

| 插件 | 用途 | 关键特性 |
|---|---|---|
| `deepseek-balance` | 余额监控 | 侧边栏页脚组件、用量柱状图、官方余额 API 代理（密钥不出服务端） |
| `dsh-memory` | 长期记忆 | 分类分组、BM25 去重、图片 OCR、`memory_save` / `memory_search` 工具 |
| `dsh-persona-manager` | 人设管理 + 峰谷倒计时 | 多角色 CRUD、会话头部快速切换、侧边栏页脚的峰谷倒计时 |
| `dsh-prompt-enhancer` | 提示词增强 | RAG 知识库检索、3 种模式、自定义模型、连通性测试 |
| `dsh-skin-switch` | 皮肤切换 | ⚠️ 仅注册在旧的 `web` profile，**未**装进官方桌面端 |

峰谷倒计时按 DeepSeek 峰谷定价显示当前档位与距下次切换的倒计时（高峰 9:00–12:00、14:00–18:00，
北京时间），位于侧边栏页脚，紧邻余额组件。

### 安装到官方桌面端

前置条件：

- 已安装官方 DeepSeek Harness 桌面端
- `pnpm` 在 PATH 上（`dsh plugin` 是 pnpm 的转发器）

```sh
cd <本仓库>/plugins
dsh plugin --profile desktop add ./deepseek-balance ./dsh-memory ./dsh-persona-manager ./dsh-prompt-enhancer
```

**机制说明。** `dsh plugin --profile <名> <args>` 会在 profile 目录（`$DSH_HOME/profiles/<名>`）
执行 `pnpm <args>`，然后按**已安装状态** reconcile `dsh.profile.bundles`：

- 依赖中声明了 `dsh.bundle.patch` 的包 → 自动加入 bundle 列表
- 未声明的包 → 只作为普通依赖安装并打印警告，需手工在 `cordis.patch.yml` 补 `- insert:` 行

上面 4 个插件都声明了 `dsh.bundle.patch` 并各自带一个 `cordis.patch.yml`，所以能全自动注册。
`dsh-skin-switch` 没有该声明，因此不在自动安装命令里。

用本地路径安装会写成 `link:` 依赖，装完**不会被后续 `pnpm install` 清掉**。

### 卸载

```sh
dsh plugin --profile desktop remove dsh-memory
```

### 验证

```sh
dsh --profile desktop --dump-config
```

退出码为 0，且输出里能看到各插件的 `- id:` 行，即为正常。

### 插件数据

持久化在 `$DSH_HOME/`（默认 `~/.dsh/`）下：

| 文件 | 所属插件 |
|---|---|
| `dsh-memories.json` | `dsh-memory` |
| `personas.json` | `dsh-persona-manager` |
| `deepseek-balance.json` | `deepseek-balance` |

---

## 🧩 插件开发规范

每个插件三个文件：

- `lib/index.js` — 服务端端点（Host）
- `lib/client.js` — UI 插槽注册（Client）
- `package.json` — 包描述文件

`package.json` 还需声明 `dsh` 字段，才能被官方插件机制自动注册：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-runtime"]
    }
  }
}
```

其中 `cordis.patch.yml` 的内容是一条 insert 行：

```yaml
- insert:
    - id: <插件 id>
      name: <包名>
```

**必须遵守：**

1. 仅使用 ESM 模块 —— 不允许 `require()`，使用 `import`
2. `dsh.bundle.patch` 必须指向实际存在的 patch 文件
3. 不允许重复的 `const` 声明
4. `inject` 数组只列出实际依赖项
5. 提交前用 `node --check` 验证语法

### 部署

```sh
dsh plugin --profile desktop add ./<插件目录>
dsh --profile desktop --dump-config   # 复核
```

---

## 🖥️ 自建桌面外壳（已归档）

> 官方桌面端发布后这部分不再维护，保留供查阅。代码仍可构建运行。

外壳存在的原因，是官方桌面端发布前 DSH 只有 Web GUI。它把 GUI 套进原生窗口，并在外面补了
官方当时没有的能力：崩溃守护、开机自启、会话级的进程管理。

官方桌面端补齐托盘、自动更新和服务托管之后，这一层的价值只剩**崩溃守护**和**开机自启**
两项——这两项截至当前版本的官方桌面端仍没有。

### WPF 原生外壳

纯 .NET 8 + C# + WPF + WebView2，约 35 MB，无 Chromium 开销。

| 功能 | 状态 |
|---|---|
| 窗口关闭最小化到托盘 | ✅ 不退出程序 |
| 托盘菜单（重启服务、开机自启、安全模式） | ✅ 含气泡提示反馈 |
| 服务状态实时通知 | ✅ 启动 / 停止 / 错误提示 |
| 一键清理 WebView2 缓存 | ✅ |
| 内置日志查看器 | ✅ `LogViewer.xaml` |
| 崩溃防护（安全模式 / 看门狗） | ✅ |
| 皮肤热加载 | ✅ `SkinWatcher.cs` |
| DSH CLI 全局路径解析 | ✅ 支持全局 npm 安装 |

核心组件（`desktop-native/DeepSeekHarnessDesktop/`）：

- `MainWindow.xaml.cs` — WebView2 GUI 宿主
- `App.xaml.cs` — 托盘菜单、服务生命周期管理
- `LogViewer.xaml(.cs)` — 系统日志面板
- `Services/`
  - `DshServiceManager.cs` — DSH 服务进程管理
  - `CrashRecovery.cs` — 崩溃归因、退避重启、安全模式
  - `CircuitBreaker.cs` — 熔断限流
  - `CrashStateStore.cs` — 崩溃历史持久化
  - `SessionToolsServer.cs` — 3090 HTTP 桥（见下方端点表）
  - `SkinWatcher.cs` — 皮肤热更新
  - `AppSettings.cs` — 设置读写
  - `Log.cs` — 日志

### Electron 外壳

`desktop/main.js`。

托盘菜单：显示 / 打开主窗口、在浏览器中打开、重启 DSH 服务、开机自启（复选）、
启动安全模式 / 恢复正常模式、退出。

| 功能 | 状态 |
|---|---|
| 自动服务启动 / 停止 | ✅ |
| 托盘菜单（重启、自启、安全模式） | ✅ |
| 崩溃自恢复（约 2 秒） | ✅ |
| 皮肤轮询 | ✅ |
| 崩溃状态持久化跨重启 | ✅ |

### 3090 HTTP 桥接端点

外壳的桌面行为通过此统一桥接服务器路由（WPF 与 Electron 实现同一套接口）。

| 端点 | 方法 | 描述 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/health?probe=liveness` | GET | 存活探针 — 探测 DSH 端口 |
| `/health?probe=readiness` | GET | 就绪探针 — 状态 + 安全模式 |
| `/health?probe=metrics` | GET | 内存 / 运行时间 / 崩溃次数 |
| `/info` | GET | 应用信息 |
| `/restart` | GET | 重启 DSH 服务（频率限制） |
| `/open?path=` | GET | 打开文件 |
| `/reveal?path=` | GET | 在资源管理器中显示 |
| `/dom?q=` | GET | 查询 DOM 元素 |

> 会话备份的 `/backup`、`/restore`、`/rollback` 三个端点已移除。

### 🛡️ 防崩溃机制

三层防御，灵感来自 Netflix Hystrix + Kubernetes 健康检查 + Sentinel 限流。

| 层级 | 机制 | 效果 |
|---|---|---|
| L1 进程守护 | 崩溃归因 + 自动重启 | 退出码 / 信号 / stderr 分析 |
| L1 频率限制 | 指数退避 + 熔断器 | 1s→2s→4s… 上限 60s；冷却 120s |
| L1 安全模式 | 连续崩溃降级 | 3 次以上崩溃 → 禁用非核心插件 |
| L2 看门狗 | 运行时存活探针 | 每 5s 检测；3 次失败后 kill |
| L3 持久化 | `crash-state.json` | 历史记录跨重启保留 |

恢复链路：`kill` → `cause=runtime` → 退避 1s → 启动 → 约 **2 秒**恢复。

---

## 📁 项目结构

```
deepseek_harness/
+-- plugins/                         # DSH 插件（本仓库的活跃部分）
+   +- deepseek-balance/             # 余额监控（唯一带 README 的插件）
+   +- dsh-memory/
+   +- dsh-persona-manager/
+   +- dsh-prompt-enhancer/
+   +- dsh-skin-switch/              # 仅注册在旧 web profile
+-- desktop/                         # Electron 外壳（已归档）
+   +- main.js                       # 主进程（托盘、防崩溃、安全模式）
+   +- preload.js                    # IPC 桥接
+   +- package.json
+   +- assets/                       # 图标与资源
+   +- scripts/                      # 构建辅助（CDP 探针、图标/Logo 生成、Electron 下载）
+-- desktop-native/                  # WPF 外壳（已归档）
+   +- DeepSeekHarnessDesktop/
+       +- App.xaml.cs               # 托盘菜单、服务管理
+       +- MainWindow.xaml.cs        # WebView2 宿主窗口
+       +- LogViewer.xaml(.cs)       # 日志面板
+       +- Services/                 # 组件清单见上文「WPF 原生外壳」
+-- docs/
+   +- native-desktop-analysis.md
+   +- optimized-memories.md         # 项目知识库
+-- NOTES.md                         # 开发笔记
+-- DEVELOPMENT_LOG.md               # 开发日志
+-- README.md
```

---

## 🤝 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 核心框架
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 侧边栏设计参考
- [deep-whale-day-night-theme](https://github.com/GGBond2424648901/deep-whale-day-night-theme) — 鲸鱼娘昼夜皮肤

---

## 📄 许可证

MIT
