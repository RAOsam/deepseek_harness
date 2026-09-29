## DSH 插件开发：cordis.patch.yml 清空导致崩溃

【致命问题】修改 cordis.patch.yml 时所有 insert 块内容被清空，导致全部插件加载失败。表现：打开 DSH 后所有插件面板消失。

恢复方案：从工作区完整覆盖到 C:\Users\lenovo\.dsh\profiles\web\cordis.patch.yml。源文件位于 D:\deepseek_harness\cordis.patch.yml。

预防措施：编辑后必须验证每行 '- insert:' 后面紧跟 '- id: xxx'，不能有空行。

---

## DSH 原生桌面壳架构（WPF + WebView2）

【架构决策】使用 .NET 8 + C# + WinUI 替代 Electron 实现原生 Windows 壳，bundle 从 ~180MB 降到 ~35MB。

核心设计：所有桌面端行为统一走 3090 HTTP 桥——备份/回退/重启/健康检查/缓存清理全部复用服务端代码，无需在原生壳内重复实现。

组件：MainWindow(WebView2 GUI), LogViewer.xaml, SessionToolsServer.cs, CrashRecovery.cs, CircuitBreaker.cs, SkinWatcher.cs

源码位置：D:\deepseek_harness\desktop-native\DeepSeekHarnessDesktop

---

## DSH web-app SPA 特性与插件适配

【关键认知】DSH web-app 是纯 SPA，不使用 URL 路径切换会话。

影响：
- window.location.pathname 始终不变（无法提取会话 ID）
- history.pushState 未被使用（onRouteChange 回调不触发）
- 'sessions' 注入服务会导致插件编译失败

获取会话 ID 的可靠方式优先级：
1. window.history.state.sessionId（SPA 内部路由状态）
2. DOM data-session-id 属性查询
3. fallback 到 URL pathname

---

## modlens 视觉模型变更记录

配置变更：C:\Users\lenovo\.modlens\config.json 中模型从 qwen-vl-plus 改为 qwen-vl-lite。

原因：qwen-vl-plus 费用较高（¥0.003/千 token 输入 + ¥0.012/千 token 输出），qwen-vl-lite 更便宜约一半。

API Key：dashscope.aliyuncs.com/compatible-mode/v1

---

## 3090 HTTP 桥接端点完整列表

| 端点 | 方法 | 说明 |
|---|---|---|
| /health | GET | 健康检查（三层探针） |
| /info | GET | 应用信息 |
| /restart | GET | 重启 DSH 服务（60s 限流 3 次） |
| /open?path= | GET | 打开文件 |
| /reveal?path= | GET | 在资源管理器中显示文件 |
| /dom?q= | GET | DOM 查询