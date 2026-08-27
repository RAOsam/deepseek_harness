// dsh-persona-manager — host half.
// 多人设 CRUD 存储 + HTTP API + deployment:persona 系统提示词注入。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const PERSONA_SECTION = 'deployment:persona';
const PERSONA_ORDER = 0;
const API = '/api/personas';

export const name = 'dsh-persona-manager';
export const inject = ['webServer', 'systemPrompt'];


function personasFile() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  return join(home, 'personas.json');
}

function defaultPersona() {
  return {
    id: 'default',
    name: '默认助手',
    description: '通用 AI 助手',
    text: 'You are a helpful, harmless, and honest AI assistant. Be concise and accurate.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createPersonaManager() {
  let activeId, personas, sessionBindings = {};

  function load() {
    const file = personasFile();
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        activeId = data.activeId || 'default';
        personas = Array.isArray(data.personas) ? data.personas : [];
        sessionBindings = data.sessionBindings || {};
        if (personas.length === 0) {
          personas = [defaultPersona()];
          activeId = 'default';
        }
        return;
      }
    } catch { /* ignore parse errors, recreate below */ }
    activeId = 'default';
    personas = [defaultPersona()];
  }

  function save() {
    const file = personasFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ activeId, personas, sessionBindings }, null, 2), 'utf8');
  }

  function activeText() {
    const p = personas.find((x) => x.id === activeId);
    return p ? p.text : '';
  }

  load();
  save(); // ensure file exists

  return {
    get activeId() { return activeId; },
    set activeId(val) { activeId = val; },
    get personas() { return personas; },
    activeText,
    load,
    save,
    bindSession(sid, pid) { sessionBindings[sid] = pid; save(); },
    unbindSession(sid) { delete sessionBindings[sid]; save(); },
    getSessionPersona(sid) { return sessionBindings[sid] || null; },
    switchToSessionPersona(sid) {
      const bid = sessionBindings[sid];
      if (bid && personas.find(p => p.id === bid)) { activeId = bid; save(); return true; }
      return false;
    },
  };
}

export function apply(ctx) {
  const manager = createPersonaManager();

  // 注入当前活跃人设到系统提示词（用 context 而非 section，避免与系统内置
  // deployment:persona section 冲突——系统提示词构造器已注册同名 section）
  const sp = ctx.get('systemPrompt');
  let disposeContext = null;
  function applyPersona() {
    if (!sp) return;
    if (disposeContext) { disposeContext(); disposeContext = null; }
    const text = manager.activeText();
    if (text) {
      disposeContext = sp.context({
        name: 'persona-manager:override',
        order: PERSONA_ORDER,
        text,
      });
    }
  }
  applyPersona();

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

    // GET /api/personas — list
    register(API, (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ok: true, activeId: manager.activeId, personas: manager.personas });
    });

    // POST /api/personas/activate?id=xxx — switch active
    register(API + '/activate', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      try {
        const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
        if (!id) { sendJson(res, 400, { ok: false, error: 'missing id' }); return; }
        const target = manager.personas.find((p) => p.id === id);
        if (!target) { sendJson(res, 404, { ok: false, error: 'persona not found' }); return; }
        manager.activeId = id;
        manager.save();
        applyPersona();
        sendJson(res, 200, { ok: true, activeId: id });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
      }
    });

    // POST /api/personas/create — create
    register(API + '/create', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      parseBody(req).then((body) => {
        if (!body || !body.name) { sendJson(res, 400, { ok: false, error: 'name required' }); return; }
        const id = 'p-' + Date.now().toString(36);
        const persona = { id, name: body.name, description: body.description || '', text: body.text, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        manager.personas.push(persona);
        manager.save();
        sendJson(res, 200, { ok: true, persona });
      });
    });

    // PUT /api/personas/update?id=xxx — update
    register(API + '/update', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'PUT') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      const persona = id ? manager.personas.find((p) => p.id === id) : null;
      if (!persona) { sendJson(res, 404, { ok: false, error: 'persona not found' }); return; }
      parseBody(req).then((body) => {
        if (!body) { sendJson(res, 400, { ok: false, error: 'invalid body' }); return; }
        if (body.name !== undefined) persona.name = body.name;
        if (body.description !== undefined) persona.description = body.description;
        if (body.text !== undefined) persona.text = body.text;
        persona.updatedAt = new Date().toISOString();
        manager.save();
        if (id === manager.activeId) applyPersona();
        sendJson(res, 200, { ok: true, persona });
      });
    });

    // DELETE /api/personas/delete?id=xxx — delete
    register(API + '/delete', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'DELETE') { res.writeHead(405); res.end(); return; }
      const id = new URL(req.url || '/', 'http://x').searchParams.get('id');
      if (!id) { sendJson(res, 400, { ok: false, error: 'missing id' }); return; }
      if (manager.personas.length <= 1) { sendJson(res, 400, { ok: false, error: 'cannot delete last persona' }); return; }
      const idx = manager.personas.findIndex((p) => p.id === id);
      if (idx < 0) { sendJson(res, 404, { ok: false, error: 'persona not found' }); return; }
      if (id === manager.activeId) { sendJson(res, 400, { ok: false, error: 'cannot delete active persona' }); return; }
      manager.personas.splice(idx, 1);
      manager.save();
      sendJson(res, 200, { ok: true });
    });

    // POST /api/personas/bind?sessionId=xxx&id=xxx — bind persona to session
    register(API + '/bind', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const u = new URL(req.url || '/', 'http://x');
      const sid = u.searchParams.get('sessionId');
      const pid = u.searchParams.get('id');
      if (!sid || !pid) { sendJson(res, 400, { ok: false, error: 'missing sessionId or id' }); return; }
      manager.bindSession(sid, pid);
      sendJson(res, 200, { ok: true });
    });

    // POST /api/personas/switch-session?sessionId=xxx — switch to session's bound persona
    register(API + '/switch-session', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const sid = new URL(req.url || '/', 'http://x').searchParams.get('sessionId');
      if (!sid) { sendJson(res, 400, { ok: false, error: 'missing sessionId' }); return; }
      const switched = manager.switchToSessionPersona(sid);
      if (switched) { applyPersona(); }
      sendJson(res, 200, { ok: true, switched, activeId: manager.activeId });
    });

    // GET /api/personas/bindings — list all session bindings
    register(API + '/bindings', (req, res) => {
      if (req.method === 'OPTIONS') { sendOptions(res); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      sendJson(res, 200, { ok: true, bindings: manager.sessionBindings });
    });

    return () => { for (const d of disposers) d(); };
  }, name + ': routes');
}
