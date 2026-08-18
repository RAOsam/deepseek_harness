// deepseek-balance server-half smoke test (run: node test/smoke.mjs from the plugin dir)
// Uses a mocked cordis ctx + mocked fetch to exercise apply() end to end.
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../lib/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'dsb-test-'));
process.env.DSH_HOME = tmp;

const routes = new Map();
const calls = { balance: 0 };

const ctx = {
  logger: { warn: (...a) => console.warn('[mock]', ...a) },
  credentials: {
    resolve: async () => ({ value: 'sk-test-key', source: 'file' }),
  },
  webServer: {
    register: (route) => {
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  },
  effect: (cb) => cb(),
};

apply(ctx);

console.log('registered routes:', [...routes.keys()].join(', '));

globalThis.fetch = async (url, init) => {
  calls.balance++;
  if (url !== 'https://api.deepseek.com/user/balance') throw new Error('unexpected url ' + url);
  if (!/Bearer sk-test-key/.test(init.headers.Authorization)) throw new Error('bad auth');
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
    }),
  };
};

function fakeReq(method) {
  const req = { method };
  req[Symbol.asyncIterator] = async function* () {};
  return req;
}
function fakeRes() {
  const res = { status: 0, headers: null, body: '' };
  res.writeHead = (s, h) => { res.status = s; res.headers = h; };
  res.end = (b) => { res.body = b; };
  return res;
}

// 1) balance route
{
  const res = fakeRes();
  await routes.get('/dsb/api/balance')(fakeReq('GET'), res);
  const data = JSON.parse(res.body);
  console.log('balance route:', res.status, 'ok=', data.ok, 'total=', data.balance.total, 'today=', data.stats.todaySpend);
  if (!data.ok || data.balance.total !== 110) throw new Error('balance route failed');
}

// 2) state route (cached)
{
  const res = fakeRes();
  await routes.get('/dsb/api/state')(fakeReq('GET'), res);
  const data = JSON.parse(res.body);
  console.log('state route:', res.status, 'ok=', data.ok, 'snapshots=', data.stats.snapshotCount, 'cachedAt=', !!data.cachedAt);
  if (!data.ok || data.stats.snapshotCount !== 1) throw new Error('state route failed');
}

// 3) config route (POST)
{
  const res = fakeRes();
  const req = fakeReq('POST');
  req[Symbol.asyncIterator] = async function* () { yield JSON.stringify({ refreshSec: 120 }); };
  await routes.get('/dsb/api/config')(req, res);
  const data = JSON.parse(res.body);
  console.log('config route:', res.status, 'ok=', data.ok, 'refreshSec=', data.config.refreshSec);
  if (!data.ok || data.config.refreshSec !== 120) throw new Error('config route failed');
}

// 4) topup route
{
  const res = fakeRes();
  await routes.get('/dsb/api/topup')(fakeReq('GET'), res);
  console.log('topup route:', res.status, 'location=', res.headers.location);
  if (res.status !== 302 || !/platform\.deepseek\.com\/top_up/.test(res.headers.location)) throw new Error('topup route failed');
}

// 5) no-api-key path: mutate credentials to return undefined, reset cache by touching a new fetch
{
  ctx.credentials.resolve = async () => undefined;
  globalThis.fetch = async () => { calls.balance++; throw new Error('should not be called'); };
  const res = fakeRes();
  await routes.get('/dsb/api/balance')(fakeReq('GET'), res);
  const data = JSON.parse(res.body);
  console.log('no-key route:', res.status, 'ok=', data.ok, 'code=', data.code);
  if (data.ok !== false || data.code !== 'NO_API_KEY') throw new Error('no-key path failed');
}

console.log('ALL SMOKE TESTS PASSED (fetch calls:', calls.balance + ')');
rmSync(tmp, { recursive: true, force: true });
