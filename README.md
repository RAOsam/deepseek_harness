# DeepSeek Harness Desktop

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![.NET](https://img.shields.io/badge/.NET_8-512BD4?style=for-the-badge&logo=.net&logoColor=white)]()
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)]()

> A Windows desktop client + plugin ecosystem for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

DSH wraps the deepseek-ai Web GUI into a full desktop experience — system tray management, automatic service lifecycle, session backup/rollback, and a growing plugin ecosystem.

---

## ✨ Features

### 🖥️ Desktop Shells

Two shell options available — pick whichever fits your needs:

#### 🔷 WPF Native Shell (Recommended)

Pure .NET 8 + C# + WinUI + WebView2. **Lightweight at ~35MB** with zero Chromium overhead.

| Feature | Status |
|---|---|
| Exe icon & window memory | ✅ Built-in |
| Service status notifications | ✅ Real-time |
| Cache cleanup utilities | ✅ One-click |
| Built-in log viewer | ✅ `LogViewer.xaml` |
| Crash prevention (safe mode/watchdog) | ✅ Via HTTP bridge |
| Bundle size | 🟢 ~35 MB |

**Core components:**
- `MainWindow.xaml.cs` — WebView2 GUI host
- `LogViewer.xaml.cs` — System log panel
- `SessionToolsServer.cs` — API handler
- `CrashRecovery.cs` / `CircuitBreaker.cs` — Fault isolation
- `SkinWatcher.cs` — Hot-skin reload

Source: `desktop-native/DeepSeekHarnessDesktop/`

#### 💙 Legacy Shell

`desktop/main.js` — Full-featured desktop implementation with tray, auto-start, crash recovery, safe mode isolation, and session backup/restore via 3090 HTTP bridge.

| Feature | Status |
|---|---|
| Auto service start/stop | ✅ |
| Tray menu (restart, startup, safe mode) | ✅ |
| Crash self-recovery (~2s restart) | ✅ |
| Session backup & rollback | ✅ |
| Skin support (maid-atelier built-in) | ✅ |
| Peak/valley pricing countdown | ✅ |
| One-click update check | ✅ |

### 🔌 Plugin Ecosystem

Each plugin uses the **Cordis architecture**: `lib/index.js` (server routes) + `lib/client.js` (UI slots). All registered in `profiles/web/cordis.patch.yml`.

| Plugin | Purpose | Key Features |
|---|---|---|
| `${b}dsh-memory${b}` | Long-term memory | Category groups, BM25 dedup, image OCR |
| `${b}dsh-persona-manager${b}` | Persona mgmt | Multi-p creation, toast alerts, persistence |
| `${b}dsh-prompt-enhancer${b}` | Prompt enhance | 3 modes, custom models, connectivity test |
| `${b}dsh-session-tools${b}` | Session tools | Backup, rollback, restore |
| `${b}dsh-skin-switch${b}` | Theme switcher | Settings UI, maid-atelier included |
| `${b}deepseek-balance${b}` | Balance monitor | Usage stats, bar charts, real-time |

---

## 🚀 Installation

**Prerequisites:**
- Windows 10/11
- [Node.js](https://nodejs.org/) ≥ 20

### Method 1 — Installer (Fastest)

[Download latest installer →](https://github.com/RAOsam/deepseek_harness/releases)

### Method 2 — Build from source

```powershell
git clone https://github.com/RAOsam/deepseek_harness.git
cd deepseek_harness/desktop
npm install
npm start
```

---

## 📁 Project Structure

```
deepseek_harness/
+-- desktop/                    # Legacy desktop shell
+   +- main.js                  # Main process (tray, anti-crash, safe mode)
+   +- preload.js               # IPC bridge
+   +- assets/                  # Icons & resources
+   +- test-anticrash-deep.js   # 13 fault injection tests
+   +- release/                 # Build artifacts
+-- desktop-native/             # WPF native shell (alternative)
+   +- DeepSeekHarnessDesktop/  # WinUI + WebView2 project
+-- docs/
+   +- native-desktop-analysis.md
+   +- optimized-memories.md    # Project knowledge base
+-- plugins/                    # DSH plugins
+   +- dsh-memory/
+   +- dsh-persona-manager/
+   +- dsh-prompt-enhancer/
+   +- dsh-session-tools/
+   +- dsh-skin-switch/
+   +- deepseek-balance/
+-- README.md
```

---

## 🔧 Development

### Plugin Rules

ECAH each plugin needs three files:
- `lib/index.js` — Server endpoints (Host)
- `lib/client.js` — UI slot registration (Client)
- `package.json` — Package descriptor

**Must comply:**
1. ESM modules only — no `require()`, use `import`
2. Must register in `profiles/web/cordis.patch.yml` under `- insert:` entries
3. No duplicate `const` declarations
4. `inject` array lists only actual dependencies
5. Validate syntax with `node --check` before deploying

### 3090 HTTP Bridge Endpoints

All desktop behaviors route through this unified bridge server.

| Endpoint | Method | Description |
|---|---|---|
| `${b}/health${b}` | GET | Health check |
| `${b}/health?probe=liveness${b}` | GET | Liveness probe — ping 3080 |
| `${b}/health?probe=readiness${b}` | GET | Readiness — status + safe mode |
| `${b}/health?probe=metrics${b}` | GET | Memory/uptime/crashes |
| `${b}/backup${b}` | GET | Backup current session |
| `${b}/restore${b}` | GET | Restore session + reload GUI |
| `${b}/rollback${b}` | GET | Rollback to last backup |
| `${b}/restart${b}` | GET | Restart DSH service (rate limited) |
| `${b}/open?path=${b}` | GET | Open file |
| `${b}/reveal?path=${b}` | GET | Reveal in File Explorer |
| `${b}/dom?q=${b}` | GET | Query DOM element |

### 🛡️ Anti-Crash Mechanism

Three-layer defense inspired by Netflix Hystrix + Kubernetes health checks + Sentinel rate-limiting.

| Layer | Mechanism | Effect |
|---|---|---|
| L1 Process Guardian | Crash attribution + auto restart | Exit code/signal/stderr analysis |
| L1 Rate Limiting | Exponential backoff + circuit breaker | 1s→2s→4s… cap 60s; cooldown 120s |
| L1 Safe Mode | Consecutive crash degradation | 3+ crashes → disable non-core plugins |
| L2 Watchdog | Runtime liveness probe | Ping every 5s; kill after 3 failures |
| L3 Persistence | ${b}crash-state.json${b} | History survives restarts |

Recovery chain: `kill` → `cause=runtime` → backoff 1s → spawn → recovered in **~2 seconds**.

Test: `node desktop/test-anticrash-deep.js` (13 scenarios including real crash tests).

---

## 🤝 Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — Core framework
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — Sidebar design reference

---

## 📄 License

MIT