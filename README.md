# DeepSeek Harness Desktop

> DeepSeek Harness（DSH）的 Windows 桌面客户端 + 一组增强插件。

基于 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web GUI，封装为原生 Electron 桌面应用，提供系统托盘、自动服务管理、会话备份/回退等功能，并附带多个实用插件。

---

## ✨ 功能一览

### 🖥️ 桌面客户端（desktop/）

| 功能 | 说明 |
|---|---|
| 原生窗口 | WebContentsView 嵌入 DSH Web GUI，支持窗口缩放、最小化到托盘 |
| 自动服务管理 | 启动时自动检测并启动 DSH 服务，退出时可选保留服务 |
| 系统托盘 | 重启服务、开机自启、在浏览器中打开、退出 |
| 会话安全网 | 一键备份/回退/恢复会话（GUI header 按钮 + 3090 HTTP 桥） |
| 皮肤支持 | 读取 profile 配置自动应用皮肤（maid-atelier 永久启用） |
| 峰谷倒计时 | DeepSeek 峰谷定价实时显示（9:00-12:00、14:00-18:00 北京时间） |
| 一键更新 | 设置 → 版本更新，自动对比 npm 最新版本，一键下载更新 |
| 零配置启动 | 首次运行自动通过 npx 下载 DSH CLI，无需手动安装 |

### 🔌 插件（plugins/）

#### [deepseek-balance](plugins/deepseek-balance/) — 余额监控

在 GUI 侧边栏底部显示 DeepSeek 账户余额、今日/近 7 天/累计用量，柱状图可视化消耗趋势，一键跳转充值。

#### [dsh-workspace-tree](plugins/dsh-workspace-tree/) — 工作区文件树

在 GUI 右侧以停靠面板形式显示工作区目录树，完全复刻原版外壳 sidebar 的功能：
- 🐋 工作区 header（刷新/在资源管理器中打开/收起）
- 目录展开/收起、文件大小显示
- 点击文件用默认程序打开
- 停靠式布局（margin-push），不遮挡 header 和输入框
- 峰谷倒计时 + 版本更新检查（设置页面）

#### [dsh-session-tools](plugins/dsh-session-tools/) — 会话工具

在会话 header 提供备份/回退/恢复三个按钮，通过 3090 HTTP 桥与桌面应用通信，支持会话安全回滚。

#### [dsh-skin-switch](plugins/dsh-skin-switch/) — 皮肤切换

EAC 皮肤切换器，支持从 `@dsh-external` 包加载自定义皮肤。

#### [dsh-deep-whale/maid-atelier](plugins/dsh-deep-whale/maid-atelier/) — 深海女仆皮肤

深海军蓝主题皮肤，永久启用。暗色背景 + 金色强调色。

---

## 🚀 安装

### 前置条件

- Windows 10/11
- [Node.js](https://nodejs.org/) ≥ 20

### 方式一：下载安装包（推荐）

从 [Releases](https://github.com/RAOsam/deepseek_harness/releases) 下载 `DeepSeek Harness Desktop-0.1.2-setup.exe`，双击安装即可。

首次启动会自动通过 npx 下载 DSH CLI（约 1-2 分钟）。

### 方式二：从源码运行

```powershell
# 克隆仓库
git clone https://github.com/RAOsam/deepseek_harness.git
cd deepseek_harness

# 安装桌面应用依赖
cd desktop
npm install

# 启动
npm start
```

### 方式三：安装插件到已有 DSH

```powershell
# 进入 DSH web profile 目录
cd ~/.dsh/profiles/web

# 安装插件（以余额监控为例）
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add deepseek-balance
```

---

## 📁 项目结构

```
deepseek_harness/
├── desktop/                    # Electron 桌面客户端
│   ├── main.js                 # 主进程（窗口、服务管理、托盘、3090 桥）
│   ├── preload.js              # 预加载脚本（IPC 桥接）
│   ├── assets/                 # 图标、资源
│   ├── scripts/                # 构建/诊断脚本
│   └── release/                # 构建产物
├── plugins/                    # DSH 插件
│   ├── deepseek-balance/       # 余额监控插件
│   ├── dsh-workspace-tree/     # 工作区文件树插件
│   ├── dsh-session-tools/      # 会话备份/回退/恢复
│   ├── dsh-skin-switch/        # 皮肤切换器
│   └── dsh-deep-whale/         # 深海女仆皮肤
└── README.md
```

---

## 🔧 开发

### 构建安装包

```powershell
cd desktop
npm run dist
```

产物在 `desktop/release/DeepSeek Harness Desktop-x.x.x-setup.exe`。

### 插件开发

插件采用 Cordis 架构，每个插件包含：
- `lib/index.js` — 服务端（Host），注册 HTTP 路由、读写文件
- `lib/client.js` — 客户端（Client），注册 UI 槽位、渲染 React 组件
- `package.json` — 包描述
- `cordis.patch.yml` — profile 挂载声明（可选）

详见 [Cordis 插件开发文档](https://github.com/deepseek-ai/deepseek-harness)。

### 3090 HTTP 桥端点

桌面应用在 `127.0.0.1:3090` 提供以下端点（CORS *）：

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/backup` | GET | 备份当前会话 |
| `/restore` | GET | 恢复会话 + 重载 GUI |
| `/rollback` | GET | 回滚到最近备份 |
| `/open?path=` | GET | 用默认程序打开文件 |
| `/reveal?path=` | GET | 在资源管理器中显示 |
| `/restart` | GET | 重启 DSH 服务 |

---

## 🙏 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 核心框架
- [Deepseek-Harness-EAC](https://github.com/zouyuxuan122/Deepseek-Harness-EAC) — 布局挤压（margin-push）停靠方案参考
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 侧边栏框架设计参考

---

## 📄 许可证

MIT
