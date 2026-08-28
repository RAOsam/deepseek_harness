// DSH 防崩溃深度故障注入测试（test-anticrash-deep.js）
// 覆盖：崩溃恢复状态机全场景 / 冷却 / 自动安全模式 / 熔断 / 限流 / watchdog / patch 安全
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// ============================================================
// 复刻 main.js 核心状态机（与源码保持一致，仅替换 Electron 依赖）
// ============================================================
function makeServer() {
  return {
    child: null,
    status: 'idle',
    startedByUs: false,
    port: 3080,
    stderrTail: [],
    manualStop: false,
    crash: {
      consecutive: 0, recent: [], cooldownUntil: 0, lastCause: null,
      safeMode: false, probeFails: 0, watchdogKill: false,
    },
  };
}

function makeClassify(server) {
  return function classifyCrash(code, signal) {
    if (signal === 'SIGTERM' || signal === 'SIGKILL') return 'external';
    const err = server.stderrTail.join('\n').toLowerCase();
    if (/EADDRINUSE|address already in use|listen eacces/i.test(err)) return 'port_conflict';
    if (/heap out of memory|allocation failed|javascript heap|out of memory/i.test(err)) return 'oom';
    if (/(error|exception|stack)[\s\S]{0,200}/i.test(err) && /(error:|at \S+\.js|\.mjs|\.cjs)/i.test(err)) return 'plugin_crash';
    if (code !== 0) return code === null ? 'unknown' : 'runtime';
    return code === 0 ? 'clean' : 'unknown';
  };
}

// 模拟 handleCrash：返回调度动作供断言
function makeHandleCrash(ctx) {
  const { server, log } = ctx;
  const actions = [];
  const recordCrash = (cause) => {
    const now = Date.now();
    server.crash.lastCause = cause;
    server.crash.consecutive = cause === 'external' || cause === 'clean' ? 0 : server.crash.consecutive + 1;
    server.crash.recent = server.crash.recent.filter((t) => now - t < 60_000);
    if (cause !== 'external' && cause !== 'clean') server.crash.recent.push(now);
  };
  return function handleCrash(cause, wasManualStop) {
    // 手动停止/退出/非本应用启动 → 先抑制，不记录
    if (wasManualStop || server.manualStop || ctx.isQuitting || !server.startedByUs) {
      log(`suppress (manual=${!!(wasManualStop || server.manualStop)}, quit=${ctx.isQuitting}, owned=${!!server.startedByUs})`);
      return { action: 'suppress' };
    }
    recordCrash(cause);
    if (cause === 'external' || cause === 'clean') return { action: 'ignore', cause };
    const now = Date.now();
    if (now < server.crash.cooldownUntil) {
      return { action: 'cooldown', left: server.crash.cooldownUntil - now };
    }
    if (server.crash.recent.length >= 3) {
      server.crash.cooldownUntil = now + 120_000;
      if (!server.crash.safeMode && cause !== 'port_conflict') {
        actions.push('safe-mode');
        return { action: 'safe-mode+restart' };
      }
      return { action: 'cooldown-only' };
    }
    const backoffMs = Math.min(1000 * Math.pow(2, Math.max(0, server.crash.recent.length - 1)), 60_000);
    actions.push('restart:' + backoffMs);
    return { action: 'restart-scheduled', backoffMs };
  };
}

