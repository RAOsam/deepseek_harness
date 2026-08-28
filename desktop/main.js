// DeepSeek Harness Desktop — Electron main process.
// Native window around the DSH Web GUI + DSH service lifecycle management + system tray.
'use strict';

const { app, BrowserWindow, WebContentsView, Tray, Menu, shell, nativeImage, ipcMain } = require('electron');
const { spawn, execFile, execFileSync } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------- settings ----
const DEFAULTS = {
  host: '127.0.0.1',
  port: 3080,
  startServerOnLaunch: true, // spawn `dsh web` if nothing is listening
  minimizeToTray: true,      // closing the window hides to tray instead of quitting
  keepServerOnQuit: true,    // keep the spawned DSH service alive when the app quits
  autoStart: false,          // launch at Windows login
  nodePath: '',              // optional: absolute path to node.exe
  dshCliPath: '',            // optional: absolute path to @deepseek-ai/dsh/lib/bin.js
  workspaceDir: '',          // workspace root for the GUI file tree (auto-detected when empty)
  debugPort: 0,              // Chrome DevTools Protocol port on 127.0.0.1 (0 = off)
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    settings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    log('save settings failed: ' + err.message);
  }
}

// Settings must be loaded BEFORE app 'ready' so Chromium switches below take
// effect; every launch (shortcut, tray, double-click) then gets CDP when
// settings.debugPort is set.
loadSettings();

// Optional Chrome DevTools Protocol endpoint for remote diagnostics, bound to
// loopback only. Enabled by settings.debugPort (or DSH_DEBUG_PORT env) so the
// user can inspect the GUI in Chrome/Edge DevTools (chrome://inspect).
const dbgPort = Number(settings.debugPort || process.env.DSH_DEBUG_PORT || 0);
if (dbgPort > 0) {
  app.commandLine.appendSwitch('remote-debugging-port', String(dbgPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  log('CDP enabled on 127.0.0.1:' + dbgPort);
}

// ------------------------------------------------------------------- logging ----
function logLine() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

let logStream = null;
function log(msg) {
  const line = `[${logLine()}] ${msg}`;
  console.log(line);
  try {
    if (!logStream) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(path.join(dir, 'main.log'), { flags: 'a' });
    }
    logStream.write(line + '\n');
  } catch { /* logging must never crash the app */ }
}

// ------------------------------------------------------------------- probing ----
function tcpProbe(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

// DSH readiness: HTTP GET / returns 200 (the SPA root; title "DeepSeek Harness").
function httpProbeReady(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.once('timeout', () => { req.destroy(); resolve(false); });
    req.once('error', () => resolve(false));
  });
}

function webUrl(host, port) {
  return `http://${host}:${port}`;
}

// ----------------------------------------------------------------- server mgr ----
const server = {
  child: null,
  status: 'idle', // idle | starting | running | stopped | error
  startedByUs: false,
  port: null,
  stdoutTail: [],
  stderrTail: [],
  // anti-crash state (in-memory mirror of ~/.dsh/crash-state.json)
  crash: {
    consecutive: 0,     // 连续非外部崩溃次数（进入安全模式的依据）
    recent: [],         // 最近崩溃时间戳（60s 滑动窗口，用于冷却/防风暴）
    cooldownUntil: 0,   // 冷却截止时间戳（防重启风暴）
    lastCause: null,    // 上一次崩溃归因
    safeMode: false,    // 是否处于安全模式
    probeFails: 0,      // watchdog 连续探活失败计数
    watchdogKill: false, // watchdog 主动 kill 标记（强制按 runtime 恢复）
  },
  manualStop: false,    // 手动停止/重启中（抑制 exit 自动恢复）
};

function crashStateFile() {
  return path.join(app.getPath('home'), '.dsh', 'crash-state.json');
}

function loadCrashState() {
  try {
    return JSON.parse(fs.readFileSync(crashStateFile(), 'utf8'));
  } catch {
    return { crashes: [], safeMode: false };
  }
}

function saveCrashState(patch) {
  const state = loadCrashState();
  Object.assign(state, patch);
  try {
    fs.mkdirSync(path.dirname(crashStateFile()), { recursive: true });
    fs.writeFileSync(crashStateFile(), JSON.stringify(state, null, 2));
  } catch (e) {
    log('save crash-state failed: ' + e.message);
  }
}

function tail(arr, line) {
  arr.push(line);
  if (arr.length > 200) arr.shift();
  return arr;
}

function setServerStatus(status, detail = '') {
  server.status = status;
  log(`server status -> ${status}${detail ? ' (' + detail + ')' : ''}`);
  const payload = { status, detail, port: server.port, url: webUrl(settings.host, server.port) };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('dsh:server-status', payload);
  }
  if (dshView && !dshView.webContents.isDestroyed()) {
    dshView.webContents.send('dsh:server-status', payload);
  }
  layoutViews(); // sidebar appears only once the service is running
  updateTray();
}

