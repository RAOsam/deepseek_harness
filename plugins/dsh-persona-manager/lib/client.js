// dsh-persona-manager — browser half.
// 设置页面（settings.section）+ session header 快速切换（utilities）。
window.__ModuleLoader__.load({
  id: 'dsh-persona-manager',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var API = '/api/personas';

    // 样式注入
    var STYLE_ID = 'dsh-persona-manager';
    if (typeof document !== 'undefined' && !document.querySelector('[data-plugin-css="' + STYLE_ID + '"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', STYLE_ID);
      style.textContent = [
        '.pm-root{display:flex;flex:1;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary,#eee);font-size:13px}',
        '.pm-list{width:220px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,#333);overflow:hidden}',
        '.pm-list-items{flex:1;overflow-y:auto;padding:4px 0}',
        '.pm-item{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;border-radius:4px;margin:0 4px}',
        '.pm-item:hover{background:rgba(164,183,229,.12)}',
        '.pm-item-active{background:rgba(197,164,104,.18)}',
        '.pm-dot{width:6px;height:6px;border-radius:50%;background:transparent;flex:none}',
        '.pm-dot-active{background:#c5a468}',
        '.pm-add{margin:8px 8px;padding:6px;text-align:center;border:1px dashed var(--dsw-alias-border-l2,#444);border-radius:4px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#999)}',
        '.pm-add:hover{background:rgba(164,183,229,.12);color:var(--dsw-alias-label-primary,#eee)}',
        '.pm-editor{flex:1;display:flex;flex-direction:column;padding:12px 16px;overflow-y:auto;gap:10px}',
        '.pm-field label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#999);margin-bottom:3px;font-weight:600}',
        '.pm-field input,.pm-field textarea{width:100%;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:6px 8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box}',
        '.pm-field input:focus,.pm-field textarea:focus{border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
        '.pm-field textarea{min-height:180px;resize:vertical;line-height:1.5}',
        '.pm-btns{display:flex;gap:8px;flex:none;padding-top:4px}',
        '.pm-btn{padding:6px 14px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:12px;cursor:pointer}',
        '.pm-btn:hover{background:rgba(164,183,229,.12)}',
        '.pm-btn-pri{background:var(--dsw-alias-button-filled-bg,#4d6bfe);color:var(--dsw-alias-button-filled-label,#fff);border-color:transparent}',
        '.pm-btn-pri:hover{opacity:.85}',
        '.pm-btn-danger{color:#ff7b72;border-color:#ff7b7266}',
        '.pm-btn-danger:hover{background:#ff7b7218}',
        '.pm-btn-sm{padding:4px 10px;font-size:11px}',
        '.pm-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#888);font-size:12px}',
        '.pm-preview{background:var(--dsw-alias-bg-layer-2,#1c1c1e);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#999);white-space:pre-wrap;line-height:1.5;max-height:200px;overflow-y:auto;margin-top:4px}',
        '.pm-preview-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);margin-top:8px;margin-bottom:2px;font-weight:600}',
        '.pm-actions{display:flex;gap:6px;padding:8px;border-top:1px solid var(--dsw-alias-border-l1,#333)}',
        '.pm-sw{position:relative;display:inline-block}',
        '.pm-sw-btn{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#999)}',
        '.pm-sw-btn:hover{background:rgba(164,183,229,.12);color:var(--dsw-alias-label-primary,#eee)}',
        '.pm-sw-drop{position:absolute;right:0;top:100%;margin-top:4px;min-width:160px;background:var(--dsw-alias-bg-layer-2,#1c1c1e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35);z-index:100;padding:4px 0}',
        '.pm-sw-opt{display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-primary,#eee);white-space:nowrap}',
        '.pm-sw-opt:hover{background:rgba(164,183,229,.12)}',
        '.pm-sw-opt-active{color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
      ].join('\n');
      document.head.appendChild(style);
    }

    // API 辅助
    function apiGet(url) { return fetch(url).then(function (r) { return r.json(); }); }
    function apiPost(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiPut(url, body) { return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiDelete(url) { return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); }); }

    function getPersonas() { return apiGet(API); }
    function activatePersona(id) { return apiPost(API + '/activate?id=' + encodeURIComponent(id)); }
    function createPersona(data) { return apiPost(API + '/create', data); }
    function updatePersona(id, data) { return apiPut(API + '/update?id=' + encodeURIComponent(id), data); }
    function deletePersona(id) { return apiDelete(API + '/delete?id=' + encodeURIComponent(id)); }

    // ──────────────────── 设置页面组件 ────────────────────
    function PersonaList(props) {
      var personas = props.personas, activeId = props.activeId, selectedId = props.selectedId;
      var onSelect = props.onSelect, onAdd = props.onAdd, onExport = props.onExport, onImport = props.onImport;
      var fileRef = React.useRef(null);
      var handleImport = function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            onImport(data);
          } catch (err) { alert('导入失败：文件格式错误'); }
        };
        reader.readAsText(file);
        e.target.value = '';
      };
      return React.createElement('div', { className: 'pm-list' },
        React.createElement('div', { className: 'pm-list-items' },
          personas.map(function (p) {
            var isActive = p.id === activeId;
            var isSelected = p.id === selectedId;
            return React.createElement('div', {
              key: p.id,
              className: 'pm-item' + (isSelected ? ' pm-item-active' : ''),
              onClick: function () { onSelect(p.id); },
            },
              React.createElement('span', { className: 'pm-dot' + (isActive ? ' pm-dot-active' : '') }),
              React.createElement('span', null, p.name));
          })),
        React.createElement('div', { className: 'pm-actions' },
          React.createElement('button', { className: 'pm-btn pm-btn-sm', onClick: onAdd }, '+ 新建'),
          React.createElement('button', { className: 'pm-btn pm-btn-sm', onClick: onExport, title: '导出所有人设为 JSON 文件' }, '导出'),
          React.createElement('button', { className: 'pm-btn pm-btn-sm', onClick: function () { fileRef.current && fileRef.current.click(); }, title: '从 JSON 文件导入人设' }, '导入'),
          React.createElement('input', { ref: fileRef, type: 'file', accept: '.json', style: { display: 'none' }, onChange: handleImport })));
    }

    function PersonaEditor(props) {
      var persona = props.persona, isActive = props.isActive;
      var onSave = props.onSave, onDelete = props.onDelete, onChange = props.onChange;
      var name = persona.name, description = persona.description, text = persona.text;
      var onNameChange = function (e) { onChange({ name: e.target.value }); };
      var onDescChange = function (e) { onChange({ description: e.target.value }); };
      var onTextChange = function (e) { onChange({ text: e.target.value }); };
      var injectPreview = text
        ? '以下是你的角色设定：\n\n' + text
        : '（未设置人设文本 — 使用系统默认行为）';
      return React.createElement('div', { className: 'pm-editor' },
        React.createElement('div', { className: 'pm-field' },
          React.createElement('label', null, '名称'),
          React.createElement('input', { type: 'text', value: name, onChange: onNameChange, placeholder: '人设名称' })),
        React.createElement('div', { className: 'pm-field' },
          React.createElement('label', null, '描述'),
          React.createElement('input', { type: 'text', value: description, onChange: onDescChange, placeholder: '一句话描述' })),
        React.createElement('div', { className: 'pm-field' },
          React.createElement('label', null, '人设文本（注入系统提示词）'),
          React.createElement('textarea', { value: text, onChange: onTextChange, placeholder: '输入人设文本...' })),
        React.createElement('div', { className: 'pm-preview-title' }, '预览 — 注入系统提示词后的内容：'),
        React.createElement('div', { className: 'pm-preview' }, injectPreview),
        React.createElement('div', { className: 'pm-btns' },
          React.createElement('button', { className: 'pm-btn pm-btn-pri', onClick: onSave }, '保存'),
          isActive
            ? null
            : React.createElement('button', { className: 'pm-btn pm-btn-danger', onClick: onDelete }, '删除')));
    }

    function PersonaManager() {
      var _a = React.useState([]), personas = _a[0], setPersonas = _a[1];
      var _b = React.useState(''), activeId = _b[0], setActiveId = _b[1];
      var _c = React.useState(null), selectedId = _c[0], setSelectedId = _c[1];
      var _d = React.useState({}), draft = _d[0], setDraft = _d[1];
      var _e = React.useState(''), msg = _e[0], setMsg = _e[1];

      var refresh = React.useCallback(function () {
        getPersonas().then(function (data) {
          if (data.ok) {
            setPersonas(data.personas);
            setActiveId(data.activeId);
          }
        });
      }, []);
      React.useEffect(function () { refresh(); }, [refresh]);

      var selected = personas.find(function (p) { return p.id === selectedId; }) || null;
      var editDraft = selected ? { name: draft.name !== undefined ? draft.name : selected.name, description: draft.description !== undefined ? draft.description : selected.description, text: draft.text !== undefined ? draft.text : selected.text } : null;

      var onSelect = function (id) { setSelectedId(id); setDraft({}); setMsg(''); };
      var onDraftChange = function (fields) { setDraft(function (prev) { return Object.assign({}, prev, fields); }); };

      var onAdd = function () {
        createPersona({ name: '新人设', description: '', text: '' }).then(function (res) {
          if (res.ok) { refresh(); setSelectedId(res.persona.id); setDraft({}); setMsg('已创建'); }
        });
      };

      var onSave = function () {
        if (!selected) return;
        var data = {};
        if (draft.name !== undefined) data.name = draft.name;
        if (draft.description !== undefined) data.description = draft.description;
        if (draft.text !== undefined) data.text = draft.text;
        updatePersona(selected.id, data).then(function (res) {
          if (res.ok) { refresh(); setDraft({}); setMsg('已保存'); }
        });
      };

      var onDelete = function () {
        if (!selected) return;
        if (selected.id === activeId) { setMsg('不能删除当前活跃人设'); return; }
        deletePersona(selected.id).then(function (res) {
          if (res.ok) { refresh(); setSelectedId(null); setDraft({}); setMsg('已删除'); }
        });
      };

      var onExport = function () {
        var data = { activeId: activeId, personas: personas };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'personas-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click(); URL.revokeObjectURL(url);
        setMsg('已导出');
      };

      var onImport = function (data) {
        var list = Array.isArray(data) ? data : (data.personas || []);
        if (list.length === 0) { setMsg('导入失败：文件中没有人设'); return; }
        var count = 0;
        var pending = list.length;
        list.forEach(function (p) {
          if (!p.name) { pending--; return; }
          createPersona({ name: p.name, description: p.description || '', text: p.text || '' }).then(function (res) {
            if (res.ok) count++;
            pending--;
            if (pending <= 0) { refresh(); setMsg('已导入 ' + count + ' 个人设'); }
          });
        });
      };

      return React.createElement('div', { className: 'pm-root' },
        React.createElement(PersonaList, { personas: personas, activeId: activeId, selectedId: selectedId, onSelect: onSelect, onAdd: onAdd, onExport: onExport, onImport: onImport }),
        selected
          ? React.createElement(PersonaEditor, { persona: editDraft, isActive: selected.id === activeId, onSave: onSave, onDelete: onDelete, onChange: onDraftChange })
          : React.createElement('div', { className: 'pm-empty' }, msg || '选择一个人设，或点击「+ 新建人设」'));
    }

    // ──────────────────── session header 快速切换 ────────────────────
    function PersonaQuickSwitch() {
      var _a = React.useState([]), personas = _a[0], setPersonas = _a[1];
      var _b = React.useState(''), activeId = _b[0], setActiveId = _b[1];
      var _c = React.useState(false), open = _c[0], setOpen = _c[1];
      var ref = React.useRef(null);

      React.useEffect(function () {
        getPersonas().then(function (data) {
          if (data.ok) { setPersonas(data.personas); setActiveId(data.activeId); }
        });
      }, []);

      // 点击外部关闭
      React.useEffect(function () {
        if (!open) return;
        var handler = function (e) {
          if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return function () { document.removeEventListener('mousedown', handler); };
      }, [open]);

      var active = personas.find(function (p) { return p.id === activeId; });
      var switchTo = function (id) {
        activatePersona(id).then(function (res) {
          if (res.ok) { setActiveId(id); setOpen(false); }
        });
      };

      var buttonEl = React.createElement('div', { className: 'pm-sw-btn', onClick: function () { setOpen(!open); }, title: '切换人设' },
        active ? active.name : '人设', ' ▾');

      var dropEl = open && personas.length > 1
        ? React.createElement('div', { className: 'pm-sw-drop' },
            personas.map(function (p) {
              return React.createElement('div', {
                key: p.id,
                className: 'pm-sw-opt' + (p.id === activeId ? ' pm-sw-opt-active' : ''),
                onClick: function () { switchTo(p.id); },
              }, (p.id === activeId ? '● ' : '  ') + p.name);
            }))
        : null;

      return React.createElement('div', { className: 'pm-sw', ref: ref }, buttonEl, dropEl);
    }

    // ──────────────────── 注册 ────────────────────
    var inject = ['slots'];

    function apply(ctx) {
      try {
        var slots = ctx.slots;

        // 设置页面
        slots.inject('settings.section', function () {
          slots.register({ name: 'settings.section', id: 'persona-manager', order: 40, label: '人设' }, PersonaManager);
        });

        // session header 快速切换
        slots.inject('conversation.session.header.utilities', function () {
          slots.register({ name: 'conversation.session.header.utilities', id: 'persona-quick-switch', order: 20 }, PersonaQuickSwitch);
        });
      } catch (err) {
        console.error('[dsh-persona-manager] apply failed:', err);
      }
    }

    exports.name = 'dsh-persona-manager';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
