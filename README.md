# DeepSeek Harness Desktop

> A Windows desktop client + plugin ecosystem for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

DSH wraps the deepseek-ai Web GUI into a full desktop experience — system tray management, automatic service lifecycle, session backup/rollback, and a growing plugin ecosystem.

---

## Features

### Desktop Clients

**Desktop shell:** `desktop/main.js` provides system tray, auto-start DSH service, crash recovery with exponential backoff + circuit breaker, safe mode isolation, and session backup/restore via 3090 HTTP bridge.

| Feature | Status |
|---|---|
| Auto service start/stop | OK |
| Tray menu (restart, startup, safe mode) | OK |
| Crash self-recovery (~2s avg restart) | OK |
| Session backup & rollback | OK |
| Skin support (maid-atelier built-in) | OK |
| Peak/valley pricing countdown | OK |
| One-click update check | OK |

**WPF native shell:** Built on .NET 8 + C# + WinUI + WebView2. Bundle size ~35MB.


| Feature | Status |
|---|---|
| exe icon | OK |
| Window position memory | OK |
| Service status notification | OK |
| Cache cleanup | OK |
| Built-in log viewer (`LogViewer.xaml`) | OK |
| Bundle size | ~35MB |

**WPF components:** `MainWindow.xaml.cs` (WebView2 host), `LogViewer.xaml.cs` (log panel), `SessionToolsServer.cs`, `CrashRecovery.cs`, `CircuitBreaker.cs`, `SkinWatcher.cs`. Source: `desktop-native/DeepSeekHarnessDesktop/`.

---

## Plugins

Each plugin follows Cordis architecture: `lib/index.js` (server) + `lib/client.js` (UI slots). Register in `profiles/web/cordis.patch.yml`.

#### dsh-memory
Long-term Memory Management
Card UI with category grouping (Preference/Fact/Event/Rule/Context), BM25 semantic deduplication, preview-before-merge, paste-image OCR.

#### dsh-persona-manager
Persona Management
Multi-p persona creation, toast notifications, server-side persistence, quick-switch dropdown.

#### dsh-prompt-enhancer
Prompt Enhancement
DashScope API integration, 3 modes (Basic/Standard/Expert), custom models, real-time connectivity, knowledge base retrieval.

#### dsh-session-tools
Session Tools
Backup, rollback, restore via 3090 HTTP bridge.

#### dsh-skin-switch
Theme Switcher
Settings page skin switching, maid-atelier included, GitHub repo links per skin.

#### deepseek-balance
Balance Monitor
Sidebar widget showing DeepSeek account balance, usage stats, bar charts.

---

## Installation

**Prerequisites:** Windows 10/11, Node.js >= 20.

**Method 1:** Download from [Releases](https://github.com/RAOsam/deepseek_harness/releases).

**Method 2:** From source:

```powershell
git clone https://github.com/RAOsam/deepseek_harness.git
cd deepseek_harness/desktop
npm install
npm start
```

---

## Project Structure

```
deepseek_harness/
+-- desktop/                    # Desktop shell
+   +- main.js                  # Main process (tray, anti-crash, safe mode)
+   +- preload.js               # IPC bridge
+   +- assets/                  # Icons and resources
+   +- test-anticrash-deep.js   # Fault injection tests (13 scenarios)
+   +- release/                 # Build artifacts
+-- desktop-native/             # WPF native shell alternative
+   +- DeepSeekHarnessDesktop/  # WinUI + WebView2 project
+-- docs/
+   +- native-desktop-analysis.md
+   +- optimized-memories.md    # Knowledge base
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

## Development

### Plugin Rules

Each plugin needs: `lib/index.js` (routes), `lib/client.js` (slots), `package.json`.

**Must comply:**
1. ESM: no `require()`, use `import`
2. Must register in `profiles/web/cordis.patch.yml` under `- insert:` entries
3. No duplicate `const` declarations
4. `inject` only declares actual dependencies
5. Validate with `node --check` before deploying

### 3090 HTTP Bridge Endpoints

| Endpoint | Method | Description |
|---|---|---|
|`/health` | GET | Health check |
|`/health?probe=liveness` | GET | Liveness probe |
|`/health?probe=readiness` | GET | Readiness status |
|`/health?probe=metrics` | GET | Memory/uptime/crashes |
|`/backup` | GET | Backup session |
|`/restore` | GET | Restore + reload GUI |
|`/rollback` | GET | Rollback to last backup |
|`/restart` | GET | Restart service (rate limited) |
|`/open?path=` | GET | Open file |
|`/reveal?path=` | GET | Reveal in Explorer |
|`/dom?q=` | GET | DOM query |
### Anti-Crash Mechanism

Three-layer defense inspired by Netflix Hystrix + Kubernetes + Sentinel:

| Layer | Mechanism |
|---|---|
| L1 Process Guardian | Crash attribution + auto restart (exit code/signal/stderr analysis) |
| L1 Rate Limiting | Exponential backoff 1s→2s→4s… cap 60s; cooldown 120s after 3+ crashes |
| L1 Auto Safe Mode | After 3 consecutive crashes → disable non-core plugins |
| L2 Watchdog | Ping every 5s, kill after 3 failures |
| L3 Persistence | `crash-state.json` survives restarts |

**Recovery chain:** kill → `cause=runtime` → backoff 1s → spawn → recovered in ~2s.

**Test:** `node desktop/test-anticrash-deep.js` (13 scenarios including real crash tests).

---

## Credits

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — Core framework
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — Sidebar design

---

## License

MIT