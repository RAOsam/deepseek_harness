window.__ModuleLoader__.load({
  id: 'dsh-prompt-enhancer',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var API = '/api/prompt-enhance';
    var STORAGE_KEY = 'dsh-enhance-v2';

    function loadConfig() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveConfig(cfg) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    var DEFAULT_MODELS = [
      { id: 'qwen-turbo', name: 'Qwen Turbo', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', desc: '\u5FEB\u901F\u3001\u514D\u8D39\u989D\u5EA6' },
      { id: 'qwen-plus', name: 'Qwen Plus', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', desc: '\u5E73\u8861\u3001\u9AD8\u8D28\u91CF' },
      { id: 'deepseek-flash', name: 'DeepSeek Flash', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'deepseek-v4-flash', desc: '\u5FEB\u901F\u63A8\u7406' },
    ];

    var STYLE_ID = 'dsh-enhance-v10';
    if (typeof document !== 'undefined' && !document.querySelector('[data-plugin-css="' + STYLE_ID + '"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', STYLE_ID);
      style.textContent = [
        '.enh-root{display:flex;flex-direction:column;flex:1;min-height:0;color:var(--dsw-alias-label-primary,#eee);font-size:13px}',
        '.enh-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-toolbar-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);white-space:nowrap}',
        '.enh-modes{display:flex;gap:4px}',
        '.enh-mode{padding:3px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11.5px;cursor:pointer;transition:all .15s;white-space:nowrap}',
        '.enh-mode:hover{background:rgba(164,183,229,.08)}',
        '.enh-mode-active{background:rgba(77,107,254,.15);border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe);color:var(--dsw-alias-label-primary,#eee)}',
        '.enh-model-row{display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-model-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap}',
        '.enh-model-select{flex:1;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:4px 8px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none;cursor:pointer}',
        '.enh-model-btn{font-size:11px;padding:3px 8px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);cursor:pointer;transition:all .15s;white-space:nowrap}',
        '.enh-model-btn:hover{background:rgba(164,183,229,.08)}',
        '.enh-model-btn-ok{color:#34a853;border-color:#34a85366}',
        '.enh-model-btn-err{color:#ff7b72;border-color:#ff7b7266}',
        '.enh-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center}',
        '.enh-modal{background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:8px;width:500px;max-height:80vh;display:flex;flex-direction:column}',
        '.enh-modal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-modal-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}',
        '.enh-modal-close{font-size:18px;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;padding:0 4px}',
        '.enh-modal-body{flex:1;overflow-y:auto;padding:12px 16px}',
        '.enh-modal-footer{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-model-list{display:flex;flex-direction:column;gap:8px}',
        '.enh-model-item{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px}',
        '.enh-model-info{flex:1;min-width:0}',
        '.enh-model-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#eee)}',
        '.enh-model-desc{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);margin-top:2px}',
        '.enh-model-endpoint{font-size:10px;color:var(--dsw-alias-label-tertiary,#666);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.enh-model-actions{display:flex;gap:4px}',
        '.enh-form{display:flex;flex-direction:column;gap:10px;padding:12px 0}',
        '.enh-form-row{display:flex;flex-direction:column;gap:4px}',
        '.enh-form-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#aaa)}',
        '.enh-form-input{width:100%;background:var(--dsw-alias-bg-layer-2,#1c1c1e);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:6px 10px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none;box-sizing:border-box}',
        '.enh-form-input::placeholder{color:var(--dsw-alias-label-tertiary,#555)}',
        '.enh-body{display:flex;flex:1;min-height:0;overflow:hidden}',
        '.enh-input{flex:1;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,#333);overflow:hidden}',
        '.enh-input-header{display:flex;align-items:center;justify-content:space-between;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-input-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#aaa)}',
        '.enh-textarea{flex:1;width:100%;background:transparent;border:none;padding:10px 14px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;outline:none;resize:none;line-height:1.6;box-sizing:border-box}',
        '.enh-textarea::placeholder{color:var(--dsw-alias-label-tertiary,#555)}',
        '.enh-output{flex:1;display:flex;flex-direction:column;overflow:hidden}',
        '.enh-output-header{display:flex;align-items:center;justify-content:space-between;padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333)}',
        '.enh-output-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#aaa)}',
        '.enh-output-content{flex:1;padding:10px 14px;overflow-y:auto;white-space:pre-wrap;line-height:1.6;font-size:13px;color:var(--dsw-alias-label-primary,#eee)}',
        '.enh-output-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#666);font-size:12px}',
        '.enh-btn{padding:3px 10px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11.5px;cursor:pointer;transition:all .15s;white-space:nowrap}',
        '.enh-btn:hover{background:rgba(164,183,229,.1);color:var(--dsw-alias-label-primary,#eee)}',
        '.enh-btn-pri{background:var(--dsw-alias-button-filled-bg,#4d6bfe);color:var(--dsw-alias-button-filled-label,#fff);border-color:transparent}',
        '.enh-btn-pri:hover{opacity:.85;color:#fff}',
        '.enh-btn-pri:disabled{opacity:.5;cursor:not-allowed}',
        '.enh-btn-danger{color:#ff7b72;border-color:#ff7b7266}',
        '.enh-btns{display:flex;gap:4px}',
        '.enh-statusbar{display:flex;align-items:center;gap:6px;padding:5px 14px;border-top:1px solid var(--dsw-alias-border-l1,#333);font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.enh-dot{width:6px;height:6px;border-radius:50%;flex:none}',
        '.enh-dot-ok{background:#34a853}',
        '.enh-dot-loading{background:#4d6bfe;animation:enh-pulse .6s infinite alternate}',
        '@keyframes enh-pulse{to{opacity:.3}}',
        '.enh-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:6px 14px;border-radius:6px;font-size:12px;background:var(--dsw-alias-bg-layer-2,#222);border:1px solid var(--dsw-alias-border-l1,#333);color:var(--dsw-alias-label-primary,#eee);z-index:9999;animation:enh-toast .2s}',
        '@keyframes enh-toast{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
        '.sm-root{display:flex;flex-direction:column;gap:10px}\n.sm-row{display:flex;gap:8px;flex-wrap:wrap}\n.sm-btn{padding:6px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:12px;cursor:pointer;transition:all .15s}\n.sm-btn:hover{background:rgba(164,183,229,.1);color:var(--dsw-alias-label-primary,#eee)}\n.sm-btn-danger{color:#ff7b72;border-color:#ff7b7266}\n.sm-btn-danger:hover{background:#ff7b7218}\n.sm-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);line-height:1.6}'
      ].join('\n');
      document.head.appendChild(style);
    }

    function apiPost(url, body) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(r) { return r.json(); });
    }

    function ModelManager(props) {
      var models = props.models, onSave = props.onSave, onClose = props.onClose;
      var _a = React.useState(models.slice()), editing = _a[0], setEditing = _a[1];
      var _b = React.useState(false), showAdd = _b[0], setShowAdd = _b[1];
      var _c = React.useState({}), nm = _c[0], setNm = _c[1];
      var _d = React.useState(null), testing = _d[0], setTesting = _d[1];
      var _e2 = React.useState(-1), editRow = _e2[0], setEditRow = _e2[1];

      var updateField = function(i, k, v) {
        setEditing(function(p) { var n = p.slice(); n[i] = Object.assign({}, n[i]); n[i][k] = v; return n; });
      };
      var removeModel = function(i) {
        setEditing(function(p) { return p.filter(function(_, j) { return j !== i; }); });
      };
      var addModel = function() {
        if (!nm.name || !nm.model) return;
        var m = Object.assign({}, nm, { id: nm.name.toLowerCase().replace(/[^a-z0-9]/g, '-') });
        setEditing(function(p) { return p.concat([m]); });
        setNm({});
        setShowAdd(false);
      };
      var testModel = function(m, i) {
        setTesting(i);
        apiPost(API + '/test', { model: m.model, endpoint: m.endpoint, apiKey: m.apiKey }).then(function(d) {
          setTesting(null);
          updateField(i, '_testOk', !!d.ok);
          updateField(i, '_testMs', d.ms);
          if (!d.ok) updateField(i, '_testErr', d.error);
        }).catch(function() { setTesting(null); });
      };
      var onInput = function(k) { return function(e) { setNm(function(p) { var n = Object.assign({}, p); n[k] = e.target.value; return n; }); }; };

      return React.createElement('div', { className: 'enh-modal-overlay', onClick: onClose },
        React.createElement('div', { className: 'enh-modal', onClick: function(e) { e.stopPropagation(); } },
          React.createElement('div', { className: 'enh-modal-header' },
            React.createElement('span', { className: 'enh-modal-title' }, '\u6A21\u578B\u7BA1\u7406'),
            React.createElement('span', { className: 'enh-modal-close', onClick: onClose }, '\u00D7')),
          React.createElement('div', { className: 'enh-modal-body' },
            React.createElement('div', { className: 'enh-model-list' },
              editing.map(function(m, i) {
                var tc = 'enh-model-btn' + (m._testOk === true ? ' enh-model-btn-ok' : m._testOk === false ? ' enh-model-btn-err' : '');
                var tl = testing === i ? '...' : m._testOk === true ? 'OK ' + m._testMs + 'ms' : m._testOk === false ? 'FAIL' : 'test';
                return React.createElement(React.Fragment, { key: i },
                  React.createElement('div', { className: 'enh-model-item' },
                  React.createElement('div', { className: 'enh-model-info' },
                    React.createElement('div', { className: 'enh-model-name' }, m.name),
                    React.createElement('div', { className: 'enh-model-desc' }, m.desc || m.model),
                    React.createElement('div', { className: 'enh-model-endpoint' }, (m.endpoint || 'default') + (m.apiKey ? ' \u00B7 key\u5DF2\u8BBE' : ''))),
                  React.createElement('div', { className: 'enh-model-actions' },
                    React.createElement('button', { className: 'enh-model-btn', onClick: function() { setEditRow(editRow === i ? -1 : i); } }, '\u270E'),
                    React.createElement('button', { className: tc, onClick: function() { testModel(m, i); }, disabled: testing === i }, tl),
                    React.createElement('button', { className: 'enh-model-btn enh-btn-danger', onClick: function() { removeModel(i); } }, '\u00D7'))),
                  editRow === i ? React.createElement('div', { className: 'enh-form', style: { padding: '8px 12px', margin: '-4px 0 4px', border: '1px solid var(--dsw-alias-border-l1,#333)', borderRadius: '6px' } },
                    React.createElement('div', { className: 'enh-form-row' },
                      React.createElement('label', { className: 'enh-form-label' }, 'Endpoint'),
                      React.createElement('input', { className: 'enh-form-input', value: m.endpoint || '', onChange: function(e) { updateField(i, 'endpoint', e.target.value); }, placeholder: '\u7559\u7a7a\u7528\u9ed8\u8ba4' })),
                    React.createElement('div', { className: 'enh-form-row' },
                      React.createElement('label', { className: 'enh-form-label' }, 'API Key'),
                      React.createElement('input', { className: 'enh-form-input', type: 'password', value: m.apiKey || '', onChange: function(e) { updateField(i, 'apiKey', e.target.value); }, placeholder: '\u7559\u7a7a\u7528\u5168\u5c40\u9ed8\u8ba4\u5bc6\u94a5' }))) : null);
              })),
            showAdd
              ? React.createElement('div', { className: 'enh-form' },
                  React.createElement('div', { className: 'enh-form-row' },
                    React.createElement('label', { className: 'enh-form-label' }, '\u540D\u79F0'),
                    React.createElement('input', { className: 'enh-form-input', value: nm.name || '', onChange: onInput('name'), placeholder: 'My Model' })),
                  React.createElement('div', { className: 'enh-form-row' },
                    React.createElement('label', { className: 'enh-form-label' }, '\u6A21\u578B ID'),
                    React.createElement('input', { className: 'enh-form-input', value: nm.model || '', onChange: onInput('model'), placeholder: 'qwen-turbo' })),
                  React.createElement('div', { className: 'enh-form-row' },
                    React.createElement('label', { className: 'enh-form-label' }, 'API Endpoint'),
                    React.createElement('input', { className: 'enh-form-input', value: nm.endpoint || '', onChange: onInput('endpoint'), placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })),
                  React.createElement('div', { className: 'enh-form-row' },
                    React.createElement('label', { className: 'enh-form-label' }, 'API Key'),
                    React.createElement('input', { className: 'enh-form-input', type: 'password', value: nm.apiKey || '', onChange: onInput('apiKey'), placeholder: 'sk-...' })),
                  React.createElement('div', { className: 'enh-form-row' },
                    React.createElement('label', { className: 'enh-form-label' }, '\u63CF\u8FF0'),
                    React.createElement('input', { className: 'enh-form-input', value: nm.desc || '', onChange: onInput('desc'), placeholder: '\u5FEB\u901F\u63A8\u7406' })),
                  React.createElement('div', { className: 'enh-btns' },
                    React.createElement('button', { className: 'enh-btn', onClick: function() { setShowAdd(false); setNm({}); } }, '\u53D6\u6D88'),
                    React.createElement('button', { className: 'enh-btn enh-btn-pri', onClick: addModel }, '\u6DFB\u52A0')))
              : React.createElement('button', { className: 'enh-btn', style: { marginTop: '8px' }, onClick: function() { setShowAdd(true); } }, '+ \u6DFB\u52A0\u6A21\u578B')),
          React.createElement('div', { className: 'enh-modal-footer' },
            React.createElement('button', { className: 'enh-btn', onClick: onClose }, '\u53D6\u6D88'),
            React.createElement('button', { className: 'enh-btn enh-btn-pri', onClick: function() { onSave(editing); } }, '\u4FDD\u5B58'))));
    }

    function PromptEnhancer() {
      var saved = loadConfig();
      var _a = React.useState(''), draft = _a[0], setDraft = _a[1];
      var _b = React.useState(saved.mode || 'standard'), mode = _b[0], setMode = _b[1];
      var _c = React.useState(saved.models || DEFAULT_MODELS), models = _c[0], setModels = _c[1];
      var _d = React.useState(saved.selectedModel || 0), selectedIdx = _d[0], setSelectedIdx = _d[1];
      var _e = React.useState(null), result = _e[0], setResult = _e[1];
      var _f = React.useState(false), loading = _f[0], setLoading = _f[1];
      var _g = React.useState(null), toast = _g[0], setToast = _g[1];
      var _h = React.useState(null), backup = _h[0], setBackup = _h[1];
      var _i = React.useState(false), showMgr = _i[0], setShowMgr = _i[1];
      var _j = React.useState(null), conn = _j[0], setConn = _j[1];

      var sel = models[selectedIdx] || models[0];
      var showToast = function(m) { setToast(m); setTimeout(function() { setToast(null); }, 2000); };
      React.useEffect(function() { saveConfig({ mode: mode, models: models, selectedModel: selectedIdx }); }, [mode, models, selectedIdx]);
      React.useEffect(function() {
        if (!sel) return;
        setConn(null);
        apiPost(API + '/test', { model: sel.model, endpoint: sel.endpoint, apiKey: sel.apiKey }).then(function(d) {
          setConn(d);
        }).catch(function() { setConn({ ok: false, error: 'network' }); });
      }, [selectedIdx, models.length]);

      var onEnhance = function() {
        if (!draft.trim() || loading || !sel) return;
        setLoading(true); setBackup(draft);
        apiPost(API, { draft: draft, mode: mode, model: sel.model, endpoint: sel.endpoint, apiKey: sel.apiKey }).then(function(d) {
          setLoading(false);
          if (d.ok) { setResult(d.enhanced); showToast('OK (' + d.model + ')'); }
          else { showToast('FAIL: ' + (d.error || 'unknown')); }
        }).catch(function() { setLoading(false); showToast('error'); });
      };

      var modes = [{ id: 'basic', name: '\u57FA\u7840' }, { id: 'standard', name: '\u6807\u51C6' }, { id: 'expert', name: '\u4E13\u5BB6' }];

      return React.createElement('div', { className: 'enh-root' },
        React.createElement('div', { className: 'enh-toolbar' },
          React.createElement('span', { className: 'enh-toolbar-title' }, '\u63D0\u793A\u8BCD\u589E\u5F3A'),
          React.createElement('div', { className: 'enh-modes' },
            modes.map(function(m) { return React.createElement('div', { key: m.id, className: 'enh-mode' + (mode === m.id ? ' enh-mode-active' : ''), onClick: function() { setMode(m.id); } }, m.name); }))),
        React.createElement('div', { className: 'enh-model-row' },
          React.createElement('span', { className: 'enh-model-label' }, '\u6A21\u578B:'),
          React.createElement('select', { className: 'enh-model-select', value: selectedIdx, onChange: function(e) { setSelectedIdx(Number(e.target.value)); } },
            models.map(function(m, i) { return React.createElement('option', { key: i, value: i }, m.name); })),
          React.createElement('button', { className: 'enh-model-btn', onClick: function() { setShowMgr(true); } }, '\u2699\uFE0F')),
        React.createElement('div', { className: 'enh-body' },
          React.createElement('div', { className: 'enh-input' },
            React.createElement('div', { className: 'enh-input-header' },
              React.createElement('span', { className: 'enh-input-label' }, '\u8F93\u5165\u8349\u7A3F'),
              React.createElement('div', { className: 'enh-btns' },
                React.createElement('button', { className: 'enh-btn', onClick: function() { setDraft(''); setResult(null); setBackup(null); } }, '\u6E05\u7A7A'),
                React.createElement('button', { className: 'enh-btn enh-btn-pri', onClick: onEnhance, disabled: loading || !draft.trim() }, loading ? '\u589E\u5F3A\u4E2D...' : '\u589E\u5F3A'))),
            React.createElement('textarea', { className: 'enh-textarea', value: draft, onChange: function(e) { setDraft(e.target.value); }, placeholder: '\u8F93\u5165\u8981\u4F18\u5316\u7684\u63D0\u793A\u8BCD...', onKeyDown: function(e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onEnhance(); } })),
          React.createElement('div', { className: 'enh-output' },
            React.createElement('div', { className: 'enh-output-header' },
              React.createElement('span', { className: 'enh-output-label' }, '\u589E\u5F3A\u7ED3\u679C'),
              result ? React.createElement('div', { className: 'enh-btns' },
                React.createElement('button', { className: 'enh-btn', onClick: function() { if (backup) { setDraft(backup); setResult(null); setBackup(null); } } }, '\u64A4\u56DE'),
                React.createElement('button', { className: 'enh-btn', onClick: function() { if (result) { navigator.clipboard.writeText(result); showToast('copied'); } } }, '\u590D\u5236'),
                React.createElement('button', { className: 'enh-btn enh-btn-pri', onClick: function() { if (result) { setDraft(result); setResult(null); } } }, '\u66FF\u6362')
              ) : null),
            result ? React.createElement('div', { className: 'enh-output-content' }, result)
              : React.createElement('div', { className: 'enh-output-empty' }, loading ? '\u6B63\u5728\u8C03\u7528...' : '\u7ED3\u679C\u5C06\u663E\u793A\u5728\u8FD9\u91CC'))),
        React.createElement('div', { className: 'enh-statusbar' },
          React.createElement('span', { className: 'enh-dot ' + (loading ? 'enh-dot-loading' : 'enh-dot-ok') }),
          React.createElement('span', null, loading ? '\u589E\u5F3A\u4E2D...' : result ? '\u5B8C\u6210' : '\u5C31\u7EEA'),
          React.createElement('span', { style: { marginLeft: 'auto', display:'inline-flex', alignItems:'center', gap:4 } },
          React.createElement('span', { style: { width:7, height:7, borderRadius:'50%', background: conn ? (conn.ok ? '#34a853' : '#ff7b72') : '#888' } }),
          React.createElement('span', null, conn ? (conn.ok ? conn.model + ' OK ' + conn.ms + 'ms' : conn.model + ' FAIL') : '\u68C0\u6D4B\u4E2D...'),
          React.createElement('span', { style: { opacity:.5 } }, ' | ' + mode)),
          React.createElement('span', null, 'Ctrl+Enter')),
        showMgr ? React.createElement(ModelManager, { models: models, onSave: function(m) { setModels(m); setShowMgr(false); showToast('\u4FDD\u5B58\u6210\u529F'); }, onClose: function() { setShowMgr(false); } }) : null,
        toast ? React.createElement('div', { className: 'enh-toast' }, toast) : null);
    }

    function SafeModePanel() {
      var _a = React.useState(null), status = _a[0], setStatus = _a[1];
      var _b = React.useState(false), busy = _b[0], setBusy = _b[1];

      var showToast = function(msg) { setStatus(msg); setTimeout(function(){ setStatus(null); }, 2500); };

      var postAction = function(action) {
        setBusy(true);
        apiPost('/api/safe-mode', { action: action }).then(function(d) {
          setBusy(false);
          if (d.ok) showToast(d.message || 'OK');
          else showToast('FAIL: ' + (d.error || 'unknown'));
        }).catch(function() { setBusy(false); showToast('error'); });
      };

      return React.createElement('div', { className: 'sm-root' },
        React.createElement('div', { className: 'sm-hint' }, '\u7528\u4E8E\u63D2\u4EF6\u5D29\u6E83\u65F6\u5FEB\u901F\u6062\u590D\uFF0C\u4E0D\u9700\u8981\u624B\u52A8\u7F16\u8F91\u914D\u7F6E\u6587\u4EF6'),
        React.createElement('div', { className: 'sm-row' },
          React.createElement('button', { className: 'sm-btn sm-btn-danger', disabled: busy, onClick: function(){ postAction('safe'); } }, '\u542F\u52A8\u5B89\u5168\u6A21\u5F0F'),
          React.createElement('button', { className: 'sm-btn', disabled: busy, onClick: function(){ postAction('restore'); } }, '\u6062\u590D\u6B63\u5E38\u6A21\u5F0F')),
        React.createElement('div', { className: 'sm-hint' },
          '\u2022 \u5B89\u5168\u6A21\u5F0F\uFF1A\u7981\u7528\u6240\u6709\u975E\u6838\u5FC3\u63D2\u4EF6\uFF0C\u4EC5\u4FDD\u7559\u57FA\u7840\u529F\u80FD\n\u2022 \u6062\u590D\u6A21\u5F0F\uFF1A\u4ECE\u5907\u4EFD\u6062\u590D\u6240\u6709\u63D2\u4EF6\u914D\u7F6E\n\u2022 \u64CD\u4F5C\u540E\u9700\u8981\u91CD\u542F DSH \u670D\u52A1'),
        status ? React.createElement('div', { className: 'sm-hint', style:{ color: status.startsWith('FAIL') || status.startsWith('error') ? '#ff7b72' : '#34a853' } }, status) : null);
    }

    var inject = ['slots'];
    function apply(ctx) {
      try {
        var slots = ctx.slots;
        slots.inject('settings.section', function() {
          slots.register({ name: 'settings.section', id: 'prompt-enhancer', order: 55, label: '\u63D0\u793A\u8BCD\u589E\u5F3A' }, PromptEnhancer);
        });
      } catch (err) { console.error('[dsh-prompt-enhancer] apply failed:', err); }
    }

    exports.name = 'dsh-prompt-enhancer';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});