function resolveNode() {
  const candidates = [settings.nodePath, process.env.DSH_NODE, 'C:\\Program Files\\nodejs\\node.exe'];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  // resolve `node` from PATH (custom Node installs, nvm, etc.)
  try {
    const res = execFileSync('where', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
    if (res && fs.existsSync(res)) return res;
  } catch { /* not on PATH */ }
  return 'node';
}

function resolveDshCli() {
  if (settings.dshCliPath && fs.existsSync(settings.dshCliPath)) return settings.dshCliPath;
  // relative to this app (e.g. bundled alongside a DSH install)
  const rel = path.join(__dirname, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (fs.existsSync(rel)) return rel;
  // scan the npm npx cache for the newest @deepseek-ai/dsh
  const local = process.env.LOCALAPPDATA || '';
  const npxRoot = path.join(local, 'npm-cache', '_npx');
  let best = null;
  try {
    for (const dir of fs.readdirSync(npxRoot)) {
      const cand = path.join(npxRoot, dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      try {
        if (fs.existsSync(cand) && (!best || fs.statSync(cand).mtimeMs > fs.statSync(best).mtimeMs)) best = cand;
      } catch { /* keep scanning */ }
    }
  } catch { /* no npx cache */ }
  return best;
}

// npx CLI entry next to node.exe (standard npm layout):
// <node-dir>/node_modules/npm/bin/npx-cli.js
function resolveNpxCli() {
  const node = resolveNode();
  if (!node || node === 'node') return null;
  const cand = path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return fs.existsSync(cand) ? cand : null;
}

// Fetch the DSH engine with `npx -y @deepseek-ai/dsh` when it is missing
// (fresh machines with only Node.js installed). Resolves to the CLI path.
function ensureDshCli() {
  return new Promise((resolve) => {
    const existing = resolveDshCli();
    if (existing) { resolve(existing); return; }
    const npxCli = resolveNpxCli();
    if (!npxCli) { log('npx not found next to node.exe — cannot fetch DSH CLI'); resolve(null); return; }
    log('DSH CLI missing — fetching via npx -y @deepseek-ai/dsh (first run)');
    const child = spawn(resolveNode(), [npxCli, '-y', '@deepseek-ai/dsh', '--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.once('error', (err) => {
      log('npx fetch failed: ' + err.message);
      resolve(resolveDshCli());
    });
    child.once('exit', () => {
      log('npx fetch finished' + (out.trim() ? ' (' + out.trim().slice(0, 80) + ')' : ''));
      resolve(resolveDshCli());
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    server.manualStop = true; // 手动停止中：exit 回调不触发自动恢复
    const child = server.child;
    if (!child || child.exitCode !== null) {
      server.child = null;
      server.startedByUs = false;
      resolve();
      return;
    }
    log('stopping spawned dsh (pid ' + child.pid + ')');
    child.kill();
    const deadline = Date.now() + 4000;
    const poll = setInterval(() => {
      if (child.exitCode !== null || Date.now() > deadline) {
        clearInterval(poll);
        if (child.exitCode === null) {
          // force kill the whole tree
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
            server.child = null;
            server.startedByUs = false;
            resolve();
          });
        } else {
          server.child = null;
          server.startedByUs = false;
          resolve();
        }
      }
    }, 200);
  });
}

async function startServer() {
  if (server.child && server.child.exitCode === null) {
    log('server already running (pid ' + server.child.pid + ')');
    return;
  }
  if (server.status === 'starting') return;
  server.manualStop = false; // 新启动流程：启动失败也要能触发自动恢复

  server.stdoutTail = [];
  server.stderrTail = [];
  setServerStatus('starting');

  let cli = resolveDshCli();
  const node = resolveNode();
  if (!cli) {
    // Fresh machines only have Node.js — fetch the DSH engine via npx once.
    setServerStatus('starting', '首次运行：正在下载 DSH 引擎…（约 1-2 分钟）');
    cli = await ensureDshCli();
  }
  if (!cli) {
    setServerStatus('error', '未找到 DSH CLI（@deepseek-ai/dsh/lib/bin.js）。首次启动会自动下载，请检查网络后点「重试」；也可以在设置中指定 dshCliPath');
    return;
  }
  log(`spawning: ${node} ${cli} --profile web --host ${settings.host} --port ${settings.port}`);
  // Release any leftover listener on the port first — accumulated zombie dsh
  // processes from earlier sessions otherwise crash the fresh spawn with
  // EADDRINUSE (the recurring "dsh exited code=1" startup error).
  await releasePort(settings.port);
  await new Promise((r) => setTimeout(r, 300));
  // detached: the DSH service runs in its own process group, so restarting the
  // desktop app no longer takes the service (and the hosted session) down with it.
  const child = spawn(node, [cli, '--profile', 'web', '--host', settings.host, '--port', String(settings.port)], {
    cwd: path.dirname(cli),
    env: {
      ...process.env,
      // tell the harness which directory is the session workspace (used by the
      // dsh-workspace-tree GUI plugin to serve the file tree)
      DSH_WORKSPACE_ROOT: settings.workspaceDir || 'D:\\deepseek_harness',
    },
    windowsHide: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.unref(); // the app does not keep the service alive nor wait for it
  server.child = child;
  server.startedByUs = true;

  child.stdout.on('data', (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) if (line.trim()) { log('[dsh] ' + line); tail(server.stdoutTail, line); }
  });
  child.stderr.on('data', (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) if (line.trim()) { log('[dsh:err] ' + line); tail(server.stderrTail, line); }
  });
  child.once('error', (err) => {
    log('failed to spawn dsh: ' + err.message);
    setServerStatus('error', '启动 DSH 服务失败: ' + err.message);
  });
  child.once('exit', (code, signal) => {
    let cause = classifyCrash(code, signal);
    // watchdog 主动 kill：强制按运行期崩溃走自动恢复（避免被归为 external）
    if (server.crash.watchdogKill) {
      server.crash.watchdogKill = false;
      cause = 'runtime';
      log('[anticrash] exit follows watchdog kill — forcing recovery');
    }
    log(`dsh exited code=${code} signal=${signal} cause=${cause}`);
    server.exitCause = cause;
    if (server.status === 'starting' || server.status === 'running') {
      setServerStatus('stopped', `dsh 进程退出 (code=${code}, cause=${cause})`);
    }
    server.child = null;
    const prev = server.manualStop;
    // 手动停止（stopServer 已置位）仍由恢复调度检查；本回调只记录
    handleCrash(cause, prev);
  });

  // wait until the HTTP root answers 200 (or the child dies / timeout)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      setServerStatus('error', 'dsh 进程提前退出，详见日志');
      restartBreaker.record(false);
      return;
    }
    if (await httpProbeReady(settings.host, settings.port)) {
      server.port = settings.port;
      server.manualStop = false;
      resetCrashMeters();
      restartBreaker.record(true);
      setServerStatus('running');
      log('DSH service ready at ' + webUrl(settings.host, settings.port));
      return;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  setServerStatus('error', `等待 DSH 服务就绪超时 (${webUrl(settings.host, settings.port)})`);
}

async function ensureServer() {
  // already up? (e.g. another dsh instance is running) -> connect to it
  if (await tcpProbe(settings.host, settings.port)) {
    server.port = settings.port;
    server.startedByUs = false;
    setServerStatus('running', '连接已有服务');
    return;
  }
  if (settings.startServerOnLaunch) {
    await startServer();
  } else {
    server.port = settings.port;
    setServerStatus('stopped', 'startServerOnLaunch=false');
  }
}

// Kill whatever process listens on `port` (only dsh web / node), so a fresh
// spawn can bind. Needed when the app merely connected to an existing service
// instead of owning it (server.child is null) — a blind spawn would crash
// with EADDRINUSE.
function releasePort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], (err, stdout) => {
      if (err) { resolve(); return; }
      const pids = new Set();
      const re = new RegExp('TCP\\s+\\S*:' + port + '\\s+\\S+\\s+LISTENING\\s+(\\d+)', 'i');
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = re.exec(line);
        if (m) pids.add(m[1]);
      }
      let done = 0;
      const finish = () => { if (++done >= pids.size) resolve(); };
      if (pids.size === 0) { resolve(); return; }
      for (const pid of pids) {
        execFile('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], (err2, out2) => {
          // only terminate dsh/node listeners, never other programs
          if (!err2 && /node\.exe/i.test(String(out2))) {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => finish());
          } else {
            finish();
          }
        });
      }
    });
  });
}

