// deepseek-balance — DeepSeek 余额监控与用量统计插件（服务端半边）
//
// 提供 /dsb/api/* 路由：
//   GET  /dsb/api/balance   查询官方余额（DEEPSEEK_API_KEY 只在服务端使用，绝不下发浏览器），
//                           成功后把快照写入本地历史，返回 balance + stats + topUpUrl
//   GET  /dsb/api/state     轻量状态：缓存余额 + 用量统计 + 配置（不触发官方 API）
//   POST /dsb/api/config    写入配置 { enabled, refreshSec }
//   GET  /dsb/api/topup     302 跳转官方充值页（platform.deepseek.com/top_up）
//
// 状态持久化在 $DSH_HOME/deepseek-balance.json（默认 ~/.dsh/deepseek-balance.json）。
// 官方余额接口文档：https://api-docs.deepseek.com/zh-cn/api/get-user-balance/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { credentialRef } from '@deepseek-ai/dsh-credentials';

const name = 'deepseek-balance';
const inject = ['webServer', 'credentials'];

const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const TOP_UP_URL = 'https://platform.deepseek.com/top_up';
const FETCH_TIMEOUT_MS = 12000;
const MIN_FETCH_GAP_MS = 30000; // 两次真实调用官方 API 的最短间隔（服务端节流）
const MAX_SNAPSHOTS = 20000;

function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}
function stateFile() {
  return join(dshHome(), 'deepseek-balance.json');
}

const DEFAULT_STATE = { config: { enabled: true, refreshSec: 60, popPos: null }, snapshots: [] };

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), 'utf8'));
    return {
      config: { ...DEFAULT_STATE.config, ...(parsed && typeof parsed.config === 'object' ? parsed.config : {}) },
      snapshots: Array.isArray(parsed?.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return { config: { ...DEFAULT_STATE.config }, snapshots: [] };
  }
}

async function writeState(state, logger) {
  try {
    await mkdir(dshHome(), { recursive: true });
    await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    (logger || console).warn('[deepseek-balance] 保存状态失败: ' + err.message);
  }
}

function normalizeBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  const primary = infos[0] || {};
  return {
    isAvailable: payload?.is_available !== false,
    currency: primary.currency || 'CNY',
    total: Number(primary.total_balance ?? 0),
    toppedUp: Number(primary.topped_up_balance ?? 0),
    granted: Number(primary.granted_balance ?? 0),
  };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeStats(snapshots) {
  const byDay = new Map();
  for (const s of snapshots) {
    const k = dayKey(s.ts);
    const list = byDay.get(k);
    if (list) list.push(s);
    else byDay.set(k, [s]);
  }
  // 单日消耗 = 相邻快照间所有「下降」之和。
  // 用「首末差」会在余额中途充值、或当日回到原值时把消耗抹平；只累加下降段可避免。
  // 同日少于 2 条快照无法判断，返回 null，与「确实没消耗」区分开。
  const daySpend = (day) => {
    const list = byDay.get(day);
    if (!list || list.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].total - list[i - 1].total;
      if (delta < 0) sum += -delta;
    }
    return sum;
  };
  const spendOrZero = (day) => daySpend(day) ?? 0;
  const now = Date.now();
  const days = [...byDay.keys()].sort();
  const today = dayKey(now);
  const weekStart = now - 7 * 86400000;
  const weekDays = days.filter((d) => new Date(`${d}T00:00:00`).getTime() >= weekStart);
  // 累计消耗同样按下降段累加，不受充值影响
  let totalSpent = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const delta = snapshots[i].total - snapshots[i - 1].total;
    if (delta < 0) totalSpent += -delta;
  }
  const first = snapshots.length ? snapshots[0] : null;
  return {
    todaySpend: daySpend(today),
    weekSpend: weekDays.reduce((sum, d) => sum + spendOrZero(d), 0),
    history: days.slice(-7).map((d) => ({ day: d, spend: daySpend(d) })),
    sinceInstallSpend: snapshots.length >= 2 ? totalSpent : null,
    snapshotCount: snapshots.length,
    since: first ? first.ts : null,
  };
}

