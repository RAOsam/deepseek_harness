// dsh-memory — host half (consumer).
// 拆分后只负责装配：暴露记忆 service、注入系统提示词、注册工具与 HTTP 路由。
// 纯数据逻辑见 ./store.js（MemoryStore：去重 / 访问追踪 / token 预算 / rank 融合）。
//
// 设计参考 ALTm 的 provider↔consumer 分离：
//   - store 扮演可替换的 longTermMemory 能力，本文件是 harness 生命周期 consumer；
//   - 通过 ctx.memory 暴露 store，其它插件可复用同一份记忆能力。
import z from '@deepseek-ai/schemastery';
import { createMemoryStore } from './store.js';

export const name = 'dsh-memory';
export const inject = ['webServer', 'systemPrompt'];

/**
 * Schemastery 配置：所有阈值可在 cordis.yml 调整，无需改代码。
 * 桌面端配置页会据此渲染数值输入项。
 */
export const Config = z.object({
  maxInject: z.number().default(20).description('注入系统提示词的最大记忆条数'),
  maxTokens: z.number().default(800).description('注入 token 预算（粗估）'),
  dedupThreshold: z.number().default(0.6).description('语义去重合并阈值（同类 Jaccard≥此值则合并，0~1）'),
  weightImportance: z.number().default(0.5).description('rank 融合中 importance 权重'),
  weightRecency: z.number().default(0.3).description('rank 融合中近期衰减权重'),
  weightFrequency: z.number().default(0.2).description('rank 融合中访问频率权重'),
  recencyHalfLifeDays: z.number().default(14).description('近期衰减半衰期（天）'),
});

const API = '/api/memories';

/** 把 store 的输出文案下发给 AI（systemPrompt）。 */
function applyMemories(ctx, store) {
  let dispose = null;
  return function refresh() {
    if (dispose) { dispose(); dispose = null; }
    const text = store.buildInjectText();
    const prompt = [
      '## 记忆系统使用规则',
      '',
      '你有一个长期记忆系统（memory_save 工具），可以跨会话保存重要信息。',
      '',
      '### 何时保存记忆',
      '当用户说出以下关键词时，立即调用 memory_save 保存：',
      '- "记住" / "记一下" / "记住这个" / "记住：xxx"',
      '- "保存这个" / "记录下来"',
      '- "以后要注意" / "以后记住"',
      '',
      '### 自动保存场景',
      '即使用户没有明确要求，当对话中出现以下内容时也应主动保存：',
      '- 用户的个人偏好（习惯、设置、工作方式）',
      '- 重要的系统配置或架构决策',
      '- 遇到的问题和解决方案',
      '- 用户明确的规则或约束',
      '',
      '### 保存格式要求',
      '- 内容要简洁、完整、自解释',
      '- 选择合适的分类：preference(偏好) / fact(信息) / event(事件) / rule(规则) / context(背景)',
      '- 重要性 1-10：关键规则用 9-10，一般偏好用 5-7',
      '- 添加标签便于后续检索',
      '',
      '### 不要保存的内容',
      '- 临时的调试信息',
      '- 一次性的代码片段',
      '- 对话过程中的过渡性内容',
      '',
      text ? '## 当前记忆\n' + text : '',
    ].filter(Boolean).join('\n');
    dispose = ctx.systemPrompt.context({ name: 'memory:inject', order: 1, text: prompt });
  };
}

