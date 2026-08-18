// Robust Electron binary downloader: multi-mirror, resumable (Range), progress
// output, automatic retry. No child processes. Run: node scripts/dl-electron.js [version]
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const pkg = require('../node_modules/electron/package.json');
const version = process.argv[2] || pkg.version;
const tag = version.startsWith('v') ? version : 'v' + version;
const file = `electron-${tag}-win32-x64.zip`;
const dest = path.join(__dirname, '..', '.electron-cache', file);

const MIRRORS = [
  `https://github.com/electron/electron/releases/download/${tag}/${file}`,
  `https://npmmirror.com/mirrors/electron/${tag}/${file}`,
];

function get(url, headers, redirects) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('too many redirects'));
        return resolve(get(new URL(res.headers.location, url).href, headers, redirects + 1));
      }
      if (res.statusCode === 416) { res.resume(); return reject(new Error('RANGE_416')); }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(mirror) {
  const existing = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  const headers = { 'User-Agent': 'dsh-desktop' };
  if (existing > 0) headers.Range = `bytes=${existing}-`;
  console.log(`[dl] ${mirror.split('/')[2]} resume=${existing}`);
  const res = await get(mirror, headers, 0);
  const append = res.statusCode === 206;
  const ws = fs.createWriteStream(dest, { flags: append ? 'a' : 'w' });
  let since = Date.now();
  res.on('data', (c) => { ws.write(c); });
  res.on('end', () => ws.end());
  await new Promise((resolve, reject) => {
    ws.on('finish', resolve);
    ws.on('error', reject);
    res.on('error', reject);
  });
  const size = fs.statSync(dest).size;
  console.log(`[dl] chunk done, file now ${(size / 1048576).toFixed(1)} MB`);
  return size;
}

(async () => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let round = 0; round < 8; round++) {
    for (const mirror of MIRRORS) {
      try {
        const size = await attempt(mirror);
        if (size > 100 * 1024 * 1024) { // >100MB: plausibly complete
          console.log('[dl] COMPLETE ' + dest);
          process.exit(0);
        }
      } catch (e) {
        console.log(`[dl] ${mirror.split('/')[2]} failed: ${e.message}`);
        if (e.message === 'RANGE_416') {
          try { fs.unlinkSync(dest); console.log('[dl] range rejected, restarting file'); } catch { /* ignore */ }
        }
      }
      await sleep(1500);
    }
  }
  console.error('DL_FAIL: gave up after retries');
  process.exit(1);
})();
