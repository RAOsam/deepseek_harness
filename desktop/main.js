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

// ------------------------------------------------------------ crash report ----
// Real-time stderr parser: extracts the failing plugin name from DSH error
// output and writes crash-report.json. The watchdog reads this file to
// identify which plugin to disable — no log parsing needed.

function crashReportPath() {
  return path.join(app.getPath('userData'), 'crash-report.json');
}

function disabledOverlayPath() {
  return path.join(app.getPath('userData'), 'disabled-by-watchdog.yml');
}

// Parse a single stderr line for a plugin name involved in a loader failure.
function parsePluginFromLine(line) {
  // Pattern 1: "failed to apply loader entry <name>"
  const m1 = line.match(/failed to apply loader entry\s+(\S+)/);
  if (m1) return m1[1];
  // Pattern 2: "Cannot find package ... imported from .../<plugin>/lib/index.js"
  const m2 = line.match(/imported from\s+[^\s]*node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)[/\\]/);
  if (m2) return m2[1].replace(/\\/g, '/');
  // Pattern 3: "failed to load: ... <plugin-name>"
  const m3 = line.match(/plugin tree failed to load.*?(\S+plugin\S+)/i);
  if (m3) return m3[1];
  return null;
}

// Append a crash report to disk (last-write wins for the same plugin).
function writeCrashReport(plugin, errorLine) {
  try {
    const report = { plugin, error: errorLine.slice(0, 300), timestamp: Date.now() };
    fs.writeFileSync(crashReportPath(), JSON.stringify(report, null, 2), 'utf8');
    log(`crash-report written: plugin=${plugin}`);
  } catch { /* never crash the app for logging */ }
}

// Read the latest crash report (returns null if absent or stale > 60s).
function readCrashReport() {
  try {
    const raw = fs.readFileSync(crashReportPath(), 'utf8');
    const report = JSON.parse(raw);
    if (report.timestamp && Date.now() - report.timestamp < 60_000) return report;
  } catch { /* ignore */ }
  return null;
}

// Clear the crash report (after successful recovery).
function clearCrashReport() {
  try { fs.unlinkSync(crashReportPath()); } catch { /* ignore */ }
}

// Add a plugin to the disabled overlay (does NOT touch cordis.patch.yml).
function disablePluginInOverlay(pluginName, reason) {
  const file = disabledOverlayPath();
  const ts = new Date().toISOString();
  try {
    // Read existing entries to avoid duplicates
    const existing = fs.readFileSync(file, 'utf8');
    if (existing.includes(`id: ${pluginName}`)) return; // already disabled
    const append = `\n- id: ${pluginName}\n  disabled: true\n  # disabled-by-watchdog: ${reason}\n  # disabled-at: ${ts}\n`;
    fs.writeFileSync(file, existing + append, 'utf8');
  } catch {
    // File doesn't exist yet
    const header = '# Disabled by watchdog — auto-generated, safe to delete.\n# To re-enable a plugin, remove its entry and restart.\n';
    const content = header + `\n- id: ${pluginName}\n  disabled: true\n  # disabled-by-watchdog: ${reason}\n  # disabled-at: ${ts}\n`;
    fs.writeFileSync(file, content, 'utf8');
  }
  log(`watchdog disabled plugin: ${pluginName} (${reason})`);
}

// Read the disabled overlay file path for --patch flag.
function getPatchArgs() {
  const file = disabledOverlayPath();
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 10) {
      return ['--patch', file];
    }
  } catch { /* ignore */ }
  return [];
}

// --------------------------------------------- watchdog ----
const WATCHDOG = {
  COOLDOWN_MS: 30_000,       // startup grace: only check process alive
  INTERVAL_MS: 10_000,       // health check interval
  MAX_FAILURES: 3,           // consecutive failures before safe mode
  SAFE_MODE_PLUGINS: [       // plugins to KEEP in safe mode (all others disabled)
    'pwsh-sandbox',
    '@deepseek-ai/dsh-skin-switch',
    '@dsh-external/dsh-client-ui-skin-maid-atelier',
    'dsh-session-tools',
  ],
};