export function apply(ctx, config = {}) {
  const store = createMemoryStore(config);
  // 暴露为可复用 service（参考 ALTm 的 ctx.longTermMemory 模式）。
  // ctx.memory = store;

  const refreshInject = applyMemories(ctx, store);
  refreshInject();

  // ─────────────────────────────────────── 工具注册 ──
  ctx.effect(() => {
    const harness = ctx.get('harness');
    if (!harness) return;

    // memory_save：去重优先——同类高相似度则合并，否则新建。
    harness.registerTool(ctx, {
      name: 'memory_save',
      description: '保存一条重要信息到长期记忆（跨会话持久化）。触发条件：用户说"记住"、"记一下"、"保存这个"、"记录下来"时立即调用；或发现用户偏好、系统配置、问题解决方案、行为规则时主动调用。同类已有高相似度记忆时会自动合并。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '需要记住的信息内容' },
          category: { type: 'string', enum: ['preference', 'fact', 'event', 'rule', 'context'], description: 'preference=偏好习惯, fact=个人信息, event=重要事件, rule=行为规则, context=上下文背景' },
          importance: { type: 'number', description: '重要性 1-10，默认 5' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表（可选）' },
        },
        required: ['content'],
      },
      execute: async (args) => {
        const res = store.saveMemory({
          content: args.content,
          category: args.category || 'fact',
          importance: args.importance,
          tags: args.tags || [],
          source: 'ai',
        });
        refreshInject();
        if (res.action === 'merged') {
          return { ok: true, action: 'merged', message: '检测到相似记忆已合并: ' + String(args.content).substring(0, 60), similarity: res.similarity, id: res.memory?.id };
        }
        return { ok: true, action: 'created', message: '已保存到长期记忆: ' + String(args.content).substring(0, 80), id: res.memory?.id };
      },
    });

    // memory_search：rank 融合排序 + 访问 touch。
    harness.registerTool(ctx, {
      name: 'memory_search',
      description: '搜索长期记忆中关于用户的信息。需回忆用户偏好、历史信息、规则等时调用。结果按重要性×近期×频率融合排序。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          category: { type: 'string', enum: ['preference', 'fact', 'event', 'rule', 'context', ''], description: '按分类筛选，留空搜索全部' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const results = store.search(args.query, args.category || '', 10);
        if (results.length === 0) return { ok: true, message: '未找到相关记忆' };
        const lines = results.map(m =>
          '- [' + (store.categories[m.category] || m.category) + '] ' + m.content
          + ' (重要性:' + m.importance + ', 访问:' + (m.accessCount || 0) + ')');
        return { ok: true, message: '找到 ' + results.length + ' 条记忆:\n' + lines.join('\n') };
      },
    });

    // memory_consolidate：整理去重，清理冗余条目。
    harness.registerTool(ctx, {
      name: 'memory_consolidate',
      description: '整理长期记忆：合并同类近重复条目、删除冗余。当记忆库条目过多或发现明显重复时调用。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const res = store.consolidate();
        refreshInject();
        return { ok: true, message: '整理完成：' + res.before + ' → ' + res.after + ' 条（合并 ' + res.merged + ' 条冗余）' };
      },
    });

    return () => {};
  }, name + ': tools');

  // ─────────────────────────────────────── HTTP 路由 ──
  ctx.effect(() => {
    const ws = ctx.get('webServer');
    if (!ws) return;
    const disposers = [];
    const register = (routePath, handler) => disposers.push(ws.register({ kind: 'exact', path: routePath, handler }));

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
      req.on('data', c => { body += c; });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    });

    // GET /api/memories — 列表（向后兼容）
    register(API, (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ok: true, memories: store.list(), categories: store.categories });
    });

    // GET /api/memories/search?q=&category= — 检索（新增）
    register(API + '/search', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const u = new URL(req.url || '/', 'http://x');
      const results = store.search(u.searchParams.get('q') || '', u.searchParams.get('category') || '', 50);
      sendJson(res, 200, { ok: true, memories: results });
    });

    // POST /api/memories/create — 创建（经去重）
    register(API + '/create', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then(body => {
        if (!body) { sendJson(res, 400, { ok: false, error: 'invalid body' }); return; }
        const res2 = store.saveMemory({
          content: body.content, category: body.category || 'fact',
          importance: body.importance, tags: body.tags || [], source: 'manual',
        });
        refreshInject();
        sendJson(res, 200, { ok: true, memory: res2.memory, action: res2.action });
      });
    });

    // PUT /api/memories/update?id=xxx — 更新
    register(API + '/update', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'PUT') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      if (!id) { sendJson(res, 400, { ok: false, error: 'missing id' }); return; }
      parseBody(req).then(body => {
        if (!body) { sendJson(res, 400, { ok: false, error: 'invalid body' }); return; }
        const m = store.update(id, body);
        if (!m) { sendJson(res, 404, { ok: false, error: 'memory not found' }); return; }
        refreshInject();
        sendJson(res, 200, { ok: true, memory: m });
      });
    });

    // DELETE /api/memories/delete?id=xxx — 删除
    register(API + '/delete', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'DELETE') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      if (!id) { sendJson(res, 400, { ok: false, error: 'missing id' }); return; }
      const ok = store.remove(id);
      if (!ok) { sendJson(res, 404, { ok: false, error: 'memory not found' }); return; }
      refreshInject();
      sendJson(res, 200, { ok: true });
    });

    // POST /api/memories/consolidate — 整理去重（新增）
    register(API + '/consolidate', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const r = store.consolidateApply();
      refreshInject();
      sendJson(res, 200, { ok: true, ...r });
    });

    // GET /api/memories/consolidate/preview — 预览待合并项
    register(API + '/consolidate/preview', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const candidates = store.consolidatePreview();
      sendJson(res, 200, { ok: true, candidates });
    });

    // POST /api/memories/vision — 图片识别（调用 DashScope 视觉模型）
    register(API + '/vision', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then(async (body) => {
        if (!body || !body.image) { sendJson(res, 400, { ok: false, error: 'missing image' }); return; }
        try {
          const { existsSync, readFileSync } = await import('node:fs');
          const { join } = await import('node:path');
          const cfgPath = join(process.env.USERPROFILE || process.env.HOME || '', '.modlens', 'config.json');
          let cfg = {};
          if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch {} }
          const provider = cfg.providers?.['openai-compat'];
          if (!provider?.baseUrl || !provider?.apiKey) {
            sendJson(res, 500, { ok: false, error: 'modlens config missing' }); return;
          }
          const mime = body.mime || 'image/png';
          const resp = await fetch(provider.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey },
            body: JSON.stringify({
              model: provider.model || 'qwen-vl-plus',
              messages: [{ role: 'user', content: [
                { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + body.image } },
                { type: 'text', text: '请详细描述这张图片的内容，包括文字、物体、布局等所有可见信息。用中文回答。' }
              ] }],
              max_tokens: 1024,
            }),
          });
          const data = await resp.json();
          const text = data.choices?.[0]?.message?.content || '';
          if (!text) { sendJson(res, 500, { ok: false, error: 'empty response', raw: JSON.stringify(data).slice(0, 200) }); return; }
          sendJson(res, 200, { ok: true, text });
        } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      });
    });

    return () => { for (const d of disposers) d(); };
  }, name + ': routes');
}
