// CDP driver: connect to the desktop app's GUI page (remote debugging port)
// and measure header vs workspace-panel geometry in the REAL app environment.
const http = require('http');

const PORT = process.argv[2] || '9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  // find the DSH GUI page target
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    try {
      const list = await getJson('/json/list');
      target = list.find((t) => t.type === 'page' && t.url && t.url.indexOf('127.0.0.1:3080') >= 0);
    } catch { /* retry */ }
    if (!target) await sleep(1000);
  }
  if (!target) { console.log('NO_TARGET'); return; }
  console.log('TARGET:', target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const evals = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      evals.push('[console] ' + (msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 120));
    }
  };
  await new Promise((r) => (ws.onopen = r));

  function evaluate(expression) {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, (msg) => resolve(msg.result && msg.result.result ? msg.result.result.value : msg.result));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  }

  await sleep(2000);

  // 1) current state
  const state = await evaluate(`(() => ({
    ready: document.readyState,
    title: document.title,
    root: !!document.getElementById('root'),
    tab: !!document.querySelector('.wt-tab'),
    panel: !!document.querySelector('.wt-panel'),
    url: location.href,
  }))()`);
  console.log('STATE:', JSON.stringify(state));

  // 2) enter a session if in hero
  await evaluate(`(() => {
    const ws = document.querySelector('[data-slot="sidebar.workspaces"]');
    if (!ws) return 'no-ws';
    const rows = Array.from(ws.querySelectorAll('div,li,button')).filter((e) => String(e.className).indexOf('sessionRow') >= 0 && (e.textContent||'').trim().length > 2);
    if (rows.length) rows[0].click();
    return 'clicked ' + rows.length;
  })()`);
  await sleep(3000);

  // 3) open the workspace panel
  const opened = await evaluate(`(() => {
    const t = document.querySelector('.wt-tab');
    if (!t) return 'no-tab';
    const r = t.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) t.dispatchEvent(new MouseEvent(type, opts));
    return 'clicked';
  })()`);
  console.log('OPENED:', opened);
  await sleep(2500);

  // 4) measure in the REAL app
  const probe = await evaluate(`(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const panel = document.querySelector('.wt-panel');
    const root = document.getElementById('root');
    // header: boxed ancestor of 回退 text with width > 300
    let header = null;
    const txt = Array.from(document.querySelectorAll('div,header,button')).find((e) => (e.textContent||'').includes('回退') && (e.textContent||'').length < 400);
    if (txt) {
      let e = txt;
      while (e && e !== document.body) {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (r.height > 20 && r.width > 300 && cs.display !== 'contents') { header = { rect: rect(e), z: cs.zIndex, pos: cs.position, cls: String(e.className).slice(0,50) }; break; }
        e = e.parentElement;
      }
    }
    let topAt = null;
    if (panel) {
      const p = panel.getBoundingClientRect();
      const el = document.elementFromPoint(p.left + 8, p.top + 8);
      const chain = [];
      let e = el; while (e && chain.length < 5) { chain.push(e.tagName + '.' + String(e.className).split(' ').slice(0,2).join('.').slice(0,30)); e = e.parentElement; }
      topAt = chain;
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      rootMarginRight: root ? root.style.marginRight : null,
      panel: panel ? rect(panel) : null,
      panelZ: panel ? getComputedStyle(panel).zIndex : null,
      header,
      topAtPanelTopLeft: topAt,
    };
  })()`);
  console.log('PROBE:', JSON.stringify(probe, null, 1));

  console.log('CONSOLE:', JSON.stringify(evals.slice(-10)));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.log('FAILED:', String(e && e.stack || e)); process.exit(3); });