// ------------------------------------------------------------- anti-crash ----
// 崩溃归因 → 指数退避自动重启 → 防风暴冷却 → 连续失败自动安全模式。
// 对应 docs/anti-crash-optimization.md 的 L1 进程守护层。

let autoRecoveryTimer = null;
let watchdogTimer = null;
let isRecovering = false;

/** 根据退出码/signal/stderr 尾部判断崩溃原因。 */
function classifyCrash(code, signal) {
  if (signal === 'SIGTERM' || signal === 'SIGKILL') return 'external'; // 外部/主动终止
  const err = server.stderrTail.join('\n').toLowerCase();
  if (/EADDRINUSE|address already in use|listen eacces/i.test(err)) return 'port_conflict';
  if (/heap out of memory|allocation failed|javascript heap|out of memory/i.test(err)) return 'oom';
  if (/(error|exception|stack)[\s\S]{0,200}/i.test(err) && /(error:|at \S+\.js|\.mjs|\.cjs)/i.test(err)) return 'plugin_crash';
  if (code !== 0) return code === null ? 'unknown' : 'runtime';
  return code === 0 ? 'clean' : 'unknown';
}

/** 记录一次崩溃（持久化到 crash-state.json，保留最近 50 条）。 */
function recordCrash(cause) {
  const now = Date.now();
  server.crash.lastCause = cause;
  server.crash.consecutive = cause === 'external' || cause === 'clean' ? 0 : server.crash.consecutive + 1;
  server.crash.recent = server.crash.recent.filter((t) => now - t < 60_000);
  if (cause !== 'external' && cause !== 'clean') server.crash.recent.push(now);
  let saved = loadCrashState();
  const list = Array.isArray(saved.crashes) ? saved.crashes : [];
  list.push({ at: new Date().toISOString(), cause, consecutive: server.crash.consecutive });
  while (list.length > 50) list.shift();
  saveCrashState({ crashes: list, safeMode: server.crash.safeMode });
  log(`[anticrash] cause=${cause} consecutive=${server.crash.consecutive} recent60=${server.crash.recent.length}`);
}

