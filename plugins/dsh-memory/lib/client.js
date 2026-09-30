// dsh-memory — browser half.
// 卡片式记忆管理 + 图片识别。
window.__ModuleLoader__.load({
  id: 'dsh-memory',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');

    var API = '/api/memories';

    // 分类色改用官方 static 色板令牌（原为写死的 hex）。
    // 注意两点：
    //  1. 官方色板没有紫色系，event 只能用唯一的 violet 令牌 --dsh-file-type-violet，
    //     并保留原 #7c5cfc 作为回退；若该令牌未定义则外观与改动前完全一致。
    //  2. 底色/描边原先用 cat.color + '22' / + '44' 做十六进制拼接，
    //     这使 cat.color 无法是 var()（会拼出非法 CSS）。已改写为 color-mix()，
    //     百分比取自原 alpha：0x22 ≈ 13%、0x44 ≈ 27%。
    var CATEGORIES = {
      preference: { icon: '\u2B50', label: '\u504F\u597D', color: 'var(--dsw-static-amber-500, #f0c040)' },
      fact:       { icon: '\u2139\uFE0F', label: '\u4FE1\u606F', color: 'var(--dsw-static-blue-500, #4d6bfe)' },
      event:      { icon: '\uD83D\uDCC5', label: '\u4E8B\u4EF6', color: 'var(--dsh-file-type-violet, #7c5cfc)' },
      rule:       { icon: '\uD83D\uDEE1\uFE0F', label: '\u89C4\u5219', color: 'var(--dsw-static-green-500, #34a853)' },
      context:    { icon: '\uD83D\uDD0D', label: '\u80CC\u666F', color: 'var(--dsw-static-amber-600, #ea8c00)' },
    };

    var STYLE_ID = 'dsh-memory-v2';
    if (typeof document !== 'undefined' && !document.querySelector('[data-plugin-css="' + STYLE_ID + '"]')) {
      var style = document.createElement('style');
      style.setAttribute('data-plugin-css', STYLE_ID);
      style.textContent = [
        '.mmv2-root{display:flex;flex-direction:column;flex:1;min-height:0;max-height:100%;overflow:hidden;color:var(--dsw-alias-label-primary,#eee);font-size:13px}',
        '.mmv2-toolbar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);flex-wrap:wrap}',
        '.mmv2-toolbar-title{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#eee);margin-right:4px;white-space:nowrap}',
        '.mmv2-search{flex:1;min-width:120px;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:6px 10px;color:var(--dsw-alias-label-primary,#eee);font-size:12px;outline:none;transition:border-color .15s}',
        '.mmv2-search:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
        '.mmv2-search::placeholder{color:var(--dsw-alias-label-tertiary,#555)}',
        '.mmv2-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11.5px;cursor:pointer;white-space:nowrap;transition:all .15s}',
        '.mmv2-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary,#eee)}',
        '.mmv2-btn-pri{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}',
        '.mmv2-btn-pri:hover{background:var(--dsw-alias-button-primary-hover)}',
        '.mmv2-cats{display:flex;gap:4px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#333);flex-wrap:wrap}',
        '.mmv2-cat{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-secondary,#aaa);font-size:11.5px;cursor:pointer;transition:all .15s}',
        '.mmv2-cat:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.mmv2-cat-active{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-label-primary,#eee)}',
        '.mmv2-cat-dot{width:6px;height:6px;border-radius:50%;display:inline-block}',
        '.mmv2-cat-count{font-size:10px;color:var(--dsw-alias-label-tertiary,#666);margin-left:2px}',
        '.mmv2-body{display:flex;flex:1;min-height:0;max-height:100%;overflow:hidden}',
        '.mmv2-list{width:280px;flex:none;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1,#333);min-height:0;overflow:hidden}',
        '.mmv2-list-scroll{flex:1;min-height:0;padding:0}',
        '.mmv2-card{display:flex;flex-direction:column;gap:4px;padding:10px 12px;margin-bottom:4px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:all .12s}',
        '.mmv2-card:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2,#333)}',
        '.mmv2-card-active{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
        '.mmv2-card-top{display:flex;align-items:center;gap:6px}',
        '.mmv2-card-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;line-height:1.6}',
        '.mmv2-card-imp{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);margin-left:auto}',
        '.mmv2-card-text{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary,#ddd);overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}',
        '.mmv2-card-tags{display:flex;gap:3px;flex-wrap:wrap;margin-top:2px}',
        '.mmv2-card-tag{font-size:10px;padding:0 5px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary,#888)}',
        '.mmv2-card-meta{font-size:10px;color:var(--dsw-alias-label-tertiary,#555);display:flex;gap:8px;margin-top:2px}',
        '.mmv2-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#666);font-size:12px;gap:6px;padding:20px}',
        '.mmv2-empty-icon{font-size:32px;opacity:.4}',
        '.mmv2-editor{flex:1;display:flex;flex-direction:column;padding:14px 18px;overflow-y:auto;gap:12px;min-height:0}',
        '.mmv2-field{display:flex;flex-direction:column;gap:4px}',
        '.mmv2-field label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#999)}',
        '.mmv2-field input,.mmv2-field textarea,.mmv2-field select{width:100%;background:var(--dsw-alias-bg-layer-1,#161618);border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:7px 10px;color:var(--dsw-alias-label-primary,#eee);font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;transition:border-color .15s}',
        '.mmv2-field input:focus,.mmv2-field textarea:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
        '.mmv2-field textarea{min-height:120px;resize:vertical;line-height:1.6}',
        '.mmv2-imp-row{display:flex;align-items:center;gap:8px}',
        '.mmv2-imp-row input[type=range]{flex:1;accent-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
        '.mmv2-imp-row span{font-size:12px;color:var(--dsw-alias-label-secondary,#999);min-width:24px;text-align:center}',
        '.mmv2-btns{display:flex;gap:8px;flex:none;padding-top:6px}',
        '.mmv2-btn-save{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}',
        '.mmv2-btn-save:hover{background:var(--dsw-alias-button-primary-hover)}',
        '.mmv2-btn-del{color:var(--dsw-alias-state-error-primary,#ff7b72);border-color:var(--dsw-alias-state-error-secondary,#ff7b7266)}',
        '.mmv2-btn-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger,#ff7b7218)}',
        '.mmv2-virtual-spacer{}',
        '.mmv2-group-header{display:flex;align-items:center;gap:6px;padding:6px 8px;margin:8px 0 4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#aaa);border-bottom:1px solid var(--dsw-alias-border-l1,#333);background:transparent}',
        '.mmv2-group-dot{width:8px;height:8px;border-radius:50%;flex:none}',
        '.mmv2-group-count{font-size:10px;color:var(--dsw-alias-label-tertiary,#666);margin-left:auto}',
        '.mmv2-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:8px;font-size:12px;background:var(--dsw-alias-toast-bg,#222);border:1px solid var(--dsw-alias-border-inverted,#333);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary,#eee);z-index:9999;animation:mmv2-fade .25s}',
        '@keyframes mmv2-fade{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
        '.mmv2-vision-zone{margin-top:4px;padding:8px;border:1px dashed var(--dsw-alias-border-l2,#444);border-radius:6px;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;transition:all .15s}',
        '.mmv2-vision-zone:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
        '.mmv2-vision-zone.dragover{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--dsw-alias-brand-primary,#4d6bfe)}',
        '.mmv2-vision-preview{max-width:100%;max-height:120px;border-radius:4px;margin-top:4px}',
        '.mmv2-vision-loading{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary,#888)}',
        '.mmv2-vision-loading:after{content:"";width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2,#444);border-top-color:var(--dsw-alias-state-business-primary,#4d6bfe);border-radius:50%;animation:mmv2-spin .6s linear infinite}',
        '@keyframes mmv2-spin{to{transform:rotate(360deg)}}',
      ].join('\n');
      document.head.appendChild(style);
    }

    function apiGet(url) { return fetch(url).then(function (r) { return r.json(); }); }
    function apiPost(url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiPut(url, body) { return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    function apiDelete(url) { return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); }); }
    function apiVision(url, base64, mime) {
      return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: base64, mime: mime }) }).then(function (r) { return r.json(); });
    }

    function getMemories() { return apiGet(API); }
    function createMemory(data) { return apiPost(API + '/create', data); }
    function updateMemory(id, data) { return apiPut(API + '/update?id=' + encodeURIComponent(id), data); }
    function deleteMemory(id) { return apiDelete(API + '/delete?id=' + encodeURIComponent(id)); }
    function consolidateMemories() { return apiPost(API + '/consolidate', {}); }
    function analyzeImage(file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var base64 = reader.result.split(',')[1];
          apiVision(API + '/vision', base64, file.type).then(resolve).catch(reject);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function CategoryBar(props) {
      var cats = props.cats, active = props.active, onSelect = props.onSelect, counts = props.counts;
      var total = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0);
      return React.createElement('div', { className: 'mmv2-cats' },
        React.createElement('div', {
          className: 'mmv2-cat' + (!active ? ' mmv2-cat-active' : ''),
          onClick: function () { onSelect(''); }
        }, '\u5168\u90E8', React.createElement('span', { className: 'mmv2-cat-count' }, '(' + total + ')')),
        Object.keys(cats).map(function (k) {
          var c = cats[k];
          return React.createElement('div', {
            key: k,
            className: 'mmv2-cat' + (active === k ? ' mmv2-cat-active' : ''),
            onClick: function () { onSelect(k); }
          },
            React.createElement('span', { className: 'mmv2-cat-dot', style: { backgroundColor: c.color } }),
            c.label,
            counts[k] ? React.createElement('span', { className: 'mmv2-cat-count' }, '(' + counts[k] + ')') : null);
        })
      );
    }

    // ── 简单列表组件 ──
    // 直接渲染所有卡片与分组头（记忆数量有限，无需虚拟滚动）
    function MemoryList(props) {
      var items = props.items, selectedId = props.selectedId, onSelect = props.onSelect, grouped = props.grouped;
      var listItems = grouped && grouped.length > 0 ? grouped : items.map(function(m){ return {type:'item', item:m}; });

      // 当选中项变化时，滚动到选中项
      React.useEffect(function () {
        if (!selectedId) return;
        var target = document.querySelector('[data-memory-id="' + selectedId + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, [selectedId]);

      return React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', minHeight: 0, maxHeight: '100%', padding: '4px 6px' }
      },
        listItems.map(function (entry) {
          if (entry.type === 'header') {
            var cat = CATEGORIES[entry.category] || { icon: '?', label: entry.category, color: 'var(--dsw-alias-label-tertiary, #888)' };
            return React.createElement('div', { key: 'h-' + entry.category, className: 'mmv2-group-header' },
              React.createElement('span', { className: 'mmv2-group-dot', style: { backgroundColor: cat.color } }),
              cat.icon + ' ' + cat.label,
              React.createElement('span', { className: 'mmv2-group-count' }, entry.count));
          }
          var m = entry.item;
          return React.createElement(MemoryCard, {
            key: m.id,
            m: m,
            active: m.id === selectedId,
            onClick: function () { onSelect(m.id); },
            'data-memory-id': m.id
          });
        })
      );
    }

    function MemoryCard(props) {
      var m = props.m, active = props.active, onClick = props.onClick;
      var memId = props['data-memory-id'];
      var cat = CATEGORIES[m.category] || { icon: '?', label: m.category, color: 'var(--dsw-alias-label-tertiary, #888)' };
      var preview = m.content.length > 100 ? m.content.slice(0, 100) + '...' : m.content;
      return React.createElement('div', {
        className: 'mmv2-card' + (active ? ' mmv2-card-active' : ''),
        onClick: onClick,
        'data-memory-id': memId
      },
        React.createElement('div', { className: 'mmv2-card-top' },
          React.createElement('span', {
            className: 'mmv2-card-badge',
            style: { backgroundColor: 'color-mix(in srgb, ' + cat.color + ' 13%, transparent)', color: cat.color, border: '1px solid color-mix(in srgb, ' + cat.color + ' 27%, transparent)' }
          }, cat.icon + ' ' + cat.label),
          React.createElement('span', { className: 'mmv2-card-imp' }, '\u2B50' + (m.importance || 5))),
        React.createElement('div', { className: 'mmv2-card-text' }, preview),
        m.tags && m.tags.length > 0
          ? React.createElement('div', { className: 'mmv2-card-tags' },
              m.tags.slice(0, 3).map(function (t) { return React.createElement('span', { key: t, className: 'mmv2-card-tag' }, t); }))
          : null,
        React.createElement('div', { className: 'mmv2-card-meta' },
          React.createElement('span', null, '\uD83D\uDC41 ' + (m.accessCount || 0) + ' \u6B21'),
          m.lastAccessedAt ? React.createElement('span', null, '\uD83D\uDD52 ' + m.lastAccessedAt.slice(0, 10)) : null));
    }

    function MemoryEditor(props) {
      var memory = props.memory, onSave = props.onSave, onDelete = props.onDelete, onChange = props.onChange;
      var content = memory.content, category = memory.category, importance = memory.importance, tags = memory.tags || [];
      var tagsStr = tags.join(', ');
      var _a = React.useState(null), visionImg = _a[0], setVisionImg = _a[1];
      var _b = React.useState(false), visionLoading = _b[0], setVisionLoading = _b[1];
      var fileInputRef = React.useRef(null);

      var handleVisionFile = function (file) {
        setVisionImg(URL.createObjectURL(file));
        setVisionLoading(true);
        analyzeImage(file).then(function (res) {
          setVisionLoading(false);
          if (res.ok && res.text) {
            onChange({ content: (content ? content + '\n\n' : '') + '\u3010\u56FE\u7247\u8BC6\u522B\u3011' + res.text });
          }
        }).catch(function () { setVisionLoading(false); });
      };

      var handlePaste = React.useCallback(function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') === 0) {
            e.preventDefault();
            var file = items[i].getAsFile();
            if (file) handleVisionFile(file);
            return;
          }
        }
      }, []);

      var handleDrop = React.useCallback(function (e) {
        e.preventDefault();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0 && files[0].type.indexOf('image') === 0) {
          handleVisionFile(files[0]);
        }
      }, []);

      return React.createElement('div', { className: 'mmv2-editor', onPaste: handlePaste, onDrop: handleDrop, onDragOver: function (e) { e.preventDefault(); } },
        React.createElement('div', { className: 'mmv2-field' },
          React.createElement('label', null, '\u5185\u5BB9'),
          React.createElement('textarea', {
            value: content,
            onChange: function (e) { onChange({ content: e.target.value }); },
            placeholder: '\u8BB0\u5F55\u9700\u8981 AI \u8BB0\u4F4F\u7684\u4FE1\u606F...\n\u53EF\u7C98\u8D34\u56FE\u7247\u81EA\u52A8\u8BC6\u522B'
          })),
        React.createElement('div', { className: 'mmv2-vision-zone', onClick: function () { fileInputRef.current && fileInputRef.current.click(); } },
          visionLoading
            ? React.createElement('span', { className: 'mmv2-vision-loading' }, '\u6B63\u5728\u8BC6\u522B...')
            : visionImg
              ? '\u2705 \u56FE\u7247\u5DF2\u8BC6\u522B'
              : '\uD83D\uDCF7 \u7C98\u8D34\u6216\u4E0A\u4F20\u56FE\u7247\uFF0C\u81EA\u52A8\u8BC6\u522B\u5185\u5BB9'),
        visionImg ? React.createElement('img', { className: 'mmv2-vision-preview', src: visionImg }) : null,
        React.createElement('input', { ref: fileInputRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: function (e) { var file = e.target.files && e.target.files[0]; if (file) handleVisionFile(file); } }),
        React.createElement('div', { className: 'mmv2-field' },
          React.createElement('label', null, '\u5206\u7C7B'),
          React.createElement('select', { value: category, onChange: function (e) { onChange({ category: e.target.value }); } },
            Object.keys(CATEGORIES).map(function (k) { return React.createElement('option', { key: k, value: k }, CATEGORIES[k].icon + ' ' + CATEGORIES[k].label); }))),
        React.createElement('div', { className: 'mmv2-field' },
          React.createElement('label', null, '\u91CD\u8981\u6027 (' + (importance || 5) + '/10)'),
          React.createElement('div', { className: 'mmv2-imp-row' },
            React.createElement('span', null, '\u2B50'),
            React.createElement('input', { type: 'range', min: '1', max: '10', value: String(importance || 5), onChange: function (e) { onChange({ importance: Number(e.target.value) }); } }),
            React.createElement('span', null, importance || 5))),
        React.createElement('div', { className: 'mmv2-field' },
          React.createElement('label', null, '\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF09'),
          React.createElement('input', { type: 'text', value: tagsStr, onChange: function (e) { onChange({ tags: e.target.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean) }); }, placeholder: '\u6807\u7B7E1, \u6807\u7B7E2' })),
        React.createElement('div', { className: 'mmv2-btns' },
          React.createElement('button', { className: 'mmv2-btn mmv2-btn-save', onClick: onSave }, '\uD83D\uDCBE \u4FDD\u5B58'),
          React.createElement('button', { className: 'mmv2-btn mmv2-btn-del', onClick: onDelete }, '\uD83D\uDDD1\uFE0F \u5220\u9664')));
    }

    function MemoryManager() {
      var _a = React.useState([]), memories = _a[0], setMemories = _a[1];
      var _b = React.useState(null), selectedId = _b[0], setSelectedId = _b[1];
      var _c = React.useState({}), draft = _c[0], setDraft = _c[1];
      var _d = React.useState(''), search = _d[0], setSearch = _d[1];
      var _e = React.useState(''), filterCat = _e[0], setFilterCat = _e[1];
      var _f = React.useState(null), toast = _f[0], setToast = _f[1];

      var showToast = function (msg) { setToast(msg); setTimeout(function () { setToast(null); }, 2000); };
      var refresh = React.useCallback(function () { getMemories().then(function (data) { if (data.ok) setMemories(data.memories); }); }, []);
      React.useEffect(function () { refresh(); }, [refresh]);

      var filtered = memories.filter(function (m) {
        if (filterCat && m.category !== filterCat) return false;
        if (search) { var q = search.toLowerCase(); return m.content.toLowerCase().indexOf(q) >= 0 || (m.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; }); }
        return true;
      });
      var catCounts = {}; memories.forEach(function (m) { catCounts[m.category] = (catCounts[m.category] || 0) + 1; });
      // Group filtered items by category
      var grouped = [];
      var seenCats = {};
      filtered.forEach(function (m) {
        if (!seenCats[m.category]) {
          seenCats[m.category] = true;
          var catItems = filtered.filter(function (x) { return x.category === m.category; });
          grouped.push({ type: 'header', category: m.category, count: catItems.length });
          catItems.forEach(function (item) { grouped.push({ type: 'item', item: item }); });
        }
      });

      var selected = memories.find(function (m) { return m.id === selectedId; }) || null;
      var editDraft = selected ? { content: draft.content !== undefined ? draft.content : selected.content, category: draft.category !== undefined ? draft.category : selected.category, importance: draft.importance !== undefined ? draft.importance : selected.importance, tags: draft.tags !== undefined ? draft.tags : (selected.tags || []) } : null;

      var onSelect = function (id) { setSelectedId(id); setDraft({}); };
      var onDraftChange = function (fields) { setDraft(function (prev) { return Object.assign({}, prev, fields); }); };
      var onAdd = function () { createMemory({ content: '\u65B0\u8BB0\u5FC6', category: 'fact', importance: 5 }).then(function (res) { if (res.ok) { refresh(); setSelectedId(res.memory.id); setDraft({}); showToast('\u2705 \u5DF2\u521B\u5EFA'); } }); };
      var onSave = function () { if (!selected) return; var data = {}; if (draft.content !== undefined) data.content = draft.content; if (draft.category !== undefined) data.category = draft.category; if (draft.importance !== undefined) data.importance = draft.importance; if (draft.tags !== undefined) data.tags = draft.tags; updateMemory(selected.id, data).then(function (res) { if (res.ok) { refresh(); setDraft({}); showToast('\u2705 \u5DF2\u4FDD\u5B58'); } }); };
      var onDelete = function () { if (!selected) return; deleteMemory(selected.id).then(function (res) { if (res.ok) { refresh(); setSelectedId(null); setDraft({}); showToast('\u2705 \u5DF2\u5220\u9664'); } }); };
      var _cons = React.useState(null), preview = _cons[0], setPreview = _cons[1];
      var onConsolidatePreview = function () { apiGet(API + '/consolidate/preview').then(function (d) { if (d.ok) setPreview(d.candidates || []); }); };
      var onConsolidateApply = function () { consolidateMemories().then(function (res) { if (res.ok) { refresh(); setPreview(null); showToast('\u2705 ' + res.before + ' \u2192 ' + res.after + ' \u6761'); } }); };

      return React.createElement('div', { className: 'mmv2-root' },
        React.createElement('div', { className: 'mmv2-toolbar' },
          React.createElement('span', { className: 'mmv2-toolbar-title' }, '\uD83E\uDDE0 \u8BB0\u5FC6\u5E93'),
          React.createElement('input', { className: 'mmv2-search', type: 'text', placeholder: '\u641C\u7D22...', value: search, onChange: function (e) { setSearch(e.target.value); } }),
          React.createElement('button', { className: 'mmv2-btn', onClick: onConsolidatePreview }, '\u2728 \u6574\u7406'),
          React.createElement('button', { className: 'mmv2-btn mmv2-btn-pri', onClick: onAdd }, '+ \u65B0\u5EFA')),
        React.createElement(CategoryBar, { cats: CATEGORIES, active: filterCat, onSelect: setFilterCat, counts: catCounts }),
        React.createElement('div', { className: 'mmv2-body' },
          React.createElement('div', { className: 'mmv2-list' },
            React.createElement('div', { className: 'mmv2-list-scroll' },
              filtered.length === 0
                ? React.createElement('div', { className: 'mmv2-empty' }, React.createElement('div', { className: 'mmv2-empty-icon' }, '\uD83D\uDCDD'), '\u6682\u65E0\u8BB0\u5FC6')
                : React.createElement(MemoryList, { items: filtered, selectedId: selectedId, onSelect: onSelect, grouped: grouped }))),
          selected && editDraft
            ? React.createElement(MemoryEditor, { memory: editDraft, onSave: onSave, onDelete: onDelete, onChange: onDraftChange })
            : React.createElement('div', { className: 'mmv2-empty' }, React.createElement('div', { className: 'mmv2-empty-icon' }, '\uD83D\uDC40'), '\u9009\u62E9\u4E00\u6761\u8BB0\u5FC6')),
        preview ? React.createElement('div', { style: { position:'fixed', inset:0, background:'var(--dsw-alias-bg-mask-1,rgba(0,0,0,.45))', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' } },
          React.createElement('div', { style: { background:'var(--dsw-alias-bg-layer-1,#161618)', border:'1px solid var(--dsw-alias-border-l1,#333)', borderRadius:8, width:560, maxHeight:'70vh', display:'flex', flexDirection:'column', padding:14, gap:10 } },
            React.createElement('div', { style: { fontWeight:700 } }, '\u9884\u89C8\u5408\u5E76 (' + preview.length + ' \u7EC4)'),
            React.createElement('div', { style: { overflow:'auto', flex:1 } }, preview.length === 0 ? '\u65E0\u5F85\u5408\u5E76\u9879' : preview.map(function (p, i) {
              return React.createElement('div', { key:i, style:{ padding:'8px 0', borderBottom:'1px solid var(--dsw-alias-border-l1,#333)' } },
                React.createElement('div', { style:{ fontSize:12, color:'var(--dsw-alias-label-secondary,#aaa)' } }, '\u76F8\u4F3C\u5EA6 ' + p.score.toFixed(2)),
                React.createElement('div', { style:{ fontSize:12, marginTop:4 } }, '\u4FDD\u7559: ' + p.keepPreview),
                React.createElement('div', { style:{ fontSize:12, color:'var(--dsw-alias-label-tertiary,#888)', marginTop:2 } }, '\u5408\u5E76: ' + p.mergePreview)); })),
            React.createElement('div', { style: { display:'flex', gap:8, justifyContent:'flex-end' } },
              React.createElement('button', { className: 'mmv2-btn', onClick: function(){ setPreview(null); } }, '\u53D6\u6D88'),
              React.createElement('button', { className: 'mmv2-btn mmv2-btn-pri', onClick: onConsolidateApply, disabled: preview.length===0 }, '\u786E\u8BA4\u5408\u5E76')))) : null,
        toast ? React.createElement('div', { className: 'mmv2-toast' }, toast) : null);
    }

    var inject = ['slots'];
    function apply(ctx) {
      try {
        var slots = ctx.slots;
        slots.inject('settings.section', function () {
          slots.register({ name: 'settings.section', id: 'memory-manager', order: 50, label: '\u8BB0\u5FC6' }, MemoryManager);
        });
      } catch (err) { console.error('[dsh-memory] apply failed:', err); }
    }

    exports.name = 'dsh-memory';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});