let watchdogTimer = null;
let watchdogState = 'idle';  // idle | cooldown | healthy | recovering | safe-mode
let consecutiveFailures = 0;
let serviceStartTime = 0;

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(async () => {
    // Only monitor services we spawned
    if (!server.startedByUs || !server.child) {
      watchdogState = 'idle';
      return;
    }
    if (server.status !== 'running' && server.status !== 'starting') return;

    const uptime = Date.now() - serviceStartTime;

    // Phase 1: cooldown — only check if process is alive
    if (uptime < WATCHDOG.COOLDOWN_MS) {
      watchdogState = 'cooldown';
      if (server.child.exitCode !== null) {
        log('watchdog: process died during cooldown');
        watchdogState = 'recovering';
        handleCrash();
      }
      return;
    }

    // Phase 2: health check via HTTP
    watchdogState = 'healthy';
    const alive = await httpProbeReady(settings.host, settings.port, 3000);
    if (!alive) {
      consecutiveFailures++;
      log(`watchdog: health check failed (${consecutiveFailures}/${WATCHDOG.MAX_FAILURES})`);
      if (consecutiveFailures >= WATCHDOG.MAX_FAILURES) {
        watchdogState = 'safe-mode';
        handleSafeMode();
      } else {
        watchdogState = 'recovering';
        handleCrash();
      }
    } else {
      if (consecutiveFailures > 0) log('watchdog: service recovered');
      consecutiveFailures = 0;
      watchdogState = 'healthy';
    }
  }, WATCHDOG.INTERVAL_MS);
}

function stopWatchdog() {
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  watchdogState = 'idle';
}

async function handleCrash() {
  const report = readCrashReport();
  if (report && report.plugin) {
    log(`watchdog: crash-report identifies plugin "${report.plugin}"`);
    disablePluginInOverlay(report.plugin, report.error);
  } else {
    log('watchdog: no specific plugin identified, restarting without disabling');
  }
  clearCrashReport();
  consecutiveFailures++;
  await restartServer();
}