/** 手动进入安全模式（禁非核心插件，不重启；重启由调用方负责）。 */
function enterSafeMode() {
  const patchFile = path.join(app.getPath('home'), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  const backupFile = patchFile + '.backup';
  try {
    if (fs.existsSync(patchFile)) fs.copyFileSync(patchFile, backupFile);
    const content = disableNonCorePlugins(fs.readFileSync(patchFile, 'utf8'));
    fs.writeFileSync(patchFile, content);
    server.crash.safeMode = true;
    safeModeActive = true;
    saveCrashState({ safeMode: true });
    updateTray();
    log('[anticrash] safe mode activated (non-core plugins disabled)');
  } catch (e) {
    log('[anticrash] enterSafeMode failed: ' + e.message);
  }
}

/** 自动恢复调度：指数退避 + 冷却 + 自动安全模式。 */
function handleCrash(cause, wasManualStop) {
  // 手动停止/退出/非本应用启动的服务 → 先抑制再记录（不污染崩溃统计）
  if (wasManualStop || server.manualStop || isQuitting || !server.startedByUs) {
    log(`[anticrash] suppress auto-recovery (manual=${!!(wasManualStop || server.manualStop)}, quit=${isQuitting}, owned=${!!server.startedByUs})`);
    return;
  }
  recordCrash(cause);
  if (cause === 'external' || cause === 'clean') return;

  const now = Date.now();
  // 冷却期内 → 不再重启（防重启风暴）
  if (now < server.crash.cooldownUntil) {
    const left = Math.ceil((server.crash.cooldownUntil - now) / 1000);
    log(`[anticrash] cooling down (${left}s), skip auto-restart`);
    setServerStatus('error', `服务连续崩溃，冷却中（${left}s），请稍候或手动重启`);
    return;
  }
  // 60s 内 ≥3 次真实崩溃 → 冷却 + 自动安全模式（配置问题隔离）
  if (server.crash.recent.length >= 3) {
    server.crash.cooldownUntil = now + 120_000;
    log('[anticrash] >=3 crashes in 60s — entering cooldown 120s');
    if (!server.crash.safeMode && cause !== 'port_conflict') {
      enterSafeMode();
      log('[anticrash] restarting with safe mode to isolate broken plugin');
      // 延迟重启：给可能的进行中恢复流程收尾，避免 isRecovering 吞掉本次重启
      setTimeout(() => {
        if (!isRecovering) restartServer();
      }, 1500);
    } else {
      setServerStatus('error', '连续崩溃，已进入冷却（120s），请稍后重试');
    }
    return;
  }
  // 指数退避 1s/2s/4s/8s…上限 60s
  const backoffMs = Math.min(1000 * Math.pow(2, Math.max(0, server.crash.recent.length - 1)), 60_000);
  log(`[anticrash] auto-restart in ${backoffMs}ms (cause=${cause})`);
  if (autoRecoveryTimer) clearTimeout(autoRecoveryTimer);
  autoRecoveryTimer = setTimeout(() => {
    log('[anticrash] executing auto-restart');
    restartServer();
  }, backoffMs);
}

/** watchdog：服务 running 后周期性探活，僵死则 kill 触发自动恢复。 */
function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(async () => {
    if (server.status !== 'running' || !server.child || isRecovering) return;
    const ok = await httpProbeReady(settings.host, settings.port, 3000);
    if (!ok) {
      server.crash.probeFails = (server.crash.probeFails || 0) + 1;
      log(`[watchdog] probe fail ${server.crash.probeFails}/3`);
      if (server.crash.probeFails >= 3) {
        server.crash.probeFails = 0;
        log('[watchdog] service unresponsive — killing child to trigger recovery');
        try {
          server.child.kill();
          server.crash.watchdogKill = true; // kill 成功后才标记，exit 异步触发
        } catch (e) { log('[watchdog] kill failed: ' + e.message); }
      }
    } else {
      server.crash.probeFails = 0;
    }
  }, 5000);
}

// ---- P2: 熔断器 + 限流（对应 L3 依赖隔离层） ----
function createCircuitBreaker(name, { failThreshold = 0.5, requestThreshold = 5, openMs = 15_000, windowMs = 60_000 } = {}) {
  const state = { status: 'CLOSED', results: [], openedAt: 0 }; // results: [{ts, ok}]
  const slide = (now) => {
    state.results = state.results.filter((r) => now - r.ts <= windowMs);
  };
  return {
    get status() { return state.status; },
    allow() {
      if (state.status === 'OPEN') {
        if (Date.now() - state.openedAt >= openMs) { state.status = 'HALF_OPEN'; return true; }
        return false;
      }
      return true;
    },
    record(ok) {
      const now = Date.now();
      if (state.status === 'HALF_OPEN') {
        // 半开试探：成功→关闭，失败→重新断开
        state.status = ok ? 'CLOSED' : 'OPEN';
        state.openedAt = now;
        state.results = [];
        log(`[breaker] ${name} ${ok ? 'CLOSED' : 'OPEN (half-open probe failed)'}`);
        return;
      }
      slide(now);
      state.results.push({ ts: now, ok });
      const total = state.results.length;
      if (total >= requestThreshold) {
        const fails = state.results.filter((r) => !r.ok).length;
        if (fails / total >= failThreshold) {
          state.status = 'OPEN';
          state.openedAt = now;
          state.results = [];
          log(`[breaker] ${name} -> OPEN (fail=${fails}/${total})`);
        }
      }
    },
    reset() { state.status = 'CLOSED'; state.results = []; },
  };
}

function createRateLimiter(maxPerWindow, windowMs) {
  const hits = [];
  return {
    allow() {
      const now = Date.now();
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      if (hits.length >= maxPerWindow) {
        return { ok: false, reason: '操作过于频繁，请稍后再试' };
      }
      hits.push(now);
      return { ok: true };
    },
  };
}

// 自动恢复熔断器：连续重启仍失败则 OPEN，阻止无限重启
const restartBreaker = createCircuitBreaker('auto-restart', { failThreshold: 0.4, requestThreshold: 3, openMs: 60_000 });
// session-tools /restart 端点的限流：60s 内最多 3 次
const rateLimiterRestart = createRateLimiter(3, 60_000);

function resetCrashMeters() {
  server.crash.consecutive = 0;
  server.crash.recent = [];
  server.crash.probeFails = 0;
  server.manualStop = false;
}