function apply(ctx) {
  let cache = null; // { at, balance } | { at, error }
  let inflight = null;
  const logger = ctx.logger;

  async function statsOf() {
    const state = await readState();
    return computeStats(state.snapshots);
  }

  async function refresh(force) {
    if (inflight) return inflight;
    if (!force && cache && Date.now() - cache.at < MIN_FETCH_GAP_MS) return cache;
    inflight = (async () => {
      try {
        const hit = await ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'));
        if (!hit || !hit.value) {
          const error = new Error('未配置 DEEPSEEK_API_KEY：请在 设置 → 模型 页或 ~/.dsh/.credentials.yaml 中配置');
          error.code = 'NO_API_KEY';
          cache = { at: Date.now(), error };
          return cache;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let payload;
        try {
          const res = await fetch(BALANCE_URL, {
            headers: { Authorization: `Bearer ${hit.value}`, Accept: 'application/json' },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`官方接口返回 ${res.status} ${res.statusText}`);
          payload = await res.json();
        } finally {
          clearTimeout(timer);
        }
        const balance = normalizeBalance(payload);
        const state = await readState();
        state.snapshots.push({ ts: Date.now(), ...balance });
        if (state.snapshots.length > MAX_SNAPSHOTS) {
          state.snapshots.splice(0, state.snapshots.length - MAX_SNAPSHOTS);
        }
        await writeState(state, logger);
        cache = { at: Date.now(), balance };
        return cache;
      } catch (err) {
        logger.warn('[deepseek-balance] 余额查询失败: ' + (err?.message || err));
        cache = { at: Date.now(), error: err instanceof Error ? err : new Error(String(err)) };
        return cache;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  const register = (path, handler) => {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }), `deepseek-balance: ${path}`);
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  register('/dsb/api/balance', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method not allowed' });
    const result = await refresh(true);
    if (result.error) {
      return send(res, result.error.code === 'NO_API_KEY' ? 200 : 502, {
        ok: false,
        code: result.error.code || 'FETCH_FAILED',
        error: result.error.message,
        balance: null,
        stats: await statsOf(),
        topUpUrl: TOP_UP_URL,
      });
    }
    // 一次 readState 同时取 stats 与 config（避免重复读 1.8MB 状态文件）
    const state = await readState();
    return send(res, 200, { ok: true, balance: result.balance, stats: computeStats(state.snapshots), config: state.config, topUpUrl: TOP_UP_URL });
  });

  register('/dsb/api/state', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ok: false, error: 'method not allowed' });
    const state = await readState();
    return send(res, 200, {
      ok: true,
      config: state.config,
      topUpUrl: TOP_UP_URL,
      cachedAt: cache ? cache.at : null,
      balance: cache && !cache.error ? cache.balance : null,
      lastError: cache && cache.error ? { message: cache.error.message, code: cache.error.code || 'FETCH_FAILED' } : null,
      stats: await statsOf(),
    });
  });

  register('/dsb/api/config', async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let patch;
    try {
      patch = JSON.parse(raw || '{}');
    } catch {
      return send(res, 400, { ok: false, error: 'bad json' });
    }
    const state = await readState();
    const next = { ...state.config };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.refreshSec === 'number' && patch.refreshSec >= 10 && patch.refreshSec <= 3600) {
      next.refreshSec = Math.round(patch.refreshSec);
    }
    // 余额弹窗拖动位置；null 表示恢复自动定位
    if (patch.popPos === null) {
      next.popPos = null;
    } else if (patch.popPos && typeof patch.popPos === "object"
      && Number.isFinite(patch.popPos.left) && Number.isFinite(patch.popPos.top)) {
      next.popPos = { left: Math.round(patch.popPos.left), top: Math.round(patch.popPos.top) };
    }
    state.config = next;
    await writeState(state, logger);
    return send(res, 200, { ok: true, config: next });
  });

  register('/dsb/api/topup', (req, res) => {
    res.writeHead(302, { location: TOP_UP_URL });
    res.end();
  });
}

export { apply, inject, name, TOP_UP_URL };
