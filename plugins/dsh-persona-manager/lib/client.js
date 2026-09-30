// dsh-persona-manager — browser half.
// 卡片式人设管理 + 快速切换 + 峰谷倒计时。
window.__ModuleLoader__.load({
  id: 'dsh-persona-manager',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var API = '/api/personas';

    var ICON_MAP = {
      '默认': '\u269B\uFE0F', '助手': '\uD83E\uDD16', '安全': '\uD83D\uDEE1\uFE0F',
      '开发': '\uD83D\uDCBB', '架构': '\uD83C\uDFD7\uFE0F', '写': '\u270D\uFE0F',
      '翻译': '\uD83C\uDF0D', '数据': '\uD83D\uDCCA', '设计': '\uD83C\uDFA8',
      '测试': '\uD83E\uDDEA', '运维': '\u2699\uFE0F', '产品': '\uD83D\uDCDD',
    };
    function getIcon(name) { for (var k in ICON_MAP) { if (name.indexOf(k) >= 0) return ICON_MAP[k]; } return '\uD83C\uDFAD'; }

    var STYLE_ID = 'dsh-persona-v2';
    if (typeof document !== 'undefined' && !document.querySelector('[data-plugin-css="' + STYLE_ID + '"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', STYLE_ID);
      style.textContent = [
        '.pv2-root{display:flex;flex-direction:column;flex:1;min-height:0;color:var(--dsw-alias-label-primary,#eee);font-size:13px}',
        '.pv2-toolbar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);flex-wrap:wrap}',
        '.pv2-toolbar-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#eee);margin-right:4px;white-space:nowrap}',
        '.pv2-search{flex:1;min-width:120px;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:6px 10px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none;transition:border-color .15s}',
        '.pv2-search:focus{border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
        '.pv2-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11.5px;cursor:pointer;white-space:nowrap;transition:all .15s}',
        '.pv2-btn:hover{background:rgba(164,183,229,.1);color:var(--dsw-alias-label-primary,#eee)}',
        '.pv2-btn-pri{background:var(--dsw-alias-button-filled-bg,#4d6bfe);color:var(--dsw-alias-button-filled-label,#fff);border-color:transparent}',
        '.pv2-btn-pri:hover{opacity:.85;color:#fff}',
        '.pv2-btn-del{color:#ff7b72;border-color:#ff7b7266}',
        '.pv2-btn-del:hover{background:#ff7b7218}',
        '.pv2-body{display:flex;flex:1;min-height:0;overflow:hidden}',
        '.pv2-list{width:280px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,#333);overflow:hidden}',
        '.pv2-list-scroll{flex:1;overflow-y:auto;padding:6px}',
        '.pv2-card{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin-bottom:4px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:all .12s}',
        '.pv2-card:hover{background:rgba(164,183,229,.06);border-color:var(--dsw-alias-border-l2,#333)}',
        '.pv2-card-active{background:rgba(77,107,254,.1);border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
        '.pv2-card-current{border-left:3px solid #34a853}',
        '.pv2-card-avatar{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none;background:var(--dsw-alias-bg-layer-2,#222);border:1px solid var(--dsw-alias-border-l1,#333)}',
        '.pv2-card-info{flex:1;min-width:0}',
        '.pv2-card-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.pv2-card-desc{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}',
        '.pv2-card-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;background:rgba(52,168,83,.15);color:#34a853;border:1px solid rgba(52,168,83,.3);margin-top:4px}',
        '.pv2-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#666);font-size:12px;gap:6px;padding:20px}',
        '.pv2-empty-icon{font-size:32px;opacity:.4}',
        '.pv2-editor{flex:1;display:flex;flex-direction:column;padding:14px 18px;overflow-y:auto;gap:12px}',
        '.pv2-field{display:flex;flex-direction:column;gap:4px}',
        '.pv2-field label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#999)}',
        '.pv2-field input,.pv2-field textarea{width:100%;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:7px 10px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;transition:border-color .15s}',
        '.pv2-field input:focus,.pv2-field textarea:focus{border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
        '.pv2-field textarea{min-height:200px;resize:vertical;line-height:1.6}',
        '.pv2-preview{background:var(--dsw-alias-bg-layer-2,#1c1c1e);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#999);white-space:pre-wrap;line-height:1.5;max-height:200px;overflow-y:auto;margin-top:4px}',
        '.pv2-preview-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);margin-top:8px;font-weight:600}',
        '.pv2-btns{display:flex;gap:8px;flex:none;padding-top:6px}',
        '.pv2-btn-save{background:var(--dsw-alias-button-filled-bg,#4d6bfe);color:var(--dsw-alias-button-filled-label,#fff);border-color:transparent}',
        '.pv2-btn-activate{background:rgba(52,168,83,.15);color:#34a853;border-color:rgba(52,168,83,.3)}',
        '.pv2-btn-activate:hover{background:rgba(52,168,83,.25)}',
        '.pv2-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:8px;font-size:12px;background:var(--dsw-alias-bg-layer-2,#222);border:1px solid var(--dsw-alias-border-l1,#333);color:var(--dsw-alias-label-primary,#eee);z-index:9999;animation:pv2-fade .25s}',
        '@keyframes pv2-fade{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
        '.pv2-footer{display:flex;gap:6px;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1,#333)}',
        '.pv2-footer-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-tertiary,#888);font-size:11px;cursor:pointer;transition:all .15s}',
        '.pv2-footer-btn:hover{background:rgba(164,183,229,.08);color:var(--dsw-alias-label-secondary,#aaa)}',
        '.pv2-sw{position:relative;display:inline-flex;min-width:0}',
        '.pv2-sw-btn{display:flex;align-items:center;gap:4px;min-width:0;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#999)}',
        '.pv2-sw-btn:hover{background:rgba(164,183,229,.12);color:var(--dsw-alias-label-primary,#eee)}',
        '.pv2-sw-icon{flex:none}',
        '.pv2-sw-name{min-width:0;max-width:9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.pv2-sw-caret{flex:none}',
        '.pv2-sw-drop{position:absolute;right:0;top:100%;margin-top:4px;min-width:200px;background:var(--dsw-alias-bg-layer-2,#1c1c1e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);z-index:100;padding:4px}',
        '.pv2-sw-card{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary,#eee);border-radius:6px;transition:all .12s}',
        '.pv2-sw-card:hover{background:rgba(164,183,229,.1)}',
        '.pv2-sw-card-active{background:rgba(77,107,254,.1);border:1px solid rgba(77,107,254,.3)}',
        '.pv2-sw-card-icon{font-size:16px}',
        '.pv2-sw-card-info{flex:1;min-width:0}',
        '.pv2-sw-card-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.pv2-sw-card-desc{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.pv2-peak{flex:0 1 auto;min-width:0;align-items:center;display:flex;position:relative}',
        '.pv2-peak-chip{box-sizing:border-box;min-width:0;height:42px;color:var(--dsw-alias-label-primary);border-radius:12px;align-items:center;gap:8px;padding:0 10px;font-family:inherit;font-size:14px;line-height:22px;display:inline-flex;overflow:hidden;cursor:default}',
        '.pv2-peak-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.pv2-peak-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary);transition:background var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease)}',
        '.pv2-peak[data-peak=on] .pv2-peak-dot{background:var(--dsw-alias-state-warn-primary);animation:pv2-peak-pulse 2s var(--ds-ease-in-out,ease) infinite}',
        '.pv2-peak-label{min-width:0;font-size:14px;line-height:22px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;transition:color var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease)}',
        '.pv2-peak[data-peak=on] .pv2-peak-label{color:var(--dsw-alias-state-warn-primary)}',
        '.pv2-peak-time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}',
        '.pv2-peak.pv2-rail .pv2-peak-chip{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}',
        '@keyframes pv2-peak-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
      ].join('\n');
      document.head.appendChild(style);
    }

    function apiGet(url) { return fetch(url).then(function (r) { return r.json(); }); }
    function apiPost(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiPut(url, body) { return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiDelete(url) { return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); }); }

    function getPersonas() { return apiGet(API); }
    function activatePersona(id) { return apiPost(API + '/activate?id=' + encodeURIComponent(id)); }
    function createPersona(data) { return apiPost(API + '/create', data); }
    function updatePersona(id, data) { return apiPut(API + '/update?id=' + encodeURIComponent(id), data); }
    function deletePersona(id) { return apiDelete(API + '/delete?id=' + encodeURIComponent(id)); }

    function PersonaCard(props) {
      var p = props.p, active = props.active, current = props.current, onClick = props.onClick;
      return React.createElement('div', {
        className: 'pv2-card' + (active ? ' pv2-card-active' : '') + (current ? ' pv2-card-current' : ''),
        onClick: onClick
      },
        React.createElement('div', { className: 'pv2-card-avatar' }, getIcon(p.name)),
        React.createElement('div', { className: 'pv2-card-info' },
          React.createElement('div', { className: 'pv2-card-name' }, p.name),
          p.description ? React.createElement('div', { className: 'pv2-card-desc' }, p.description) : null,
          current ? React.createElement('div', { className: 'pv2-card-badge' }, '\u2713 \u5F53\u524D\u4F7F\u7528') : null));
    }

    function PersonaEditor(props) {
      var persona = props.persona, isCurrent = props.isCurrent;
      var onSave = props.onSave, onDelete = props.onDelete, onActivate = props.onActivate, onChange = props.onChange;
      var name = persona.name, description = persona.description, text = persona.text;
      var injectPreview = text ? '\u4EE5\u4E0B\u662F\u4F60\u7684\u89D2\u8272\u8BBE\u5B9A\uFF1A\n\n' + text : '\uFF08\u672A\u8BBE\u7F6E\u4EBA\u8BBE\u6587\u672C \u2014 \u4F7F\u7528\u7CFB\u7EDF\u9ED8\u8BA4\u884C\u4E3A\uFF09';
      return React.createElement('div', { className: 'pv2-editor' },
        React.createElement('div', { className: 'pv2-field' },
          React.createElement('label', null, '\u540D\u79F0'),
          React.createElement('input', { type: 'text', value: name, onChange: function (e) { onChange({ name: e.target.value }); }, placeholder: '\u4EBA\u8BBE\u540D\u79F0' })),
        React.createElement('div', { className: 'pv2-field' },
          React.createElement('label', null, '\u63CF\u8FF0'),
          React.createElement('input', { type: 'text', value: description, onChange: function (e) { onChange({ description: e.target.value }); }, placeholder: '\u4E00\u53E5\u8BDD\u63CF\u8FF0' })),
        React.createElement('div', { className: 'pv2-field' },
          React.createElement('label', null, '\u4EBA\u8BBE\u6587\u672C\uFF08\u6CE8\u5165\u7CFB\u7EDF\u63D0\u793A\u8BCD\uFF09'),
          React.createElement('textarea', { value: text, onChange: function (e) { onChange({ text: e.target.value }); }, placeholder: '\u8F93\u5165\u4EBA\u8BBE\u6587\u672C...' })),
        React.createElement('div', { className: 'pv2-preview-label' }, '\uD83D\uDC41 \u9884\u89C8\uFF1A'),
        React.createElement('div', { className: 'pv2-preview' }, injectPreview),
        React.createElement('div', { className: 'pv2-btns' },
          React.createElement('button', { className: 'pv2-btn pv2-btn-save', onClick: onSave }, '\uD83D\uDCBE \u4FDD\u5B58'),
          !isCurrent ? React.createElement('button', { className: 'pv2-btn pv2-btn-activate', onClick: onActivate }, '\u26A1 \u8BBE\u4E3A\u5F53\u524D') : null,
          !isCurrent ? React.createElement('button', { className: 'pv2-btn pv2-btn-del', onClick: onDelete }, '\uD83D\uDDD1\uFE0F \u5220\u9664') : null));
    }

    function PersonaManager() {
      var _a = React.useState([]), personas = _a[0], setPersonas = _a[1];
      var _b = React.useState(''), activeId = _b[0], setActiveId = _b[1];
      var _c = React.useState(null), selectedId = _c[0], setSelectedId = _c[1];
      var _d = React.useState({}), draft = _d[0], setDraft = _d[1];
      var _e = React.useState(''), search = _e[0], setSearch = _e[1];
      var _f = React.useState(null), toast = _f[0], setToast = _f[1];
      var fileRef = React.useRef(null);

      var showToast = function (msg) { setToast(msg); setTimeout(function () { setToast(null); }, 2000); };
      var refresh = React.useCallback(function () {
        getPersonas().then(function (data) { if (data.ok) { setPersonas(data.personas); setActiveId(data.activeId); } });
      }, []);
      React.useEffect(function () { refresh(); }, [refresh]);

      var filtered = personas.filter(function (p) {
        if (!search) return true;
        var q = search.toLowerCase();
        return p.name.toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0;
      });

      var selected = personas.find(function (p) { return p.id === selectedId; }) || null;
      var editDraft = selected ? { name: draft.name !== undefined ? draft.name : selected.name, description: draft.description !== undefined ? draft.description : selected.description, text: draft.text !== undefined ? draft.text : selected.text } : null;

      var onSelect = function (id) { setSelectedId(id); setDraft({}); };
      var onDraftChange = function (fields) { setDraft(function (prev) { return Object.assign({}, prev, fields); }); };
      var onAdd = function () { createPersona({ name: '\u65B0\u4EBA\u8BBE', description: '', text: '' }).then(function (res) { if (res.ok) { refresh(); setSelectedId(res.persona.id); setDraft({}); showToast('\u2705 \u5DF2\u521B\u5EFA'); } }); };
      var onSave = function () { if (!selected) return; var data = {}; if (draft.name !== undefined) data.name = draft.name; if (draft.description !== undefined) data.description = draft.description; if (draft.text !== undefined) data.text = draft.text; updatePersona(selected.id, data).then(function (res) { if (res.ok) { refresh(); setDraft({}); showToast('\u2705 \u5DF2\u4FDD\u5B58'); } }); };
      var onDelete = function () { if (!selected || selected.id === activeId) return; deletePersona(selected.id).then(function (res) { if (res.ok) { refresh(); setSelectedId(null); setDraft({}); showToast('\u2705 \u5DF2\u5220\u9664'); } }); };
      var getSessionId = function() { try { return window.location.pathname.split('/').pop() || ''; } catch(e) { return ''; } };
      var onActivate = function () {
        if (!selected) return;
        activatePersona(selected.id).then(function (res) {
          if (res.ok) {
            refresh();
            showToast('\u26A1 \u5DF2\u5207\u6362\u5230: ' + selected.name + (selected.description ? ' - ' + selected.description : ''));
            // Bind to current session
            var sid = getSessionId();
            if (sid) fetch(API + '/bind?sessionId=' + encodeURIComponent(sid) + '&id=' + encodeURIComponent(selected.id), { method: 'POST' });
          }
        });
      };
      var onExport = function () { var data = { activeId: activeId, personas: personas }; var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'personas-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(url); showToast('\u2705 \u5DF2\u5BFC\u51FA'); };
      var onImport = function (e) {
        var file = e.target.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            var list = Array.isArray(data) ? data : (data.personas || []);
            if (list.length === 0) { showToast('\u274C \u6587\u4EF6\u4E2D\u6CA1\u6709\u4EBA\u8BBE'); return; }
            var count = 0, pending = list.length;
            list.forEach(function (p) { if (!p.name) { pending--; return; } createPersona({ name: p.name, description: p.description || '', text: p.text || '' }).then(function (res) { if (res.ok) count++; pending--; if (pending <= 0) { refresh(); showToast('\u2705 \u5DF2\u5BFC\u5165 ' + count + ' \u4E2A\u4EBA\u8BBE'); } }); });
          } catch (err) { showToast('\u274C \u5BFC\u5165\u5931\u8D25'); }
        };
        reader.readAsText(file); e.target.value = '';
      };

      return React.createElement('div', { className: 'pv2-root' },
        React.createElement('div', { className: 'pv2-toolbar' },
          React.createElement('span', { className: 'pv2-toolbar-title' }, '\uD83C\uDFAD \u4EBA\u8BBE\u7BA1\u7406'),
          React.createElement('input', { className: 'pv2-search', type: 'text', placeholder: '\u641C\u7D22\u4EBA\u8BBE...', value: search, onChange: function (e) { setSearch(e.target.value); } }),
          React.createElement('button', { className: 'pv2-btn pv2-btn-pri', onClick: onAdd }, '+ \u65B0\u5EFA')),
        React.createElement('div', { className: 'pv2-body' },
          React.createElement('div', { className: 'pv2-list' },
            React.createElement('div', { className: 'pv2-list-scroll' },
              filtered.length === 0
                ? React.createElement('div', { className: 'pv2-empty' }, React.createElement('div', { className: 'pv2-empty-icon' }, '\uD83C\uDFAD'), '\u6682\u65E0\u4EBA\u8BBE')
                : filtered.map(function (p) { return React.createElement(PersonaCard, { key: p.id, p: p, active: p.id === selectedId, current: p.id === activeId, onClick: function () { onSelect(p.id); } }); })),
            React.createElement('div', { className: 'pv2-footer' },
              React.createElement('button', { className: 'pv2-footer-btn', onClick: onExport }, '\uD83D\uDCE5 \u5BFC\u51FA'),
              React.createElement('button', { className: 'pv2-footer-btn', onClick: function () { fileRef.current && fileRef.current.click(); } }, '\uD83D\uDCE5 \u5BFC\u5165'),
              React.createElement('input', { ref: fileRef, type: 'file', accept: '.json', style: { display: 'none' }, onChange: onImport }))),
          selected && editDraft
            ? React.createElement(PersonaEditor, { persona: editDraft, isCurrent: selected.id === activeId, onSave: onSave, onDelete: onDelete, onActivate: onActivate, onChange: onDraftChange })
            : React.createElement('div', { className: 'pv2-empty' }, React.createElement('div', { className: 'pv2-empty-icon' }, '\uD83C\uDFAD'), '\u9009\u62E9\u4E00\u4E2A\u4EBA\u8BBE')),
        toast ? React.createElement('div', { className: 'pv2-toast' }, toast) : null);
    }

    function PersonaQuickSwitch() {
      var _a = React.useState([]), personas = _a[0], setPersonas = _a[1];
      var _b = React.useState(''), activeId = _b[0], setActiveId = _b[1];
      var _c = React.useState(false), open = _c[0], setOpen = _c[1];
      var ref = React.useRef(null);

      // Load personas — server is the source of truth for activeId
      React.useEffect(function () {
        getPersonas().then(function (d) {
          if (d.ok) {
            setPersonas(d.personas);
            setActiveId(d.activeId);
          }
        });
      }, []);
      React.useEffect(function () {
        if (!open) return;
        var handler = function (e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return function () { document.removeEventListener('mousedown', handler); };
      }, [open]);

      var active = personas.find(function (p) { return p.id === activeId; });
      var _toast = React.useState(null), toast = _toast[0], setToast = _toast[1];
      var showQuickToast = function(msg) { setToast(msg); setTimeout(function(){ setToast(null); }, 2000); };
      var getSessionId = function() { return sessionId || ''; };
      var switchTo = function (id) {
        var target = personas.find(function(p){ return p.id === id; });
        console.log('[persona-quick] switchTo: id=' + id + ' target=' + (target ? target.name : 'null'));
        activatePersona(id).then(function (res) {
          if (res.ok) {
            setActiveId(id); setOpen(false);
            showQuickToast('\u26A1 \u5DF2\u5207\u6362\u5230: ' + (target ? target.name : id));
            // Bind to current session
            var sid = getSessionId();
            if (sid) fetch(API + '/bind?sessionId=' + encodeURIComponent(sid) + '&id=' + encodeURIComponent(id), { method: 'POST' });
          }
        });
      };

      var pname = active ? active.name : '\u4EBA\u8BBE';
      var buttonEl = React.createElement('div', {
        className: 'pv2-sw-btn',
        onClick: function () { setOpen(!open); },
        title: '\u5207\u6362\u4EBA\u8BBE\uFF1A' + pname,
      },
        React.createElement('span', { className: 'pv2-sw-icon' }, getIcon(active ? active.name : '')),
        React.createElement('span', { className: 'pv2-sw-name' }, pname),
        React.createElement('span', { className: 'pv2-sw-caret' }, '\u25BE'));

      var dropEl = open && personas.length > 0
        ? React.createElement('div', { className: 'pv2-sw-drop' },
            personas.map(function (p) {
              return React.createElement('div', {
                key: p.id,
                className: 'pv2-sw-card' + (p.id === activeId ? ' pv2-sw-card-active' : ''),
                onClick: function () { switchTo(p.id); }
              },
                React.createElement('span', { className: 'pv2-sw-card-icon' }, getIcon(p.name)),
                React.createElement('div', { className: 'pv2-sw-card-info' },
                  React.createElement('div', { className: 'pv2-sw-card-name' }, p.name),
                  p.description ? React.createElement('div', { className: 'pv2-sw-card-desc' }, p.description) : null));
            }))
        : null;

      return React.createElement('div', { className: 'pv2-sw', ref: ref }, buttonEl, dropEl,
        toast ? React.createElement('div', { className: 'pv2-toast', style: { position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', padding:'6px 14px', borderRadius:6, fontSize:12, background:'var(--dsw-alias-bg-layer-2,#222)', border:'1px solid var(--dsw-alias-border-l1,#333)', color:'var(--dsw-alias-label-primary,#eee)', zIndex:9999, animation:'pv2-fade .2s' } }, toast) : null);
    }

    var PEAK_WINDOWS = [[9, 12], [14, 18]];
    function fmtClock(totalSecs) {
      var s = Math.max(0, Math.floor(totalSecs));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      var p = function (n) { return String(n).padStart(2, '0'); };
      return (h > 0 ? h + ':' : '') + p(m) + ':' + p(ss);
    }
    function peakSnapshot() {
      var bj = new Date(Date.now() + 8 * 3600 * 1000);
      var h = bj.getUTCHours(), m = bj.getUTCMinutes(), s = bj.getUTCSeconds();
      var cur = h + m / 60 + s / 3600;
      var inPeak = false, target = null, label = '';
      for (var i = 0; i < PEAK_WINDOWS.length; i++) { if (cur >= PEAK_WINDOWS[i][0] && cur < PEAK_WINDOWS[i][1]) { inPeak = true; target = PEAK_WINDOWS[i][1]; label = '\u7ED3\u675F'; break; } }
      if (!inPeak) { for (var j = 0; j < PEAK_WINDOWS.length; j++) { if (cur < PEAK_WINDOWS[j][0]) { target = PEAK_WINDOWS[j][0]; label = '\u5F00\u59CB'; break; } } if (target === null) { target = 9 + 24; label = '\u5F00\u59CB'; } }
      var secs = Math.round((target - cur) * 3600);
      return { inPeak: inPeak, short: fmtClock(secs), text: fmtClock(secs) + (inPeak ? ' \u540E\u8F6C\u5165\u95F2\u65F6' : ' \u540E\u8FDB\u5165\u9AD8\u5CF0') };
    }
    function PeakCountdown(props) {
      var wide = !!(props && props.wide);
      var _pk = React.useState(peakSnapshot), peak = _pk[0], setPeak = _pk[1];
      React.useEffect(function () { var t = setInterval(function () { setPeak(peakSnapshot()); }, 1000); return function () { clearInterval(t); }; }, []);

      var tier = peak.inPeak ? '\u9AD8\u5CF0\u65F6\u6BB5' : '\u95F2\u65F6';
      var tip = 'DeepSeek \u5CF0\u8C37\u5B9A\u4EF7\uFF1A\u9AD8\u5CF0\u65F6\u6BB5\uFF089:00-12:00\u300114:00-18:00\uFF09\u4EF7\u683C\u4E3A\u7A7A\u95F2\u65F6\u6BB5\u7684 2 \u500D\u3002'
        + (peak.inPeak ? '\u5F53\u524D\u4E3A\u9AD8\u5CF0\uFF0C' : '\u5F53\u524D\u4E3A\u95F2\u65F6\uFF0C') + peak.text + '\u3002';

      // 对齐官方 sidebar.footer.action 原生条目（.Nqubda_badge）的尺寸与令牌：
      // 42px 行高、12px 圆角、14px 字号，标签在左、倒计时靠右对齐；
      // 侧边栏收起（rail）时收成一个 36x36 的状态点。
      var chip = React.createElement('div', { className: 'pv2-peak-chip' },
        React.createElement('span', { className: 'pv2-peak-dot' }),
        wide ? React.createElement('span', { className: 'pv2-peak-label' }, tier) : null,
        wide ? React.createElement('span', { className: 'pv2-peak-time' }, peak.short) : null);

      return React.createElement('div', {
        className: 'pv2-peak' + (wide ? '' : ' pv2-rail'),
        'data-peak': peak.inPeak ? 'on' : 'off',
        title: tip,
      }, chip);
    }

    var inject = ['slots'];
    function apply(ctx) {
      try {
        var slots = ctx.slots;
        slots.inject('settings.section', function () { slots.register({ name: 'settings.section', id: 'persona-manager', order: 40, label: '\u4EBA\u8BBE' }, PersonaManager); });
        slots.inject('conversation.session.header.utilities', function () { slots.register({ name: 'conversation.session.header.utilities', id: 'persona-quick-switch', order: 20 }, PersonaQuickSwitch); });
        slots.inject('sidebar.footer.action', function () { slots.register({ name: 'sidebar.footer.action', id: 'peak-warning', order: 90 }, PeakCountdown); });
      } catch (err) { console.error('[dsh-persona-manager] apply failed:', err); }
    }

    exports.name = 'dsh-persona-manager';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});