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
| 系统托盘 | 重启服务、开机自启、安全模式/恢复模式、退出 |
| 会话安全网 | 一键备份/回退/恢复会话（3090 HTTP 桥） |
| **防崩溃自愈** | 崩溃归因 → 指数退避重启 → 自动安全模式 → 熔断限流（详见下文） |
| 皮肤支持 | 读取 profile 配置自动应用皮肤（maid-atelier 永久启用） |
| 峰谷倒计时 | DeepSeek 峰谷定价实时显示（9:00-12:00、14:00-18:00 北京时间） |
| 一键更新 | 设置 → 版本更新，自动对比 npm 最新版本，一键下载更新 |
| 零配置启动 | 首次运行自动通过 npx 下载 DSH CLI，无需手动安装 |

### 🔌 插件（plugins/）

#### [dsh-memory](plugins/dsh-memory/) — 长期记忆管理

卡片式 UI，支持分类分组、图片识别、整理预览。

- 5 类记忆：偏好、信息、事件、规则、背景
- 按分类分组显示，彩色大标签（分组头固定显示）
- 直接渲染全部记忆卡片（保留滚动条，无顶部空白）
- BM25 语义去重（阈值 0.18）
- 整理前预览合并项，确认后再执行
- 粘贴图片自动识别内容

#### [dsh-persona-manager](plugins/dsh-persona-manager/) — 人设管理

卡片式 UI，支持快速切换、Toast 提示、服务端持久化。

- 多人设管理，一键切换
- 切换时 Toast 通知当前人设
- 人设绑定持久化到服务端（重启后恢复）
- 会话 header 快速切换下拉

#### [dsh-prompt-enhancer](plugins/dsh-prompt-enhancer/) — 提示词增强

DashScope API 集成，支持自定义模型、连通检测。

- 3 种模式：基础/标准/专家
- 自定义模型列表（添加/删除/测试连通）
- 模型连通状态实时显示
- 知识库管理（BM25 检索）

#### [dsh-session-tools](plugins/dsh-session-tools/) — 会话工具

会话备份/回退/恢复（通过 3090 HTTP 桥）。

#### [dsh-skin-switch](plugins/dsh-skin-switch/) — 皮肤切换

设置页皮肤切换，内置 maid-atelier 皮肤。

- 每张皮肤卡片显示 GitHub 仓库链接（`skin.json` 的 `repo` 字段），一键直达源码
- 皮肤列表可排序，选中即应用

#### [deepseek-balance](plugins/deepseek-balance/) — 余额监控

侧边栏底部显示 DeepSeek 账户余额、用量统计、柱状图。

---

## 🚀 安装

### 前置条件

- Windows 10/11
- [Node.js](https://nodejs.org/) ≥ 20

### 方式一：下载安装包（推荐）

从 [Releases](https://github.com/RAOsam/deepseek_harness/releases) 下载最新安装包，双击安装即可。

### 方式二：从源码运行

```powershell
git clone https://github.com/RAOsam/deepseek_harness.git
cd deepseek_harness/desktop
npm install
npm start
```

---

## 📁 项目结构

```
deepseek_harness/
├── desktop/                    # Electron 桌面客户端
│   ├── main.js                 # 主进程（窗口、服务管理、托盘、防崩溃、安全模式）
│   ├── preload.js              # 预加载脚本（IPC 桥接）
│   ├── assets/                 # 图标、资源
│   ├── test-anticrash.js       # 防崩溃核心逻辑单元测试
│   ├── test-anticrash-deep.js  # 防崩溃深度故障注入测试（13 场景）
│   └── release/                # 构建产物
├── docs/
│   └── anti-crash-optimization.md  # 防崩溃优化方案设计文档
├── plugins/                    # DSH 插件
│   ├── dsh-memory/             # 长期记忆管理
│   ├── dsh-persona-manager/    # 人设管理
│   ├── dsh-prompt-enhancer/    # 提示词增强
│   ├── dsh-session-tools/      # 会话备份/回退/恢复
│   ├── dsh-skin-switch/        # 皮肤切换器
│   └── deepseek-balance/       # 余额监控
└── README.md
```

---

## 🔧 开发

### 插件开发规则

插件采用 Cordis 架构，每个插件包含：
- `lib/index.js` — 服务端（Host），注册 HTTP 路由
- `lib/client.js` — 客户端（Client），注册 UI 槽位
- `package.json` — 包描述

**必须遵守：**
1. ESM 模块不能用 `require()`，必须用 `import`
2. 插件必须在 `profiles/web/cordis.patch.yml` 中注册
3. 不能有重复的 `const` 声明
4. `inject` 只声明实际使用的依赖
5. 部署前用 `node --check` 验证语法

### 3090 HTTP 桥端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查（三层探针见下） |
| `/health?probe=liveness` | GET | 存活探针：真实探活 3080 服务 |
| `/health?probe=readiness` | GET | 就绪探针：服务状态 + 安全模式 |
| `/health?probe=metrics` | GET | 指标：内存/运行时长/崩溃统计/熔断状态 |
| `/backup` | GET | 备份当前会话 |
| `/restore` | GET | 恢复会话 + 重载 GUI |
| `/rollback` | GET | 回滚到最近备份 |
| `/restart` | GET | 重启 DSH 服务（60s 限流 3 次） |

### 🛡️ 防崩溃机制（desktop/main.js）

参考 Netflix Hystrix、Kubernetes 健康检查、Sentinel 限流降级设计，四层防御：

| 层级 | 机制 | 说明 |
|---|---|---|
| L1 进程守护 | 崩溃归因 + 自动重启 | 根据退出码 / signal / stderr 区分端口冲突、OOM、插件崩溃、外部终止 |
| L1 防风暴 | 指数退避 + 冷却 + 熔断 | 1s→2s→4s…上限 60s；60s 内 ≥3 次真实崩溃冷却 120s；熔断器滑动窗口 60s |
| L1 自动安全模式 | 连续崩溃自动降级 | 连续 3 次运行期/插件崩溃 → 自动禁用非核心插件后重启（隔离问题插件） |
| L2 watchdog | 运行期探活 | 每 5s 探活，连续 3 次失败 kill 子进程触发恢复（防僵死） |
| L3 限流 | 会话工具限流 | `/restart` 60s 最多 3 次，超限返回 429 |
| L4 持久化 | crash-state.json | 崩溃历史跨会话保存，重启后恢复计数与安全模式 |

**崩溃恢复链路（实测）：** kill 服务进程 → 日志出现 `cause=runtime` → 退避 1s → 自动 spawn 拉起，全程约 2 秒，桌面壳不重启、会话不丢。

**测试：** `node desktop/test-anticrash-deep.js`（13 个故障注入场景，含真实崩溃注入验证）。

---

## 🙏 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 核心框架
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — 侧边栏框架设计参考

---

## 📄 许可证

MIT