// dsh-workspace-tree — host half.
// Serves workspace directory listing + file read for the GUI file tree:
//   GET /api/workspace-tree/root   -> { root }
//   GET /api/workspace-tree/list?path=<rel> -> { dirs, files } under the root
//   GET /api/workspace-tree/read?path=<rel> -> { content } (text preview)
// The root comes from DSH_WORKSPACE_ROOT (the desktop shell passes it) or a
// fallback; paths are resolved RELATIVE to the root and cannot escape it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, sep, normalize, relative, isAbsolute, dirname, basename } from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const name = 'dsh-workspace-tree';
export const inject = ['webServer'];
const API = '/api/workspace-tree';
const PREVIEW_MAX = 20000;

function workspaceRoot() {
  return process.env.DSH_WORKSPACE_ROOT
    || process.env.WORKSPACE_DIR
    || join(os.homedir(), 'Desktop');
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(obj));
}

// Resolve a client-supplied path (may be absolute or relative) under the root.
// Returns null when it escapes the workspace.
function resolveUnderRoot(root, input) {
  const rel = input && input !== '' ? (isAbsolute(input) ? relative(root, input) : input) : '';
  const abs = normalize(join(root, rel));
  if (abs !== normalize(root) && !abs.startsWith(normalize(root) + sep)) return null;
  return { abs, rel };
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = [];
    const register = (path, handler) => {
      disposers.push(ctx.webServer.register({ kind: 'exact', path, handler }));
    };

    register(API + '/root', (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ok: true, root: workspaceRoot() });
    });

    // Return the installed @deepseek-ai/dsh version so the client can compare
    // it with the npm registry and show an update notification.
    register(API + '/version', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      let version = '0.0.0';
      // Strategy 1: read from package.json at known paths
      const candidates = [join(process.cwd(), 'package.json')];
      if (process.argv[1]) {
        candidates.unshift(join(dirname(process.argv[1]), '..', 'package.json'));
        candidates.unshift(join(dirname(process.argv[1]), 'package.json'));
      }
      for (const p of candidates) {
        try { const v = JSON.parse(readFileSync(p, 'utf8')).version; if (v) { version = v; break; } } catch { /* next */ }
      }
      // Strategy 2: spawn dsh --version
      if (version === '0.0.0' && process.argv[1]) {
        try {
          const { execFileSync } = await import('node:child_process');
          const out = execFileSync(process.execPath, [process.argv[1], '--version'],
            { timeout: 8000, windowsHide: true, encoding: 'utf8' }).trim();
          if (out) version = out.split('\n').pop().trim();
        } catch { /* give up */ }
      }
      sendJson(res, 200, { ok: true, version });
    });

    // Fetch the latest version + changelog from npm / GitHub releases.
    register(API + '/update-info', async (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      try {
        // 1) npm latest version + readme (full packument has readme)
        const regRes = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', {
          headers: { 'Accept': 'application/json' },
        });
        const full = await regRes.json();
        const latest = full['dist-tags']?.latest || null;
        const readme = full.readme || '';

        // 2) changelog: try GitHub releases (tags may be v0.x or dsh-v0.x)
        let changelog = '';
        for (const tag of ['dsh-v' + latest, 'v' + latest]) {
          try {
            const ghRes = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/' + encodeURIComponent(tag), {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'dsh-update-check' },
            });
            if (ghRes.ok) { const rel = await ghRes.json(); changelog = rel.body || ''; if (changelog) break; }
          } catch { /* try next tag */ }
        }

        // 3) fallback: extract changelog section from npm readme
        if (!changelog && readme) {
          const match = readme.match(/(?:##\s*(?:Changelog|What'?s?\s*New|更新日志|更新内容|Release\s*Notes?)[\s\S]*?)(?=\n##\s|$)/i);
          changelog = match ? match[0].trim() : '';
          // if still empty, try "## v" version header sections
          if (!changelog) {
            const verMatch = readme.match(new RegExp('##\\s*v?' + (latest || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?(?=\\n##\\s|$)', 'i'));
            changelog = verMatch ? verMatch[0].trim() : '';
          }
        }

        // 4) last resort: first ## section of the readme as release notes
        if (!changelog && readme) {
          const first = readme.match(/\n##\s+.+[\s\S]*?(?=\n##\s|$)/);
          changelog = first ? first[0].trim().slice(0, 2000) : '';
        }

        sendJson(res, 200, { ok: true, latest, changelog: changelog.slice(0, 4000) });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    // Execute a DSH update: installs the latest @deepseek-ai/dsh into the
    // npx cache directory that the DSH service was launched from. After the
    // update, the user restarts the DSH service to load the new version.
    register(API + '/update', (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      // Walk up from the running CLI to find the npx hash root (node_modules parent)
      const cliPath = process.argv[1] || '';
      let cacheRoot = '';
      if (cliPath) {
        let d = dirname(cliPath);
        for (let i = 0; i < 8; i++) {
          if (basename(d) === 'node_modules' && existsSync(join(dirname(d), 'package.json'))) {
            cacheRoot = dirname(d); break;
          }
          d = dirname(d);
        }
      }
      if (!cacheRoot) {
        sendJson(res, 500, { ok: false, error: '无法定位 npx 缓存目录（' + cliPath + '）' }); return;
      }
      const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      const args = [npmCli, 'install', '@deepseek-ai/dsh@latest', '--save', '--legacy-peer-deps'];

      execFile(process.execPath, args, { timeout: 300_000, windowsHide: true, cwd: cacheRoot }, (error, stdout, stderr) => {
        if (error) {
          sendJson(res, 500, { ok: false, error: error.message, stdout: (stdout || '').slice(-600), stderr: (stderr || '').slice(-600) });
        } else {
          let newVer = '?';
          try { newVer = JSON.parse(readFileSync(join(cacheRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version || '?'; } catch {}
          sendJson(res, 200, { ok: true, version: newVer });
        }
      });
    });

    register(API + '/list', (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const root = workspaceRoot();
      let url;
      try { url = new URL(req.url ?? '/', 'http://x'); } catch { sendJson(res, 400, { ok: false, error: 'bad url' }); return; }
      const target = resolveUnderRoot(root, url.searchParams.get('path') ?? '');
      if (!target) { sendJson(res, 403, { ok: false, error: 'outside workspace' }); return; }
      try {
        const entries = readdirSync(target.abs, { withFileTypes: true });
        const dirs = [], files = [];
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const rel = target.rel ? join(target.rel, e.name) : e.name;
          if (e.isDirectory()) dirs.push({ name: e.name, rel });
          else if (e.isFile()) {
            try { files.push({ name: e.name, rel, size: statSync(join(target.abs, e.name)).size }); } catch { /* skip */ }
          }
        }
        dirs.sort((a, b) => a.name.localeCompare(b.name));
        files.sort((a, b) => a.name.localeCompare(b.name));
        sendJson(res, 200, { ok: true, root, path: target.abs, dirs, files });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    register(API + '/read', (req, res) => {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const root = workspaceRoot();
      let url;
      try { url = new URL(req.url ?? '/', 'http://x'); } catch { sendJson(res, 400, { ok: false, error: 'bad url' }); return; }
      const target = resolveUnderRoot(root, url.searchParams.get('path') ?? '');
      if (!target) { sendJson(res, 403, { ok: false, error: 'outside workspace' }); return; }
      try {
        const content = readFileSync(target.abs, 'utf8');
        sendJson(res, 200, { ok: true, path: target.rel, content: content.slice(0, PREVIEW_MAX), truncated: content.length > PREVIEW_MAX });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    return () => { for (const d of disposers) d(); };
  }, name + ': routes');
}
