# deepseek-balance — DeepSeek 余额监控与用量统计插件

在 DeepSeek Harness Web GUI 左侧栏底部「设置」按钮旁边，显示 DeepSeek 账户余额、今日/近 7 天/累计用量，并提供**一键跳转官方充值页**。

## 功能

- **余额监控**：调用官方接口 `GET https://api.deepseek.com/user/balance`（文档见 <https://api-docs.deepseek.com/zh-cn/api/get-user-balance/>），展示总余额、充值余额、赠送余额、可用状态。
- **用量统计**：每次成功查询把余额快照写入本地历史，据此计算 **今日消耗 / 近 7 天消耗 / 累计消耗（自启用以来）**，并渲染近 14 天消耗迷你柱状图。
- **一键充值**：弹层内「充值 ↗」按钮直接打开官方充值页 <https://platform.deepseek.com/top_up>（服务端 302 跳转 / 新标签页打开）。
- **自动刷新**：挂载时 + 每 60 秒自动轮询（服务端对官方接口做 ≥30s 节流，避免频繁调用）。
- **状态持久化**：`$DSH_HOME/deepseek-balance.json`（默认 `~/.dsh/deepseek-balance.json`）。

## 安全边界

- `DEEPSEEK_API_KEY` **只在服务端使用**（`ctx.credentials` 解析 `~/.dsh/.credentials.yaml` / 环境变量），
  余额接口由插件服务端半边代理调用，浏览器端只收到余额数值，**密钥绝不下发**。
- 插件路由绑定在 DSH 本地服务上（默认 `127.0.0.1:3080`）。

## 安装（已安装，无需重复）

插件已安装进 web profile：

- 源码：`D:\deepseek_harness\plugins\deepseek-balance`
- 安装位：`C:\Users\lenovo\.dsh\profiles\node_modules\deepseek-balance`
- profile 声明：`C:\Users\lenovo\.dsh\profiles\web\package.json` 的
  `dependencies`（`file:D:/deepseek_harness/plugins/deepseek-balance`）与
  `dsh.profile.bundles`（`"deepseek-balance"`）

**重启桌面应用（或托盘 → 重启 DSH 服务）后生效。**

## 需要时启用 / 停用（不用删包）

编辑 `C:\Users\lenovo\.dsh\profiles\web\cordis.patch.yml`（profile 用户层，DSH 会热重载；
稳妥起见改完重启一次桌面应用）：

```yaml
# 停用：
- id: deepseek-balance
  disabled: true

# 重新启用：删除上面两行即可
```

也可以运行随附脚本：

```powershell
powershell -ExecutionPolicy Bypass -File D:\deepseek_harness\plugins\deepseek-balance\scripts\disable.ps1
powershell -ExecutionPolicy Bypass -File D:\deepseek_harness\plugins\deepseek-balance\scripts\enable.ps1
```

## 更新插件代码

```powershell
# 改完 D:\deepseek_harness\plugins\deepseek-balance 下的源码后同步到安装位：
Copy-Item -Recurse -Force D:\deepseek_harness\plugins\deepseek-balance\* C:\Users\lenovo\.dsh\profiles\node_modules\deepseek-balance\
# 然后重启桌面应用
```

## 卸载

1. 从 `C:\Users\lenovo\.dsh\profiles\web\package.json` 删除 `deepseek-balance` 的依赖与 bundles 条目。
2. 删除 `C:\Users\lenovo\.dsh\profiles\node_modules\deepseek-balance` 目录。
3. 可选：删除 `~/.dsh/deepseek-balance.json` 历史数据。
4. 重启桌面应用。

## 开发说明

- `lib/index.js` —— 服务端半边（Cordis 插件，`inject: [webServer, credentials]`，注册 `/dsb/api/*` 路由）。
- `lib/client.js` —— 浏览器 bundle（手工编写的 `window.__ModuleLoader__.load({ id, factory })` 插件，
  注册到 `sidebar.footer.action` 槽位；只依赖外壳静态注册的 `react` / `react-dom`）。
- `test/smoke.mjs` —— 服务端冒烟测试（`node test/smoke.mjs`，测试用临时 DSH_HOME，不污染真实数据）。
