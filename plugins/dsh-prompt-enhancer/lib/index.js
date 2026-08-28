import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-prompt-enhancer';
export const inject = ['webServer'];

const DEFAULT_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export function apply(ctx) {
  let defaultApiKey = '';
  try {
    const cfgPath = join(process.env.USERPROFILE || process.env.HOME || '', '.modlens', 'config.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      defaultApiKey = cfg.providers?.['openai-compat']?.apiKey || '';
    }
  } catch {}

  ctx.effect(() => {
    const ws = ctx.get('webServer');
    if (!ws) return;
    const disposers = [];
    const register = (routePath, handler) => disposers.push(ws.register({ kind: 'exact', path: routePath, handler }));

    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
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

    // POST /api/prompt-enhance — 增强
    register('/api/prompt-enhance', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then(async (body) => {
        if (!body || !body.draft) { sendJson(res, 400, { ok: false, error: 'missing draft' }); return; }
        const { draft, mode = 'standard', model = 'qwen-turbo', endpoint, apiKey } = body;
        const ep = endpoint || DEFAULT_ENDPOINT;
        const key = apiKey || defaultApiKey;
        if (!key) { sendJson(res, 500, { ok: false, error: 'API Key not configured' }); return; }
        try {
          const systemPrompt = getEnhancePrompt(mode);
          const response = await fetch(ep + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: '请优化以下提示词：\n\n' + draft },
              ],
              temperature: 0.7,
              max_tokens: 2000,
            }),
          });
          const data = await response.json();
          const enhanced = data.choices?.[0]?.message?.content || '';
          if (!enhanced) { sendJson(res, 500, { ok: false, error: 'empty response' }); return; }
          sendJson(res, 200, { ok: true, enhanced, mode, model });
        } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      });
    });

    // POST /api/prompt-enhance/test — 测试模型
    register('/api/prompt-enhance/test', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then(async (body) => {
        const { model = 'qwen-turbo', endpoint, apiKey } = body || {};
        const ep = endpoint || DEFAULT_ENDPOINT;
        const key = apiKey || defaultApiKey;
        if (!key) { sendJson(res, 200, { ok: false, error: 'API Key not configured' }); return; }
        try {
          const start = Date.now();
          const response = await fetch(ep + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
          });
          const data = await response.json();
          const ms = Date.now() - start;
          if (data.choices?.[0]?.message?.content) {
            sendJson(res, 200, { ok: true, model, ms });
          } else {
            sendJson(res, 200, { ok: false, error: 'empty response' });
          }
        } catch (e) { sendJson(res, 200, { ok: false, error: e.message }); }
      });
    });


    // POST /api/safe-mode — 安全模式/恢复模式
    register('/api/safe-mode', (req, res) => {
      if (req.method === 'OPTIONS') return sendOptions(res);
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then(async (body) => {
        const action = body?.action;
        if (action !== 'safe' && action !== 'restore') {
          sendJson(res, 400, { ok: false, error: 'action must be safe or restore' }); return;
        }
        try {
          const { existsSync, readFileSync, writeFileSync, copyFileSync } = await import('node:fs');
          const dshHome = join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
          const patchFile = join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
          const backupFile = patchFile + '.backup';
          if (!existsSync(patchFile)) {
            sendJson(res, 500, { ok: false, error: 'cordis.patch.yml not found' }); return;
          }
          if (action === 'safe') {
            // Backup current config
            copyFileSync(patchFile, backupFile);
            // Remove non-core plugins
            let content = readFileSync(patchFile, 'utf8');
            const marker = '# dsh-prompt-enhancer';
            const idx = content.indexOf(marker);
            if (idx >= 0) {
              let end = content.indexOf('\n# ', idx + marker.length);
              if (end < 0) end = content.length;
              content = content.slice(0, idx) + content.slice(end);
            }
            writeFileSync(patchFile, content, 'utf8');
            sendJson(res, 200, { ok: true, message: '已进入安全模式，非核心插件已禁用。请重启 DSH 服务。' });
          } else {
            // Restore from backup
            if (!existsSync(backupFile)) {
              sendJson(res, 500, { ok: false, error: '备份文件不存在，无法恢复' }); return;
            }
            copyFileSync(backupFile, patchFile);
            sendJson(res, 200, { ok: true, message: '已从备份恢复所有插件配置。请重启 DSH 服务。' });
          }
        } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
      });
    });

    return () => { for (const d of disposers) d(); };
  }, name + ': routes');
}

function getEnhancePrompt(mode) {
  const base = '你是提示词优化专家。优化用户输入的提示词，使其更清晰、完整、可执行。\n\n规则：\n1. 保持原始意图不变\n2. 补充缺失的关键信息（技术栈、约束、输出格式）\n3. 去除模糊表达，用明确指令替代\n4. 涉及代码时补充技术细节\n5. 直接输出优化后的提示词，不要解释';
  if (mode === 'basic') return base + '\n\n模式：基础。只做最小优化，保持原文风格。';
  if (mode === 'standard') return base + '\n\n模式：标准。补充上下文、明确技术要求、添加输出格式。';
  if (mode === 'expert') return base + '\n\n模式：专家。深度优化：拆解子任务、补充约束、添加验收标准、考虑边界情况。';
  return base;
}