async function handleSafeMode() {
  log('watchdog: entering safe mode — disabling all custom plugins');
  // Disable every plugin not in the safe-mode keep list
  try {
    const patchFile = path.join(app.getPath('home'), '.dsh', 'profiles', 'web', 'cordis.patch.yml');
    const text = fs.readFileSync(patchFile, 'utf8');
    const nameMatches = [...text.matchAll(/name:\s*['"]?([^'"\s,\]]+)/g)];
    for (const m of nameMatches) {
      const name = m[1];
      if (!WATCHDOG.SAFE_MODE_PLUGINS.includes(name)) {
        disablePluginInOverlay(name, 'safe mode');
      }
    }
  } catch (err) {
    log('watchdog: failed to parse patch for safe mode: ' + err.message);
  }
  clearCrashReport();
  consecutiveFailures = 0;
  await restartServer();
}

// Pre-flight validation: check that every insert-row plugin exists and has a
// valid package.json. Returns an array of error strings (empty = OK).
function preflightCheck() {
  const errors = [];
  const home = app.getPath('home');
  const patchFile = path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml');
  const nmDirs = [
    path.join(home, '.dsh', 'profiles', 'node_modules'),
    path.join(home, '.dsh', 'profiles', 'web', 'node_modules'),
  ];
  try {
    const text = fs.readFileSync(patchFile, 'utf8');
    // Extract plugin names from insert rows (name: 'xxx' or name: "xxx")
    const nameMatches = [...text.matchAll(/name:\s*['"]([^'"]+)['"]/g)];
    for (const m of nameMatches) {
      const name = m[1];
      let found = false;
      for (const nm of nmDirs) {
        const pkgPath = path.join(nm, name, 'package.json');
        if (fs.existsSync(pkgPath)) {
          found = true;
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (!pkg.type || pkg.type !== 'module') {
              errors.push(`${name}: 缺少 "type":"module"（DSH 要求 ES 模块）`);
            }
            if (!pkg.exports) {
              errors.push(`${name}: 缺少 exports 配置`);
            }
          } catch (e) {
            errors.push(`${name}: package.json 解析失败: ${e.message}`);
          }
          break;
        }
      }
      if (!found) {
        errors.push(`${name}: 在 node_modules 中找不到`);
      }
    }
  } catch (err) {
    errors.push(`读取 cordis.patch.yml 失败: ${err.message}`);
  }
  return errors;
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
};

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
  const spawnArgs = [cli, '--profile', 'web', '--host', settings.host, '--port', String(settings.port)];
  // Add --patch overlay for watchdog-disabled plugins (never touches patch.yml)
  spawnArgs.push(...getPatchArgs());
  log(`spawning: ${node} ${spawnArgs.join(' ')}`);
  // Release any leftover listener on the port first — accumulated zombie dsh
  // processes from earlier sessions otherwise crash the fresh spawn with
  // EADDRINUSE (the recurring "dsh exited code=1" startup error).
  await releasePort(settings.port);
  await new Promise((r) => setTimeout(r, 300));
  // detached: the DSH service runs in its own process group, so restarting the
  // desktop app no longer takes the service (and the hosted session) down with it.
  const child = spawn(node, spawnArgs, {
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
  serviceStartTime = Date.now(); // watchdog cooldown baseline

  child.stdout.on('data', (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) if (line.trim()) { log('[dsh] ' + line); tail(server.stdoutTail, line); }
  });
  child.stderr.on('data', (buf) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      log('[dsh:err] ' + line);
      tail(server.stderrTail, line);
      // Real-time crash reporter: extract failing plugin name
      const plugin = parsePluginFromLine(line);
      if (plugin) writeCrashReport(plugin, line);
    }
  });
  child.once('error', (err) => {
    log('failed to spawn dsh: ' + err.message);
    setServerStatus('error', '启动 DSH 服务失败: ' + err.message);
  });
  child.once('exit', (code, signal) => {
    log(`dsh exited code=${code} signal=${signal}`);
    if (server.status === 'starting' || server.status === 'running') {
      setServerStatus('stopped', `dsh 进程退出 (code=${code})`);
    }
    server.child = null;
  });

  // wait until the HTTP root answers 200 (or the child dies / timeout)
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      setServerStatus('error', 'dsh 进程提前退出，详见日志');
      return;
    }
    if (await httpProbeReady(settings.host, settings.port)) {
      server.port = settings.port;
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

async function restartServer() {
  // Pre-flight validation: catch config errors before they crash the service
  const errors = preflightCheck();
  if (errors.length > 0) {
    const msg = '预检失败，未重启：\n' + errors.join('\n');
    log('preflight failed: ' + errors.join('; '));
    setServerStatus('error', msg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh:server-status', { status: 'error', detail: msg });
    }
    return;
  }
  log('restart requested');
  backupSession('pre-restart'); // safety net: snapshot the conversation first
  clearCrashReport(); // fresh start
  await stopServer();
  await releasePort(settings.port);
  await new Promise((r) => setTimeout(r, 600));
  await startServer();
  if (mainWindow && dshView && server.status === 'running') {
    dshView.webContents.loadURL(webUrl(settings.host, server.port));
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
  p  { font-size:13px; margin:0; color:#cfd3d6; text-align:center; max-width:520px; line-height:1.6; white-space:pre-wrap; }
  button { margin-top:6px; padding:8px 22px; border:1px solid #4d6bfe; border-radius:6px; background:transparent;
           color:#8fa3ff; font-size:13px; cursor:pointer; }
  button:hover { background:#1c2547; }
  .err { color:#ff7b72; }
  .warn { color:#e8c88a; }
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
        title.className = '';
        dot.style.display = 'none';
      } else if (s.status === 'error' || s.status === 'stopped') {
        const d = s.detail || '';
        if (d.includes('已自动禁用')) {
          title.textContent = '⚠ 插件导致崩溃，已自动禁用';
          title.className = 'warn';
        } else if (d.includes('安全模式')) {
          title.textContent = '🛡 安全模式';
          title.className = 'warn';
        } else {
          title.textContent = s.status === 'error' ? '服务启动失败' : '服务未运行';
          title.className = 'err';
        }
        detail.textContent = d;
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

function buildMenu() {
  const url = webUrl(settings.host, server.port || settings.port);
  return Menu.buildFromTemplate([
    { label: server.status === 'running' ? '显示主窗口' : '打开主窗口', click: showMainWindow },
    { label: '在浏览器中打开', click: () => shell.openExternal(url) },
    { type: 'separator' },
    { label: '重启 DSH 服务', click: () => restartServer() },
    { label: '开机自启', type: 'checkbox', checked: !!settings.autoStart, click: (item) => applyAutoStart(item.checked) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', showMainWindow);
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
      // Returns immediately; the restart runs asynchronously in the main process.
      send({ ok: true, message: '正在重启 DSH 服务…' });
      setTimeout(() => restartServer(), 200);
    } else if (pathname === '/health') {
      send({ ok: true });
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
    startWatchdog(); // crash recovery + safe mode
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
  stopWatchdog();
  if (server.startedByUs && !settings.keepServerOnQuit) {
    await stopServer();
  }
  app.quit();
}
