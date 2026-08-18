console.log('start');
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: false });
  try {
    await win.loadURL('http://127.0.0.1:3080');
    await sleep(5000);
    // 进入会话
    await win.webContents.executeJavaScript(`(() => {
      const ws = document.querySelector('[data-slot="sidebar.workspaces"]');
      const rows = Array.from(ws.querySelectorAll('div,li,button')).filter(e => String(e.className).indexOf('sessionRow') >= 0 && (e.textContent||'').trim().length > 2);
      if (rows.length) rows[0].click();
    })()`);
    await sleep(4000);

    // 点击工作区 tab
    await win.webContents.executeJavaScript(`(() => {
      const t = document.querySelector('.wt-tab');
      if (t) {
        const r = t.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width/2, clientY: r.top + r.height/2, button: 0 };
        for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) t.dispatchEvent(new MouseEvent(type, opts));
      }
      return !!t;
    })()`);
    await sleep(2000);

    // 全面诊断
    const info = await win.webContents.executeJavaScript(`(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; };
      const cs = el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, pos: s.position, z: s.zIndex }; };
      const root = document.getElementById('root');
      const frame = root?.querySelector('[class*="frame"]');
      const center = root?.querySelector('[class*="centerCol"]');
      const scroll = center?.querySelector('[class*="scrollBody"]');
      const composer = center?.querySelector('[class*="composerSeat"]');
      const panel = document.querySelector('.wt-panel');
      const tab = document.querySelector('.wt-tab');
      const sidebar = document.querySelector('[class*="sidebarCol"]');
      const overlay = document.querySelector('[data-shell-overlay]');
      return {
        rootMR: root?.style.marginRight || '',
        frame: frame ? rect(frame) : null,
        center: center ? rect(center) : null,
        scroll: scroll ? rect(scroll) : null,
        composer: composer ? { rect: rect(composer), ...cs(composer) } : null,
        panel: panel ? rect(panel) : null,
        tab: tab ? rect(tab) : null,
        sidebar: sidebar ? rect(sidebar) : null,
        overlayZ: overlay ? getComputedStyle(overlay).zIndex : null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        skinLoaded: !!document.querySelector('[data-plugin*="maid-atelier"]'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    })()`);
    console.log('INFO:', JSON.stringify(info, null, 1));

    // 截图
    const img = await win.webContents.capturePage();
    fs.writeFileSync('D:/deepseek_harness/desktop/scripts/debug-screenshot.png', img.toPNG());
    console.log('截图已保存');
    app.exit(0);
  } catch (e) { console.log('FAILED:', String(e)); app.exit(3); }
});