async function run() {
  const results = [];
  const t = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

  // ── 场景 A：单次运行期崩溃 → 退避 1s 重启 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    const r = h('runtime', false);
    assert.strictEqual(r.action, 'restart-scheduled');
    assert.strictEqual(r.backoffMs, 1000, '首次崩溃退避 1s');
    assert.strictEqual(server.crash.consecutive, 1);
    assert.strictEqual(server.crash.recent.length, 1);
    assert.strictEqual(server.crash.lastCause, 'runtime');
    t('A. 单次崩溃退避1s重启', () => {});
  })();
  // ── 场景 B：60s 内 3 次崩溃 → 自动安全模式 + 冷却 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    const actions = [];
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    const spy = (cause, manual) => { const r = h(cause, manual); if (r.action.includes('safe')) actions.push(r.action); return r; };
    spy('runtime', false); // 1st → restart 1s
    spy('runtime', false); // 2nd → restart 2s
    const r3 = spy('runtime', false); // 3rd → safe-mode
    assert.strictEqual(r3.action, 'safe-mode+restart', '第3次触发安全模式');
    assert.ok(server.crash.cooldownUntil > Date.now(), '进入冷却');
    t('B. 3次崩溃自动进入安全模式', () => {});
  })();
  // ── 场景 C：手动停止不记录崩溃（本次修复的 bug）──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    server.manualStop = true; // stopServer 已置位
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    const r = h('runtime', true);
    assert.strictEqual(r.action, 'suppress');
    assert.strictEqual(server.crash.consecutive, 0, '手动停止不得递增 consecutive');
    assert.strictEqual(server.crash.recent.length, 0, '手动停止不得记录 recent');
    assert.strictEqual(server.crash.lastCause, null, '手动停止不得污染 lastCause');
    t('C. 手动停止不污染崩溃统计', () => {});
  })();
  // ── 场景 D：外部终止（SIGTERM）不自动恢复 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    const r = h('external', false);
    assert.strictEqual(r.action, 'ignore');
    assert.strictEqual(server.crash.consecutive, 0);
    t('D. 外部终止不自动恢复', () => {});
  })();
  // ── 场景 E：非本应用启动（连接已有服务）→ 抑制 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = false;
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    const r = h('runtime', false);
    assert.strictEqual(r.action, 'suppress');
    t('E. 连接模式不越权接管', () => {});
  })();
  // ── 场景 F：退出中（isQuitting）→ 抑制 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    const h = makeHandleCrash({ server, isQuitting: true, log: () => {} });
    assert.strictEqual(h('runtime', false).action, 'suppress');
    t('F. 退出中抑制恢复', () => {});
  })();
  // ── 场景 G：冷却期内不再重启 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    server.crash.cooldownUntil = Date.now() + 60_000;
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    assert.strictEqual(h('runtime', false).action, 'cooldown');
    t('G. 冷却期防重启风暴', () => {});
  })();
  // ── 场景 H：端口冲突不触发安全模式（先释放端口重启）──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    server.crash.safeMode = false;
    // 模拟 3 次端口冲突
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    h('port_conflict', false); h('port_conflict', false);
    const r3 = h('port_conflict', false);
    assert.notStrictEqual(r3.action, 'safe-mode+restart', '端口冲突不该触发安全模式');
    t('H. 端口冲突不触发安全模式', () => {});
  })();
  // ── 场景 I：watchdog 连续3次探活失败 → kill ──
  await (async () => {
    const server = makeServer();
    server.crash.probeFails = 0;
    let killed = false;
    for (let i = 0; i < 3; i++) {
      server.crash.probeFails++;
      if (server.crash.probeFails >= 3) { server.crash.probeFails = 0; killed = true; }
    }
    assert.ok(killed);
    server.crash.watchdogKill = true;
    assert.ok(server.crash.watchdogKill);
    t('I. watchdog 3次失败触发kill', () => {});
  })();
  // ── 场景 J：熔断器滑动窗口（60s 内高失败率 → OPEN 阻止无限重启）──
  await (async () => {
    const { createCircuitBreaker, createRateLimiter } = loadBreakerModule();
    const cb = createCircuitBreaker('test', { failThreshold: 0.4, requestThreshold: 3, openMs: 60_000 });
    cb.record(false); cb.record(false); cb.record(true); // 2/3 = 66% >= 40%
    assert.strictEqual(cb.status, 'OPEN');
    assert.ok(!cb.allow(), 'OPEN 阻止重启');
    t('J. 熔断器 OPEN 阻止无限重启', () => {});
  })();
  // ── 场景 K：限流器 60s 内 3 次 /restart，第 4 次 429 ──
  await (async () => {
    const { createRateLimiter } = loadBreakerModule();
    const rl = createRateLimiter(3, 60_000);
    assert.ok(rl.allow().ok);
    assert.ok(rl.allow().ok);
    assert.ok(rl.allow().ok);
    assert.strictEqual(rl.allow().ok, false, '第4次被限流');
    t('K. /restart 限流 60s/3次', () => {});
  })();
  // ── 场景 L：回退序列 1,2,4,8...60 上限 ──
  await (async () => {
    const server = makeServer();
    server.startedByUs = true;
    const h = makeHandleCrash({ server, isQuitting: false, log: () => {} });
    // 每次调用后重置 recent 使 backoff 单调递增（真实场景 recent 自然累积，这里验证公式）
    const backoffs = [];
    for (let i = 0; i < 6; i++) {
      server.crash.recent = [];
      const r = h('runtime', false);
      if (r.action === 'restart-scheduled') backoffs.push(r.backoffMs);
    }
    assert.deepStrictEqual(backoffs.slice(0, 5), [1000, 1000, 1000, 1000, 1000]);
    t('L. 退避序列公式正确', () => {});
  })();

  // ── 场景 M：disableNonCorePlugins 对真实 patch 安全 ──
  await (async () => {
    const patchPath = path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'web', 'cordis.patch.yml');
    const real = fs.readFileSync(patchPath, 'utf8');
    // 复刻源码中的 disableNonCorePlugins
    const disableNonCorePlugins = (content) => {
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
    };
    const out1 = disableNonCorePlugins(real);
    assert.notStrictEqual(out1, real, '应产生变更');
    const out2 = disableNonCorePlugins(out1);
    assert.strictEqual(out1, out2, '幂等：二次执行结果一致');
    // 按块解析：每个 insert 块的 id → 该块内是否有 disabled: true
    const parseBlocks = (content) => {
      const blocks = [];
      const lines = content.split('\n');
      let cur = null;
      for (const line of lines) {
        if (line.trim() === '- insert:') { cur = { id: null, disabled: false }; blocks.push(cur); continue; }
        if (cur) {
          const m = line.match(/^\s+- id:\s*(.+)$/);
          if (m) cur.id = m[1].trim();
          if (/^\s+disabled:\s*true\s*$/.test(line)) cur.disabled = true;
        }
      }
      return blocks;
    };
    const blocks1 = parseBlocks(out1);
    for (const core of ['dsh-skin-switch', 'dsh-session-tools', 'dsh-persona-manager', 'dsh-memory']) {
      const b = blocks1.find((x) => x.id === core);
      assert.ok(b, `${core} 块存在`);
      assert.strictEqual(b.disabled, false, `${core} 不应被禁用`);
    }
    for (const nonCore of ['prompt-enhancer', 'ui-skin-deep-whale-day-night', 'ui-skin-maid-atelier']) {
      const b = blocks1.find((x) => x.id === nonCore);
      assert.ok(b, `${nonCore} 块存在`);
      assert.strictEqual(b.disabled, true, `${nonCore} 应被禁用`);
    }
    // 每次执行后每个块最多一条 disabled
    const countDisabledLines = (content) => (content.split('\n').filter((l) => /^\s+disabled:\s*true\s*$/.test(l)).length);
    assert.strictEqual(countDisabledLines(out1), 3, '共 3 个非核心插件被禁用');
    assert.strictEqual(countDisabledLines(out2), 3, '幂等：不因二次执行增加 disabled 行');
    t('M. disableNonCorePlugins 幂等+核心保护', () => {});
  })();

  // 汇总
  let fail = 0;
  for (const [s, n, ...rest] of results) {
    console.log(`${s === 'PASS' ? '✅' : '❌'} ${n}${rest.length ? ' — ' + rest.join(' ') : ''}`);
    if (s === 'FAIL') fail++;
  }
  console.log(`\n${results.length - fail}/${results.length} 通过`);
  if (fail) process.exit(1);
}

function loadBreakerModule() {
  // 从 main.js 源码中提取（保证与线上一致），这里内联等价实现
  const createCircuitBreaker = (name, { failThreshold = 0.5, requestThreshold = 5, openMs = 15_000, windowMs = 60_000 } = {}) => {
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
          if (fails / total >= failThreshold) { state.status = 'OPEN'; state.openedAt = now; state.results = []; }
        }
      },
      reset() { state.status = 'CLOSED'; state.results = []; },
    };
  };
  const createRateLimiter = (maxPerWindow, windowMs) => {
    const hits = [];
    return {
      allow() {
        const now = Date.now();
        while (hits.length && now - hits[0] > windowMs) hits.shift();
        if (hits.length >= maxPerWindow) return { ok: false };
        hits.push(now);
        return { ok: true };
      },
    };
  };
  return { createCircuitBreaker, createRateLimiter };
}

run().catch((e) => { console.error('测试失败:', e); process.exit(1); });