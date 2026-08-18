# DeepSeek Harness Desktop

DeepSeek Harness 的桌面客户端（Electron）。原生窗口嵌入 DSH Web GUI，自动管理 DSH 服务生命周期，带系统托盘。

## 功能

- **原生窗口**：加载本机 DSH Web GUI（默认 `http://127.0.0.1:3080`）
- **右侧边栏工作区目录**：窗口右侧文件树浏览工作区（展开/收起目录、点击打开文件、刷新、在资源管理器中打开；隐藏点文件如 `.git`、`.env`）
- **官方 DeepSeek logo**：应用/托盘/快捷方式/安装程序图标均取自 DSH 官方 `favicon.svg`（品牌蓝）
- **服务自动管理**：启动时探测端口，未运行时自动拉起 `dsh --profile web`；退出时保留由本应用启动的服务（`keepServerOnQuit` 默认 `true`，避免"退应用杀服务"）
- **系统托盘**：显示/隐藏窗口、在浏览器打开、重启服务、开机自启开关、退出
- **智能连接**：若已有 DSH 服务在运行（如本会话所在的服务），直接连接复用，不再重复启动
- **日志**：运行日志写入 `%APPDATA%/dsh-desktop/logs/main.log`，DSH 服务输出一并记录
- **打包支持**：内置 electron-builder 配置，可产出 Windows 安装包

## 环境要求

- Windows（本版本面向 Windows；Node ≥ 18）
- 本机可执行 `dsh`（即已通过 `npx @deepseek-ai/dsh` 或全局安装 DSH CLI）

## 安装与运行

```powershell
cd D:\deepseek_harness\desktop
npm install        # 安装 electron 等依赖（首次约 100MB 下载）
npm run gen-icon   # 生成应用/托盘图标（可选，仓库已含 assets 时跳过）
npm start          # 启动桌面客户端
```

首次启动时：如果 3080 端口没有 DSH 服务，应用会自动拉起一个 `dsh web` 实例并等待其就绪，然后打开主窗口。

## 配置

设置文件：`%APPDATA%/dsh-desktop/settings.json`（应用首次运行后生成），可手动编辑：

```json
{
  "host": "127.0.0.1",
  "port": 3080,
  "startServerOnLaunch": true,
  "minimizeToTray": true,
  "keepServerOnQuit": false,
  "autoStart": false,
  "nodePath": "",
  "dshCliPath": ""
}
```

| 字段 | 说明 |
|---|---|
| `host` / `port` | DSH 服务地址与端口 |
| `startServerOnLaunch` | 启动时若端口无服务，自动拉起 `dsh web` |
| `minimizeToTray` | 关闭窗口时最小化到托盘而非退出 |
| `keepServerOnQuit` | 退出应用时保留已启动的 DSH 服务（默认关闭，即随应用退出） |
| `autoStart` | 开机自启（也可在托盘菜单切换） |
| `nodePath` | 指定 node.exe 绝对路径（自动探测失败时使用） |
| `dshCliPath` | 指定 `@deepseek-ai/dsh/lib/bin.js` 绝对路径（自动探测失败时使用） |
| `workspaceDir` | 侧边栏工作区根目录（留空时自动探测：`D:\deepseek_harness` → 应用上级目录 → 用户主目录） |

DSH CLI 的自动探测顺序：`dshCliPath` 配置 → 应用目录内 `node_modules` → npm npx 缓存中最新的 `@deepseek-ai/dsh`。

## 打包为安装程序

```powershell
npm run dist        # 产出 NSIS 安装包到 release/
npm run dist:dir    # 仅产出免安装目录
```

## 目录结构

```
desktop/
├── main.js            # Electron 主进程：窗口、托盘、服务生命周期、文件 IPC
├── preload.js         # contextBridge 桥接（加载页/错误页/侧边栏用）
├── sidebar.html/js/css# 侧边栏工作区文件树 UI
├── scripts/gen-icon.js# 纯 Node 图标生成器（无依赖）
├── assets/            # 生成的 PNG/ICO 图标
└── package.json       # 启动/打包脚本与 electron-builder 配置
```

## 常见问题

- **托盘图标消失**：托盘由系统管理，点击"显示隐藏的图标"即可找到。
- **服务启动失败**：查看 `%APPDATA%/dsh-desktop/logs/main.log`；若 `dsh` 不在 PATH，可在 `settings.json` 中配置 `dshCliPath`。
- **端口冲突**：若 3080 被非 DSH 程序占用，应用会尝试连接它；请改 `settings.json` 中的 `port` 并重启应用。
