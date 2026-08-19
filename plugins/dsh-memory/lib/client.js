// dsh-memory — browser half.
// 设置页面「记忆」：记忆列表 + 编辑器 + 搜索/筛选。
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var API = '/api/memories';

    // 样式注入（复用 dsh-persona-manager 的风格）
    var STYLE_ID = 'dsh-memory';
    if (typeof document !== 'undefined' && !document.querySelector('[data-plugin-css="' + STYLE_ID + '"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', STYLE_ID);
      style.textContent = [
        '.mm-root{display:flex;flex:1;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary,#eee);font-size:13px}',
        '.mm-list{width:240px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,#333);overflow:hidden}',
        '.mm-list-header{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);display:flex;gap:4px}',
        '.mm-list-header input{flex:1;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:4px 8px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none}',
        '.mm-list-header select{background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:4px 6px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none}',
        '.mm-items{flex:1;overflow-y:auto;padding:4px 0}',
        '.mm-item{padding:6px 10px;cursor:pointer;border-radius:4px;margin:0 4px}',
        '.mm-item:hover{background:rgba(164,183,229,.12)}',
        '.mm-item-active{background:rgba(197,164,104,.18)}',
        '.mm-item-cat{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);margin-right:4px}',
        '.mm-item-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}',
        '.mm-item-imp{font-size:10px;color:var(--dsw-alias-label-tertiary,#888);float:right}',
        '.mm-add{margin:8px 8px;padding:6px;text-align:center;border:1px dashed var(--dsw-alias-border-l2,#444);border-radius:4px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#999)}',
        '.mm-add:hover{background:rgba(164,183,229,.12);color:var(--dsw-alias-label-primary,#eee)}',
        '.mm-editor{flex:1;display:flex;flex-direction:column;padding:12px 16px;overflow-y:auto;gap:10px}',
        '.mm-field label{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#999);margin-bottom:3px;font-weight:600}',
        '.mm-field input,.mm-field textarea,.mm-field select{width:100%;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:4px;padding:6px 8px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box}',
        '.mm-field input:focus,.mm-field textarea:focus{border-color:var(--dsw-alias-interactive-bg-active,#4d6bfe)}',
        '.mm-field textarea{min-height:100px;resize:vertical;line-height:1.5}',
        '.mm-btns{display:flex;gap:8px;flex:none;padding-top:4px}',
        '.mm-btn{padding:6px 14px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:12px;cursor:pointer}',
        '.mm-btn:hover{background:rgba(164,183,229,.12)}',
        '.mm-btn-pri{background:var(--dsw-alias-button-filled-bg,#4d6bfe);color:var(--dsw-alias-button-filled-label,#fff);border-color:transparent}',
        '.mm-btn-pri:hover{opacity:.85}',
        '.mm-btn-danger{color:#ff7b72;border-color:#ff7b7266}',
        '.mm-btn-danger:hover{background:#ff7b7218}',
        '.mm-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#888);font-size:12px}',
        '.mm-imp{display:flex;gap:4px;align-items:center}',
        '.mm-imp input[type=range]{flex:1}',
        '.mm-imp span{font-size:12px;color:var(--dsw-alias-label-secondary,#999);min-width:20px;text-align:center}',
      ].join('\n');
      document.head.appendChild(style);
    }

    // API 辅助
    function apiGet(url) { return fetch(url).then(function (r) { return r.json(); }); }
    function apiPost(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiPut(url, body) { return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiDelete(url) { return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); }); }

    function getMemories() { return apiGet(API); }
    function createMemory(data) { return apiPost(API + '/create', data); }
    function updateMemory(id, data) { return apiPut(API + '/update?id=' + encodeURIComponent(id), data); }
    function deleteMemory(id) { return apiDelete(API + '/delete?id=' + encodeURIComponent(id)); }

    // 分类标签
    var CATEGORY_LABELS = { preference: '偏好', fact: '信息', event: '事件', rule: '规则', context: '背景' };

    function MemoryList(props) {
      var memories = props.memories, search = props.search, category = props.category;
      var selectedId = props.selectedId, onSelect = props.onSelect, onAdd = props.onAdd;
      var onSearch = props.onSearch, onCategory = props.onCategory;
      var filtered = memories.filter(function (m) {
        if (category && m.category !== category) return false;
        if (search && m.content.toLowerCase().indexOf(search.toLowerCase()) < 0) return false;
        return true;
      });
      return React.createElement('div', { className: 'mm-list' },
        React.createElement('div', { className: 'mm-list-header' },
          React.createElement('input', { type: 'text', placeholder: '搜索记忆...', value: search, onChange: function (e) { onSearch(e.target.value); } }),
          React.createElement('select', { value: category, onChange: function (e) { onCategory(e.target.value); } },
            React.createElement('option', { value: '' }, '全部'),
            Object.keys(CATEGORY_LABELS).map(function (k) {
              return React.createElement('option', { key: k, value: k }, CATEGORY_LABELS[k]);
            }))),
        React.createElement('div', { className: 'mm-items' },
          filtered.map(function (m) {
            return React.createElement('div', {
              key: m.id,
              className: 'mm-item' + (m.id === selectedId ? ' mm-item-active' : ''),
              onClick: function () { onSelect(m.id); },
            },
              React.createElement('span', { className: 'mm-item-cat' }, CATEGORY_LABELS[m.category] || m.category),
              React.createElement('span', { className: 'mm-item-imp' }, '★' + m.importance),
              React.createElement('div', { className: 'mm-item-text' }, m.content));
          })),
        React.createElement('div', { className: 'mm-add', onClick: onAdd }, '+ 新建记忆'));
    }

    function MemoryEditor(props) {
      var memory = props.memory;
      var onSave = props.onSave, onDelete = props.onDelete, onChange = props.onChange;
      var content = memory.content, category = memory.category, importance = memory.importance, tags = memory.tags || [];
      var tagsStr = tags.join(', ');
      return React.createElement('div', { className: 'mm-editor' },
        React.createElement('div', { className: 'mm-field' },
          React.createElement('label', null, '内容'),
          React.createElement('textarea', { value: content, onChange: function (e) { onChange({ content: e.target.value }); }, placeholder: '记录需要 AI 记住的信息...' })),
        React.createElement('div', { className: 'mm-field' },
          React.createElement('label', null, '分类'),
          React.createElement('select', { value: category, onChange: function (e) { onChange({ category: e.target.value }); } },
            Object.keys(CATEGORY_LABELS).map(function (k) {
              return React.createElement('option', { key: k, value: k }, CATEGORY_LABELS[k]);
            }))),
        React.createElement('div', { className: 'mm-field' },
          React.createElement('label', null, '重要性 (' + importance + '/10)'),
          React.createElement('div', { className: 'mm-imp' },
            React.createElement('span', null, '1'),
            React.createElement('input', { type: 'range', min: '1', max: '10', value: String(importance), onChange: function (e) { onChange({ importance: Number(e.target.value) }); } }),
            React.createElement('span', null, '10'))),
        React.createElement('div', { className: 'mm-field' },
          React.createElement('label', null, '标签（逗号分隔）'),
          React.createElement('input', { type: 'text', value: tagsStr, onChange: function (e) { onChange({ tags: e.target.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) }); }, placeholder: '标签1, 标签2' })),
        React.createElement('div', { className: 'mm-btns' },
          React.createElement('button', { className: 'mm-btn mm-btn-pri', onClick: onSave }, '保存'),
          React.createElement('button', { className: 'mm-btn mm-btn-danger', onClick: onDelete }, '删除')));
    }

    function MemoryManager() {
      var _a = React.useState([]), memories = _a[0], setMemories = _a[1];
      var _b = React.useState(null), selectedId = _b[0], setSelectedId = _b[1];
      var _c = React.useState({}), draft = _c[0], setDraft = _c[1];
      var _d = React.useState(''), search = _d[0], setSearch = _d[1];
      var _e = React.useState(''), category = _e[0], setCategory = _e[1];
      var _f = React.useState(''), msg = _f[0], setMsg = _f[1];

      var refresh = React.useCallback(function () {
        getMemories().then(function (data) {
          if (data.ok) setMemories(data.memories);
        });
      }, []);
      React.useEffect(function () { refresh(); }, [refresh]);

      var selected = memories.find(function (m) { return m.id === selectedId; }) || null;
      var editDraft = selected ? {
        content: draft.content !== undefined ? draft.content : selected.content,
        category: draft.category !== undefined ? draft.category : selected.category,
        importance: draft.importance !== undefined ? draft.importance : selected.importance,
        tags: draft.tags !== undefined ? draft.tags : (selected.tags || []),
      } : null;

      var onSelect = function (id) { setSelectedId(id); setDraft({}); setMsg(''); };
      var onDraftChange = function (fields) { setDraft(function (prev) { return Object.assign({}, prev, fields); }); };

      var onAdd = function () {
        createMemory({ content: '新记忆', category: 'fact', importance: 5 }).then(function (res) {
          if (res.ok) { refresh(); setSelectedId(res.memory.id); setDraft({}); setMsg('已创建'); }
        });
      };

      var onSave = function () {
        if (!selected) return;
        var data = {};
        if (draft.content !== undefined) data.content = draft.content;
        if (draft.category !== undefined) data.category = draft.category;
        if (draft.importance !== undefined) data.importance = draft.importance;
        if (draft.tags !== undefined) data.tags = draft.tags;
        updateMemory(selected.id, data).then(function (res) {
          if (res.ok) { refresh(); setDraft({}); setMsg('已保存'); }
        });
      };

      var onDelete = function () {
        if (!selected) return;
        deleteMemory(selected.id).then(function (res) {
          if (res.ok) { refresh(); setSelectedId(null); setDraft({}); setMsg('已删除'); }
        });
      };

      return React.createElement('div', { className: 'mm-root' },
        React.createElement(MemoryList, { memories: memories, search: search, category: category, selectedId: selectedId, onSelect: onSelect, onAdd: onAdd, onSearch: setSearch, onCategory: setCategory }),
        selected
          ? React.createElement(MemoryEditor, { memory: editDraft, onSave: onSave, onDelete: onDelete, onChange: onDraftChange })
          : React.createElement('div', { className: 'mm-empty' }, msg || '选择一条记忆，或点击「+ 新建记忆」'));
    }

    // 注册
    var inject = ['slots'];

    function apply(ctx) {
      try {
        var slots = ctx.slots;

        // 设置页面
        slots.inject('settings.section', function () {
          slots.register({ name: 'settings.section', id: 'memory-manager', order: 50, label: '记忆' }, MemoryManager);
        });
      } catch (err) {
        console.error('[dsh-memory] apply failed:', err);
      }
    }

    exports.name = 'dsh-memory';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