async function restartServer() {
  log('restart requested');
  if (isRecovering) return;
  if (!restartBreaker.allow()) {
    log('[breaker] auto-restart OPEN — skipping restart, waiting for cooldown');
    setServerStatus('error', '自动恢复已熔断，请稍后手动处理');
    return;
  }
  isRecovering = true;
  try {
    backupSession('pre-restart'); // safety net: snapshot the conversation first
    await stopServer();
    await releasePort(settings.port);
    await new Promise((r) => setTimeout(r, 600));
    await startServer(); // startServer 内部记录 restartBreaker 成功/失败
    if (mainWindow && dshView && server.status === 'running') {
      dshView.webContents.loadURL(webUrl(settings.host, server.port));
    }
  } catch (e) {
    log('restart failed: ' + e.message);
    restartBreaker.record(false);
  } finally {
    isRecovering = false;
  }
}

// ----------------------------------------------------------------- window ----
let mainWindow = null;
let dshView = null;
let tray = null;
let isQuitting = false;

// The DSH GUI fills the entire window. The old right-side shell sidebar is
// gone: the workspace file tree now lives inside the GUI itself (the
// dsh-workspace-tree plugin), so nothing can obscure the conversation.
function layoutViews() {
  if (!mainWindow || !dshView) return;
  const [w, h] = mainWindow.getContentSize();
  dshView.setBounds({ x: 0, y: 0, width: w, height: h });
}

