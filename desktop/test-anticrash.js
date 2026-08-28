// DSH 防崩溃核心逻辑单元测试（node test-anticrash.js）
// 从 desktop/main.js 中提取纯函数逻辑进行行为验证，不启动 Electron。
'use strict';

const assert = require('node:assert');

// ---------- 从 main.js 复制的最小实现（保持逻辑一致） ----------
function classifyCrash(code, signal, stderrTail) {
  if (signal === 'SIGTERM' || signal === 'SIGKILL') return 'external';
  const err = (stderrTail || []).join('\n').toLowerCase();
  if (/EADDRINUSE|address already in use|listen eacces/i.test(err)) return 'port_conflict';
  if (/heap out of memory|allocation failed|javascript heap|out of memory/i.test(err)) return 'oom';
  if (/(error|exception|stack)[\s\S]{0,200}/i.test(err) && /(error:|at \S+\.js|\.mjs|\.cjs)/i.test(err)) return 'plugin_crash';
  if (code !== 0) return code === null ? 'unknown' : 'runtime';
  return code === 0 ? 'clean' : 'unknown';
}

function createCircuitBreaker(name, { failThreshold = 0.5, requestThreshold = 5, openMs = 15_000, windowMs = 60_000 } = {}) {
  const state = { status: 'CLOSED', results: [], openedAt: 0 };
  const slide = (now) => { state.results = state.results.filter((r) => now - r.ts <= windowMs); };
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
        state.status = ok ? 'CLOSED' : 'OPEN';
        state.openedAt = now;
        state.results = [];
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
      if (hits.length >= maxPerWindow) return { ok: false, reason: 'rate limited' };
      hits.push(now);
      return { ok: true };
    },
  };
}

// ---------- 测试 1: 崩溃归因 ----------
console.log('--- 崩溃归因 ---');
assert.strictEqual(classifyCrash(1, null, ['Error: listen EADDRINUSE: address already in use 127.0.0.1:3080']), 'port_conflict', 'EADDRINUSE 归因');
assert.strictEqual(classifyCrash(1, null, ['FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory']), 'oom', 'OOM 归因');
assert.strictEqual(classifyCrash(1, null, ['Error: Cannot find module', '  at Object.<anonymous> (C:\\plugins\\x\\index.js:12:5)']), 'plugin_crash', '插件崩溃归因');
assert.strictEqual(classifyCrash(0, 'SIGTERM', []), 'external', 'SIGTERM 归因 external');
assert.strictEqual(classifyCrash(0, null, []), 'clean', '正常退出 clean');
assert.strictEqual(classifyCrash(3, null, []), 'runtime', '非零退出 runtime');
console.log('✅ 崩溃归因 6/6 通过');

// ---------- 测试 2: 熔断器 ----------
console.log('--- 熔断器 ---');
const cb = createCircuitBreaker('test', { failThreshold: 0.5, requestThreshold: 4, openMs: 50 });
// 正常状态放行
assert.strictEqual(cb.status, 'CLOSED');
assert.ok(cb.allow(), 'CLOSED 放行');
// 4 次中 3 次失败 → 失败率 75% >= 50%，开
for (let i = 0; i < 3; i++) cb.record(false);
assert.strictEqual(cb.status, 'CLOSED', '未达阈值仍 CLOSED（4 次后才判定）');
cb.record(true);
assert.strictEqual(cb.status, 'OPEN', '4 次请求失败率 75% → OPEN');
assert.ok(!cb.allow(), 'OPEN 快速失败');

async function run() {
// 等待 openMs 后进入半开
await new Promise((r) => setTimeout(r, 60));
const halfOpen = cb.allow();
assert.ok(halfOpen, 'OPEN 超时后半开放行一个试探');
assert.strictEqual(cb.status, 'HALF_OPEN');
// 半开成功 → 回 CLOSED
cb.record(true);
assert.strictEqual(cb.status, 'CLOSED', '半开成功回 CLOSED');
console.log('✅ 熔断器状态机通过');

// ---------- 测试 3: 限流器 ----------
console.log('--- 限流器 ---');
const rl = createRateLimiter(3, 100);
assert.ok(rl.allow().ok);
assert.ok(rl.allow().ok);
assert.ok(rl.allow().ok);
assert.strictEqual(rl.allow().ok, false, '第 4 次拒绝');
await new Promise((r) => setTimeout(r, 110));
assert.ok(rl.allow().ok, '窗口过期后放行');
console.log('✅ 限流器通过');

// ---------- 测试 4: watchdog 探活逻辑（模拟） ----------
console.log('--- watchdog 模拟 ---');
let probeFails = 0;
let killed = false;
async function watchdogTick(probeResult) {
  if (probeResult) { probeFails = 0; return; }
  probeFails++;
  if (probeFails >= 3) {
    probeFails = 0;
    killed = true; // 模拟 child.kill()
  }
}
await watchdogTick(true);
assert.strictEqual(probeFails, 0, '健康探针复位');
await watchdogTick(false); await watchdogTick(false); await watchdogTick(false);
assert.ok(killed, '连续 3 次失败触发 kill');
console.log('✅ watchdog 探活逻辑通过');

console.log('\n全部通过 ✅');
}

run().catch((e) => { console.error('测试失败:', e); process.exit(1); });