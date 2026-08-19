// dsh-memory — host half.
// 记忆存储 + HTTP API + 系统提示词注入（让 AI 记住用户信息）。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const API = '/api/memories';
const MAX_INJECT = 20;    // 最多注入的记忆条数
const MAX_CHARS = 3000;   // 注入文本最大字符数

export const name = 'dsh-memory';
export const inject = ['webServer', 'systemPrompt'];

function memoriesFile() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  return join(home, 'memories.json');
}

function createMemoryStore() {
  let memories = [];
  let categories = {
    preference: '偏好习惯',
    fact: '个人信息',
    event: '重要事件',
    rule: '行为规则',
    context: '上下文背景',
  };

  function load() {
    const file = memoriesFile();
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        memories = Array.isArray(data.memories) ? data.memories : [];
        if (data.categories) categories = { ...categories, ...data.categories };
      }
    } catch { /* ignore */ }
  }

  function save() {
    const file = memoriesFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ memories, categories }, null, 2), 'utf8');
  }

  load();
  save();

  return {
    get memories() { return memories; },
    get categories() { return categories; },
    load,
    save,
    generateId() { return 'm-' + Date.now().toString(36); },
    // 按重要性降序，截断到最大字符数，生成注入文本
    buildInjectText() {
      const sorted = [...memories].sort((a, b) => (b.importance || 5) - (a.importance || 5));
      const lines = [];
      let total = 0;
      for (const m of sorted) {
        const line = `- [${categories[m.category] || m.category}] ${m.content}`;
        if (total + line.length > MAX_CHARS) break;
        lines.push(line);
        total += line.length;
        if (lines.length >= MAX_INJECT) break;
      }
      return lines.length > 0
        ? '以下是关于用户的长期记忆，请在回答时参考：\n' + lines.join('\n')
        : '';
    },
  };
}

export function apply(ctx) {
  const store = createMemoryStore();

  // 注入记忆到系统提示词
  let disposeContext = null;
  function applyMemories() {
    if (disposeContext) { disposeContext(); disposeContext = null; }
    const text = store.buildInjectText();
    if (text) {
      disposeContext = ctx.systemPrompt.context({
        name: 'memory:inject',
        order: 1,
        text,
      });
    }
  }
  applyMemories();

  // 注册 memory_save 工具——AI 在对话中主动保存值得记住的信息
  ctx.effect(() => {
    const harness = ctx.get('harness');
    if (!harness) return;
    return harness.registerTool(ctx, {
      name: 'memory_save',
      description: '保存一条关于用户的重要信息到长期记忆。在对话中发现用户偏好、个人信息、重要事件、行为规则时主动调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '需要记住的信息内容' },
          category: { type: 'string', enum: ['preference', 'fact', 'event', 'rule', 'context'], description: '分类：preference=偏好习惯, fact=个人信息, event=重要事件, rule=行为规则, context=上下文背景' },
          importance: { type: 'number', description: '重要性 1-10，默认 5' },
        },
        required: ['content'],
      },
      execute: async (args) => {
        const memory = {
          id: store.generateId(),
          content: args.content,
          category: args.category || 'fact',
          importance: Math.max(1, Math.min(10, Number(args.importance) || 5)),
          tags: [],
          source: 'ai',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.memories.push(memory);
        store.save();
        applyMemories();
        return { ok: true, message: '已保存到长期记忆: ' + args.content.substring(0, 80) };
      },
    });
  }, 'memory-save tool');

  // 注册 memory_search 工具——AI 搜索已有记忆
  ctx.effect(() => {
    const harness = ctx.get('harness');
    if (!harness) return;
    return harness.registerTool(ctx, {
      name: 'memory_search',
      description: '搜索长期记忆中关于用户的信息。当需要回忆用户偏好、历史信息、规则等时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          category: { type: 'string', enum: ['preference', 'fact', 'event', 'rule', 'context', ''], description: '按分类筛选，留空搜索全部' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const q = (args.query || '').toLowerCase();
        const cat = args.category || '';
        let results = store.memories.filter((m) => {
          if (cat && m.category !== cat) return false;
          return m.content.toLowerCase().includes(q) ||
            (m.tags || []).some((t) => t.toLowerCase().includes(q));
        });
        results.sort((a, b) => (b.importance || 5) - (a.importance || 5));
        results = results.slice(0, 10);
        if (results.length === 0) return { ok: true, message: '未找到相关记忆' };
        const lines = results.map((m) => `- [${store.categories[m.category] || m.category}] ${m.content} (重要性:${m.importance})`);
        return { ok: true, message: '找到 ' + results.length + ' 条记忆:\n' + lines.join('\n') };
      },
    });
  }, 'memory-search tool');

  // HTTP API 路由
  ctx.effect(() => {
    const ws = ctx.get('webServer');
    if (!ws) return;
    const disposers = [];
    const register = (routePath, handler) => {
      disposers.push(ws.register({ kind: 'exact', path: routePath, handler }));
    };
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    };
    const sendJson = (res, code, obj) => {
      res.writeHead(code, { ...cors, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    const sendOptions = (res) => { res.writeHead(204, cors); res.end(); };
    const parseBody = (req) => new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });

    // GET /api/memories — list
    register(API, (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ok: true, memories: store.memories, categories: store.categories });
    });

    // POST /api/memories/create — create
    register(API + '/create', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then((body) => {
        if (!body) { sendJson(res, 400, { ok: false, error: 'invalid body' }); return; }
        const memory = {
          id: store.generateId(),
          content: body.content,
          category: body.category || 'fact',
          importance: Math.max(1, Math.min(10, Number(body.importance) || 5)),
          tags: Array.isArray(body.tags) ? body.tags : [],
          source: 'manual',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.memories.push(memory);
        store.save();
        applyMemories();
        sendJson(res, 200, { ok: true, memory });
      });
    });

    // PUT /api/memories/update?id=xxx — update
    register(API + '/update', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'PUT') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      const memory = id ? store.memories.find((m) => m.id === id) : null;
      if (!memory) { sendJson(res, 404, { ok: false, error: 'memory not found' }); return; }
      parseBody(req).then((body) => {
        if (!body) { sendJson(res, 400, { ok: false, error: 'invalid body' }); return; }
        if (body.content !== undefined) memory.content = body.content;
        if (body.category !== undefined) memory.category = body.category;
        if (body.importance !== undefined) memory.importance = Math.max(1, Math.min(10, Number(body.importance)));
        if (body.tags !== undefined) memory.tags = Array.isArray(body.tags) ? body.tags : memory.tags;
        memory.updatedAt = new Date().toISOString();
        store.save();
        applyMemories();
        sendJson(res, 200, { ok: true, memory });
      });
    });

    // DELETE /api/memories/delete?id=xxx — delete
    register(API + '/delete', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'DELETE') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      if (!id) { sendJson(res, 400, { ok: false, error: 'missing id' }); return; }
      const idx = store.memories.findIndex((m) => m.id === id);
      if (idx < 0) { sendJson(res, 404, { ok: false, error: 'memory not found' }); return; }
      store.memories.splice(idx, 1);
      store.save();
      applyMemories();
      sendJson(res, 200, { ok: true });
    });

    return () => { for (const d of disposers) d(); };
  }, name + ': routes');
}