function loadingHtml() {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
         background:#151517; color:#f9fafb; font-family:"Segoe UI",system-ui,sans-serif; gap:18px; }
  .dot { width:22px; height:22px; border-radius:50%; background:#4d6bfe; animation:pulse 1.2s infinite; }
  @keyframes pulse { 0%,100%{opacity:.35; transform:scale(.9)} 50%{opacity:1; transform:scale(1.15)} }
  h1 { font-size:16px; font-weight:600; margin:0; }
  p  { font-size:13px; margin:0; color:#cfd3d6; text-align:center; max-width:520px; line-height:1.6; }
  button { margin-top:6px; padding:8px 22px; border:1px solid #4d6bfe; border-radius:6px; background:transparent;
           color:#8fa3ff; font-size:13px; cursor:pointer; }
  button:hover { background:#1c2547; }
  .err { color:#ff7b72; }
</style></head>
<body>
  <div class="dot" id="dot"></div>
  <h1 id="title">正在启动 DeepSeek Harness 服务…</h1>
  <p id="detail"></p>
  <button id="retry" style="display:none">重试</button>
  <script>
    window.dshDesktop.onServerStatus((s) => {
      const dot = document.getElementById('dot');
      const title = document.getElementById('title');
      const detail = document.getElementById('detail');
      const retry = document.getElementById('retry');
      if (s.status === 'running') {
        title.textContent = '服务已就绪，正在打开…';
        dot.style.display = 'none';
      } else if (s.status === 'error' || s.status === 'stopped') {
        title.textContent = s.status === 'error' ? '服务启动失败' : '服务未运行';
        title.className = 'err';
        detail.textContent = s.detail || '';
        retry.style.display = 'inline-block';
      } else {
        detail.textContent = s.detail ? '正在 ' + s.detail : '';
      }
    });
    document.getElementById('retry').addEventListener('click', () => {
      window.dshDesktop.retryStart();
    });
  </script>
</body></html>`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'DeepSeek Harness Desktop',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#151517',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // DSH GUI pane: an isolated WebContentsView to the right of the sidebar
  dshView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.contentView.addChildView(dshView);
  layoutViews();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', layoutViews);

  mainWindow.on('close', (e) => {
    if (!isQuitting && settings.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; dshView = null; });

  // DSH pane: external links open in the system browser
  dshView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  dshView.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(webUrl(settings.host, settings.port))) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  // window title follows the served page
  dshView.webContents.on('page-title-updated', (e, title) => {
    if (title) { e.preventDefault(); mainWindow.setTitle(title + ' — Desktop'); }
  });
  // surface GUI console errors into the desktop log for diagnostics
  dshView.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) log('[gui:' + level + '] ' + String(message).slice(0, 300));
  });

  // Ctrl+Shift+E is gone together with the desktop sidebar — the workspace
  // file tree is a GUI feature now (dsh-workspace-tree plugin, right-edge tab).

  // Window content behind the GUI view: just a dark backdrop (the view covers
  // the whole window).
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<style>html,body{margin:0;height:100%;background:#151517}</style>'));

  // DSH pane: loading page first, switch to the real URL once ready.
  dshView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml()));
  dshView.webContents.once('did-finish-load', async () => {
    await ensureServer();
    if (mainWindow && dshView && server.status === 'running') {
      dshView.webContents.loadURL(webUrl(settings.host, server.port));
    }
  });
}

// -------------------------------------------------------------------- tray ----
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-32.png'));
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function updateTray() {
  if (!tray) return;
  const statusText = {
    idle: '未启动', starting: '启动中', running: '运行中', stopped: '已停止', error: '出错',
  }[server.status] || server.status;
  tray.setToolTip(`DeepSeek Harness Desktop — 服务${statusText}${server.port ? ` (${settings.host}:${server.port})` : ''}`);
  tray.setContextMenu(buildMenu());
}


// ─── Safe Mode / Restore Mode ───
let safeModeActive = false;

function disableNonCorePlugins(content) {
  const coreIds = ['dsh-skin-switch', 'dsh-session-tools', 'dsh-persona-manager', 'dsh-memory'];
  const lines = content.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '- insert:') {
      const block = [line];
      i++;
      let id = null;
      let nameLineIndex = -1;
      let alreadyDisabled = false;
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t') || lines[i].trim() === '')) {
        block.push(lines[i]);
        const idMatch = lines[i].match(/^\s+- id:\s*(.+)$/);
        if (idMatch) id = idMatch[1].trim();
        if (lines[i].match(/^\s+name:/)) nameLineIndex = block.length - 1;
        if (/^\s+disabled:\s*true\s*$/.test(lines[i])) alreadyDisabled = true;
        i++;
      }
      // 幂等：块内已有 disabled: true 则不重复插入（YAML 重复键是脏数据）
      if (id && !coreIds.includes(id) && nameLineIndex >= 0 && !alreadyDisabled) {
        const nameLine = block[nameLineIndex];
        const indent = nameLine.match(/^(\s*)/)[1];
        block.splice(nameLineIndex + 1, 0, indent + '      disabled: true');
      }
      result.push(...block);
    } else {
      result.push(line);
      i++;
    }
  }
  return result.join('\n');
}

function handleSafeMode() {
  const patchFile = path.join(app.getPath('home'), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  const backupFile = patchFile + '.backup';
  try {
    if (fs.existsSync(patchFile)) {
      fs.copyFileSync(patchFile, backupFile);
    }
    let content = fs.readFileSync(patchFile, 'utf8');
    content = disableNonCorePlugins(content);
    fs.writeFileSync(patchFile, content);
    safeModeActive = true;
    server.crash.safeMode = true;
    saveCrashState({ safeMode: true });
    restartServer();
  } catch (e) {
    console.error('Safe mode failed:', e);
  }
}

function clearDisabledOverlay() {
  const patchFile = path.join(app.getPath('home'), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  const backupFile = patchFile + '.backup';
  try {
    if (fs.existsSync(backupFile)) {
      fs.copyFileSync(backupFile, patchFile);
    }
    safeModeActive = false;
    server.crash.safeMode = false;
    saveCrashState({ safeMode: false });
    restartServer();
  } catch (e) {
    console.error('Restore failed:', e);
  }
}

function buildMenu() {
  const url = webUrl(settings.host, server.port || settings.port);
  return Menu.buildFromTemplate([
    { label: server.status === 'running' ? '显示主窗口' : '打开主窗口', click: showMainWindow },
    { label: '在浏览器中打开', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: '重启 DSH 服务', click: () => restartServer() },
    { label: '开机自启', type: 'checkbox', checked: !!settings.autoStart, click: (item) => applyAutoStart(item.checked) },
    { type: 'separator' },
    { label: '--- 恢复工具 ---', enabled: false },
    { label: safeModeActive ? '🛡 安全模式（当前）' : '启动安全模式', enabled: !safeModeActive, click: () => handleSafeMode() },
    { label: '恢复正常模式', click: () => { clearDisabledOverlay(); restartServer(); } },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', showMainWindow);
  tray.setContextMenu(buildMenu()); // Explicitly set on creation
  tray.on('context-menu', () => {
    if (tray && tray.contextMenu) { tray.popUpContextMenu(tray.contextMenu); }
  });
  updateTray();
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function applyAutoStart(enabled) {
  settings.autoStart = enabled;
  saveSettings();
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname)],
    });
    log('auto-start ' + (enabled ? 'enabled' : 'disabled'));
  } catch (err) {
    log('setLoginItemSettings failed: ' + err.message);
  }
}

// --------------------------------------------------------------------- ipc ----
function workspaceRoot() {
  if (settings.workspaceDir && fs.existsSync(settings.workspaceDir)) return settings.workspaceDir;
  for (const c of ['D:\\deepseek_harness', path.resolve(__dirname, '..')]) {
    if (fs.existsSync(c)) return c;
  }
  return app.getPath('home');
}

function registerIpc() {
  ipcMain.handle('dsh:get-info', () => ({
    appVersion: app.getVersion(),
    serverStatus: server.status,
    serverPort: server.port,
    serverUrl: webUrl(settings.host, server.port || settings.port),
    settings,
  }));
  ipcMain.on('dsh:retry-start', () => {
    log('retry requested from renderer');
    ensureServer().then(() => {
      if (mainWindow && dshView && server.status === 'running') {
        dshView.webContents.loadURL(webUrl(settings.host, server.port));
      }
    });
  });

  ipcMain.on('dsh:log-error', (_e, msg) => {
    if (typeof msg === 'string' && msg.length < 2000) log('[page] ' + msg);
  });

  // ---- conversation safety net: backup / rollback / restore ----
  ipcMain.handle('dsh:session-backup', () => {
    const file = backupSession('manual');
    return file ? { ok: true, file } : { ok: false, error: '找不到当前会话文件' };
  });
  ipcMain.handle('dsh:session-restore', async () => restoreSession());
  ipcMain.handle('dsh:session-rollback', async () => rollbackSession());
}

// ---------------------------------------------------- conversation backups ----
function sessionBackupDir() {
  return path.join(app.getPath('userData'), 'session-backups');
}

async function restoreSession() {
  if (server.status !== 'running') {
    await startServer();
  }
  const ok = server.status === 'running';
  if (ok && dshView && !dshView.webContents.isDestroyed()) {
    dshView.webContents.reload();
  }
  return { ok, status: server.status };
}

async function rollbackSession() {
  const dir = sessionBackupDir();
  let backups = [];
  try { backups = fs.readdirSync(dir).filter((f) => f.endsWith('.zstd')).sort(); } catch { /* none yet */ }
  if (backups.length === 0) return { ok: false, error: '没有可回退的备份（先点「备份」或等自动备份）' };
  const src = findSessionFile();
  if (!src) return { ok: false, error: '找不到当前会话文件' };
  backupSession('pre-rollback'); // safety copy of the live file first
  const newest = path.join(dir, backups[backups.length - 1]);
  try {
    await stopServer();
    await releasePort(settings.port);
    fs.copyFileSync(newest, src);
    await new Promise((r) => setTimeout(r, 600));
    await startServer();
    if (dshView && !dshView.webContents.isDestroyed()) dshView.webContents.reload();
    return { ok: server.status === 'running', file: newest };
  } catch (err) {
    log('rollback failed: ' + err.message);
    return { ok: false, error: String(err.message || err) };
  }
}

// The most recently modified session store under $DSH_HOME/sessions — the
// harness writes session.jsonl.zstd per active session (append-only frames).
function findSessionFile() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const root = path.join(home, 'sessions');
  let best = null;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'session.jsonl.zstd') {
        try {
          const st = fs.statSync(full);
          if (!best || st.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: st.mtimeMs };
        } catch { /* skip */ }
      }
    }
  };
  try { walk(root); } catch { /* no sessions yet */ }
  return best ? best.path : null;
}

// Copy the live session file into userData/session-backups (keep the newest 24).
function backupSession(tag) {
  const src = findSessionFile();
  if (!src) return null;
  const dir = sessionBackupDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = tag + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zstd';
    const dst = path.join(dir, name);
    fs.copyFileSync(src, dst);
    const all = fs.readdirSync(dir).filter((f) => f.endsWith('.zstd')).sort();
    while (all.length > 24) fs.unlinkSync(path.join(dir, all.shift()));
    log('session backup -> ' + name);
    return dst;
  } catch (err) {
    log('backup failed: ' + err.message);
    return null;
  }
}

function startSessionBackup() {
  // periodic safety net + a backup before every service restart
  setInterval(() => { backupSession('auto'); }, 5 * 60 * 1000);
}

// Resolve a client-supplied path (absolute or relative) under the workspace
// root; returns null when it escapes (mirrors the GUI plugin's host check).
function resolveBridgePath(input) {
  const root = workspaceRoot();
  const rel = input && input !== '' ? (path.isAbsolute(input) ? path.relative(root, input) : input) : '';
  const abs = path.normalize(path.join(root, rel));
  const normRoot = path.normalize(root);
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null;
  return abs;
}

// Loopback-only HTTP bridge for the GUI session-tools plugin (buttons in the
// conversation header). CORS-open so the DSH page (127.0.0.1:3080) can call it.
const SESSION_TOOLS_PORT = 3090;
let sessionToolsServer = null;

function startSessionToolsServer() {
  if (sessionToolsServer) return;
  sessionToolsServer = http.createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors); res.end(); return;
    }
    const send = (obj, code = 200) => {
      res.writeHead(code, { ...cors, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://x').pathname; } catch { /* keep / */ }
    if (pathname === '/backup') {
      const file = backupSession('gui');
      send(file ? { ok: true, file } : { ok: false, error: '找不到当前会话文件' });
    } else if (pathname === '/restore') {
      restoreSession().then(send).catch((e) => send({ ok: false, error: String(e.message || e) }));
    } else if (pathname === '/rollback') {
      rollbackSession().then(send).catch((e) => send({ ok: false, error: String(e.message || e) }));
    } else if (pathname === '/open') {
      // open a workspace file/folder with its default handler (GUI file tree)
      const abs = resolveBridgePath(new URL(req.url || '/', 'http://x').searchParams.get('path') || '');
      if (!abs) { send({ ok: false, error: '路径不在工作区内' }, 403); return; }
      shell.openPath(abs).then((err) => send(err ? { ok: false, error: err } : { ok: true }));
    } else if (pathname === '/reveal') {
      // reveal a workspace path in Explorer (GUI file tree)
      const abs = resolveBridgePath(new URL(req.url || '/', 'http://x').searchParams.get('path') || '');
      if (!abs) { send({ ok: false, error: '路径不在工作区内' }, 403); return; }
      if (!fs.existsSync(abs)) { send({ ok: false, error: '路径不存在: ' + abs }); return; }
      shell.showItemInFolder(abs);
      send({ ok: true });
    } else if (pathname === '/restart') {
      // Trigger a clean DSH service restart (same as tray menu "重启 DSH 服务").
      // Rate-limited: avoid restart loops when the GUI repeatedly fires it.
      const rl = rateLimiterRestart.allow();
      if (!rl.ok) {
        send({ ok: false, error: rl.reason }, 429);
        return;
      }
      send({ ok: true, message: '正在重启 DSH 服务…' });
      setTimeout(() => restartServer(), 200);
    } else if (pathname === '/health') {
      // 三层健康探针（K8s 风格）：liveness / readiness / metrics
      const probe = new URL(req.url || '/', 'http://x').searchParams.get('probe') || 'liveness';
      if (probe === 'readiness') {
        send({ ok: server.status === 'running', status: server.status, safeMode: server.crash.safeMode });
      } else if (probe === 'metrics') {
        const mem = process.memoryUsage();
        send({
          ok: true,
          status: server.status,
          uptime: Math.round(process.uptime()),
          memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
          childAlive: !!(server.child && server.child.exitCode === null),
          crash: {
            consecutive: server.crash.consecutive,
            recent60: server.crash.recent.length,
            lastCause: server.crash.lastCause,
            safeMode: server.crash.safeMode,
            cooldownUntil: server.crash.cooldownUntil,
            breakerOpen: restartBreaker.status === 'OPEN',
          },
        });
      } else {
        // liveness：真实探活 DSH 服务（连接已有服务时 server.child 为 null，不能依赖 child 对象）
        httpProbeReady(settings.host, settings.port, 2000).then((ok) => send({ ok }));
      }
    } else if (pathname === '/dom') {
      // Diagnostic: run a read-only JS snippet in the live GUI page and return
      // the result (used to inspect the workspace-tree panel state remotely).
      const js = new URL(req.url || '/', 'http://x').searchParams.get('q') || '';
      if (!js) { send({ ok: false, error: 'missing q' }); return; }
      if (dshView && !dshView.webContents.isDestroyed()) {
        dshView.webContents.executeJavaScript(js).then((r) => send({ ok: true, result: r })).catch((e) => send({ ok: false, error: String(e && e.message || e) }));
      } else {
        send({ ok: false, error: 'no gui view' });
      }
    } else {
      send({ ok: false, error: 'not found' }, 404);
    }
  });
  sessionToolsServer.on('error', (err) => log('session-tools server error: ' + err.message));
  sessionToolsServer.listen(SESSION_TOOLS_PORT, '127.0.0.1');
  log('session-tools HTTP server on 127.0.0.1:' + SESSION_TOOLS_PORT);
}

// ---------------------------------------------------------- skin awareness ----
// Track the active skin (via the dsh-skin-manager API) so the desktop chrome —
// the right-side workspace file tree and the window background — adapts to it,
// and the GUI auto-refreshes when the skin switches.
let activeSkin = null;
let skinKnown = false;
let skinPollTimer = null;

const SKIN_WINDOW_BG = {
  'maid-atelier': '#0b1942',
};

function broadcastSkin() {
  const info = { id: activeSkin };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('dsh:skin-info', info);
  }
  if (dshView && !dshView.webContents.isDestroyed()) {
    dshView.webContents.send('dsh:skin-info', info);
  }
}

// Read the active skin row directly from the web profile's cordis.patch.yml
// (plugin-agnostic — works with the dsh-skin-switch model of pre-inserted
// `ui-skin-*` rows toggled by `disabled: true`). Returns the row id or null.
function activeSkinFromPatch() {
  try {
    const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
    const text = fs.readFileSync(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
    let currentRow = null;
    let activeId = null;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s{4}- id: (ui-skin-[\w-]+)\s*$/);
      if (m) { currentRow = m[1]; activeId = currentRow; continue; }
      if (currentRow !== null && /^\s{6}disabled:\s*true\s*$/.test(line)) { activeId = null; currentRow = null; }
    }
    return activeId;
  } catch {
    return null;
  }
}

async function pollSkin() {
  try {
    // row id (ui-skin-maid-atelier) -> skin id (maid-atelier) for the palettes
    const rowId = activeSkinFromPatch();
    const id = rowId ? rowId.replace(/^ui-skin-/, '') : null;
    if (id !== activeSkin) {
      const switched = skinKnown && id !== activeSkin; // skip auto-reload on the first poll
      activeSkin = id;
      skinKnown = true;
      log('active skin -> ' + (id || 'official'));
      broadcastSkin();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(SKIN_WINDOW_BG[id] || '#151517');
      }
      if (switched) {
        // The profile patch watcher does not reliably apply new/removed skin
        // rows through config-only HMR in this deployment, so a skin switch
        // needs a service restart for the new boot graph to take effect.
        // The service is spawned detached, so the desktop app itself keeps
        // running; the hosted session resumes from disk on the fresh boot.
        setTimeout(() => {
          log('skin switch: restarting DSH service to apply "' + (id || 'official') + '"');
          restartServer();
        }, 600);
      }
    }
  } catch { /* server not ready yet */ }
}

function startSkinPolling() {
  if (skinPollTimer) clearInterval(skinPollTimer);
  pollSkin();
  skinPollTimer = setInterval(pollSkin, 8000);
}

// ------------------------------------------------------------------- app ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    app.setAppUserModelId('ai.deepseek.harness.desktop');
    loadSettings();
    registerIpc();
    if (settings.autoStart) applyAutoStart(true); // re-assert on login items
    createWindow();
    createTray();
    startSkinPolling();
    startSessionBackup();
    startSessionToolsServer();
    // 恢复上次会话的崩溃状态（含安全模式）与熔断器
    try {
      const cs = loadCrashState();
      server.crash.safeMode = !!cs.safeMode;
      safeModeActive = !!cs.safeMode;
      server.crash.consecutive = 0;
      if (cs.crashes && cs.crashes.length > 0) {
        const last = cs.crashes[cs.crashes.length - 1];
        server.crash.lastCause = last.cause || null;
        // 仅当最近一次崩溃在 60s 内才视为"延续中的崩溃"，保守防风暴
        const lastTs = Date.parse(last.at || '');
        if (!Number.isNaN(lastTs) && Date.now() - lastTs < 60_000) {
          server.crash.consecutive = 1;
          log('[anticrash] last crash was <60s ago — will use shorter backoff');
        }
        log(`[anticrash] restored crash state: ${cs.crashes.length} crashes total, last=${server.crash.lastCause}, safeMode=${safeModeActive}`);
      }
      // 上次退出时处于安全模式 → 提示而非静默重启风暴
      if (safeModeActive) log('[anticrash] service is in SAFE MODE (restored from last session)');
    } catch (e) { log('[anticrash] restore crash state failed: ' + e.message); }
    startWatchdog(); // L1 watchdog：运行期探活 + 僵死恢复
    log(`started. userData=${app.getPath('userData')}`);
  });

  app.on('window-all-closed', () => {
    // keep running in tray on Windows (do nothing)
  });

  app.on('before-quit', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    quitApp();
  });
}

async function quitApp() {
  if (isQuitting) return;
  isQuitting = true;
  log('quitting');
  if (server.startedByUs && !settings.keepServerOnQuit) {
    await stopServer();
  }
  app.quit();
}