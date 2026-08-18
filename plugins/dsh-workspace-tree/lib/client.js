// dsh-workspace-tree — browser half.
// Workspace file tree as a GUI feature. A right-edge tab "📁 工作区" opens a
// panel that mirrors the old desktop sidebar exactly — header (🐋 工作区 +
// reveal/refresh/collapse), root path, expandable tree with file sizes, a
// status line and the DeepSeek peak-hour countdown.
//
// Docking (no covering): like the dsh-better-sidebar technique, the open
// panel pushes the whole app shell instead of floating over it — we set
// `#root { margin-right: <panel width> }` so the AppFrame three-column grid
// (its only flexible 1fr column is the conversation center) gives up space.
// The header and the composer stay fully visible; nothing is obscured.
//
// Listing comes from the DSH host (/api/workspace-tree/*); open/reveal go
// through the desktop app's loopback bridge (127.0.0.1:3090).
window.__ModuleLoader__.load({
	id: "dsh-workspace-tree",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		const PANEL_W = 280;

		const STYLE_ID = "dsh-workspace-tree";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-workspace-tree";
			style.dataset.pluginCss = STYLE_ID;
			// Same palette as the old desktop sidebar (maid-atelier, permanent).
			style.textContent = `
.wt-tab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  z-index: 9999; writing-mode: vertical-rl;
  padding: 10px 6px; border-radius: 8px 0 0 8px; cursor: pointer;
  background: #050d28; border: 1px solid rgba(151,169,216,.34); border-right: none;
  color: #e7ecf7; font-size: 12px; letter-spacing: 2px; pointer-events: auto;
}
.wt-tab:hover { background: #121f43; }
.wt-panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: 280px; z-index: 9998;
  display: flex; flex-direction: column;
  background: #050d28; border-left: 1px solid rgba(151,169,216,.2);
  box-shadow: -8px 0 28px rgba(0,0,0,.35);
  font-size: 13px; color: #e7ecf7; pointer-events: auto;
  font-family: "Segoe UI", system-ui, sans-serif;
}
.wt-head {
  padding: 10px 12px 8px; border-bottom: 1px solid rgba(151,169,216,.2);
  background: #121f43; flex: none; display: flex; align-items: center; gap: 8px;
}
.wt-logo { font-size: 15px; }
.wt-title { font-weight: 600; font-size: 13px; }
.wt-sp { flex: 1; }
.wt-icon-btn {
  background: none; border: 1px solid transparent; color: #bdc9e3;
  font-size: 14px; line-height: 1; cursor: pointer; border-radius: 4px; padding: 3px 6px;
}
.wt-icon-btn:hover { color: #e7ecf7; border-color: rgba(151,169,216,.2); background: rgba(164,183,229,.14); }
.wt-path {
  margin-top: 6px; font-size: 11px; color: #96a6c9;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
}
.wt-tree { flex: 1; overflow: auto; padding: 6px 0; outline: none; }
.wt-row {
  display: flex; align-items: center; gap: 6px;
  padding: 2px 10px; cursor: default; white-space: nowrap; color: #e7ecf7;
}
.wt-row.dir { cursor: pointer; }
.wt-row:hover { background: rgba(164,183,229,.14); }
.wt-chev { width: 12px; flex: none; color: #bdc9e3; font-size: 10px; text-align: center; }
.wt-icon { flex: none; font-size: 12px; }
.wt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.wt-size { flex: none; color: #96a6c9; font-size: 11px; }
.wt-status {
  flex: none; border-top: 1px solid rgba(151,169,216,.2); padding: 4px 12px;
  font-size: 11px; color: #96a6c9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wt-msg { padding: 4px 12px; font-size: 11px; color: #96a6c9; }
@keyframes wt-pblink { 50% { opacity: .4; } }
`;
			(document.head || document.documentElement).appendChild(style);
		}

		const API = "/api/workspace-tree";
		const BRIDGE = "http://127.0.0.1:3090";

		// ---- same formatting helpers as the old sidebar ----
		function fmtSize(n) {
			if (n < 1024) return n + ' B';
			if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
			if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
			return (n / 1073741824).toFixed(1) + ' GB';
		}

		// ---- DeepSeek peak-hour countdown (Beijing time, UTC+8 fixed) ----
		const PEAK_WINDOWS = [[9, 12], [14, 18]];
		function fmtClock(totalSecs) {
			const s = Math.max(0, Math.floor(totalSecs));
			const h = Math.floor(s / 3600);
			const m = Math.floor((s % 3600) / 60);
			const ss = s % 60;
			const p = (n) => String(n).padStart(2, '0');
			return (h > 0 ? h + ':' : '') + p(m) + ':' + p(ss);
		}
		function peakSnapshot() {
			const bj = new Date(Date.now() + 8 * 3600 * 1000);
			const h = bj.getUTCHours();
			const m = bj.getUTCMinutes();
			const s = bj.getUTCSeconds();
			const cur = h + m / 60 + s / 3600;
			let inPeak = false, target = null, label = '';
			for (const [sh, eh] of PEAK_WINDOWS) {
				if (cur >= sh && cur < eh) { inPeak = true; target = eh; label = '结束'; break; }
			}
			if (!inPeak) {
				for (const [sh] of PEAK_WINDOWS) {
					if (cur < sh) { target = sh; label = '开始'; break; }
				}
				if (target === null) { target = 9 + 24; label = '开始'; }
			}
			const secs = Math.round((target - cur) * 3600);
			const t = String(target % 24).padStart(2, '0') + ':00 ' + label;
			return {
				inPeak,
				text: (inPeak ? '🔥 高峰期进行中 ' : '⏳ 距下个高峰 ') + fmtClock(secs) + (inPeak ? ' 后' + label : '（' + t + '）'),
			};
		}

		function DirNode({ rel, name, depth, root, onStatus }) {
			const [open, setOpen] = React.useState(false);
			const [kids, setKids] = React.useState(null); // null = not loaded
			const toggle = async () => {
				if (open) { setOpen(false); return; }
				setOpen(true);
				if (!kids) {
					try {
						const r = await fetch(API + "/list?path=" + encodeURIComponent(rel));
						const d = await r.json();
						setKids(d.ok ? d : null);
						if (!d.ok) onStatus('无法读取: ' + (d.error || '未知错误'));
					} catch (e) { setKids(null); onStatus('无法读取: ' + String(e.message || e)); }
				}
			};
			const pad = { paddingLeft: 10 + depth * 16 };
			return React.createElement("div", null,
				React.createElement("div", { className: "wt-row dir", style: pad, onClick: toggle, title: rel },
					React.createElement("span", { className: "wt-chev" }, open ? "▾" : "▸"),
					React.createElement("span", { className: "wt-icon" }, open ? "📂" : "📁"),
					React.createElement("span", { className: "wt-name" }, name)),
				open && kids
					? kids.dirs.map((d) => React.createElement(DirNode, { key: d.rel, rel: d.rel, name: d.name, depth: depth + 1, root, onStatus }))
						.concat(kids.files.map((f) => React.createElement(FileNode, { key: f.rel, rel: f.rel, name: f.name, size: f.size, depth: depth + 1, root, onStatus })))
					: (open && kids === null ? React.createElement("div", { className: "wt-msg", style: { paddingLeft: 24 + depth * 16 } }, "加载中…") : null));
		}

		function FileNode({ rel, name, size, depth, root, onStatus }) {
			const openFile = async () => {
				const abs = root ? root + '\\' + rel.split('/').join('\\') : '';
				onStatus('打开 ' + abs);
				try {
					const r = await fetch(BRIDGE + "/open?path=" + encodeURIComponent(abs));
					const d = await r.json();
					if (!d.ok) onStatus(d.error || '打开失败');
				} catch { onStatus('打开文件需要桌面应用（DeepSeek Harness Desktop）'); }
			};
			return React.createElement("div", {
				className: "wt-row",
				style: { paddingLeft: 10 + depth * 16 },
				onClick: openFile,
				title: rel,
			},
				React.createElement("span", { className: "wt-chev" }, ""),
				React.createElement("span", { className: "wt-icon" }, "📄"),
				React.createElement("span", { className: "wt-name" }, name),
				React.createElement("span", { className: "wt-size" }, size > 0 ? fmtSize(size) : ""));
		}

		// ---- Peak countdown in the composer dock ----
		// A centered readout on its own line below the stats row ("80 轮 · 772 步 | LLM …"),
		// styled to match the ambient dock typography.
		function PeakCountdown() {
			const [peak, setPeak] = React.useState(peakSnapshot);
			React.useEffect(() => {
				const t = setInterval(() => setPeak(peakSnapshot()), 1000);
				return () => clearInterval(t);
			}, []);
			return React.createElement("div", {
				style: {
					display: 'flex', alignItems: 'center', justifyContent: 'center',
					gap: 5, fontSize: 11, lineHeight: '18px',
					fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
					padding: '2px 0', opacity: 0.7,
					color: peak.inPeak ? '#e8c88a' : undefined,
				},
				title: "DeepSeek 峰谷定价：高峰时段（北京时间 9:00-12:00、14:00-18:00）价格为空闲时段的 2 倍",
			},
				React.createElement("span", {
					style: {
						width: 6, height: 6, borderRadius: '50%', flex: 'none',
						background: peak.inPeak ? '#c5a468' : 'currentColor',
						opacity: peak.inPeak ? 1 : 0.5,
						boxShadow: peak.inPeak ? '0 0 6px #c5a468aa' : 'none',
						animation: peak.inPeak ? 'wt-pblink 1.4s infinite' : 'none',
					},
				}),
				React.createElement("span", null, peak.text));
		}

		function WorkspaceTree() {
			const [open, setOpen] = React.useState(false);
			const [root, setRoot] = React.useState("");
			const [top, setTop] = React.useState(null); // { dirs, files }
			const [status, setStatus] = React.useState("");
			const [gen, setGen] = React.useState(0); // bump to remount the tree (refresh)

			// Dock instead of overlay: while the panel is open, push the whole
			// app shell left by the panel width (margin-right on #root), exactly
			// like dsh-better-sidebar. The conversation's flexible center column
			// gives up the space, so the header/composer are never covered.
			React.useEffect(() => {
				const rootEl = document.getElementById('root');
				if (!rootEl) return;
				const prev = rootEl.style.marginRight;
				if (open) {
					rootEl.style.marginRight = PANEL_W + 'px';
				} else {
					rootEl.style.marginRight = '';
				}
				return () => { rootEl.style.marginRight = prev; };
			}, [open]);

			const loadRoot = async () => {
				try {
					const r = await fetch(API + "/root");
					const d = await r.json();
					if (!d.ok) { setStatus('无法读取工作区'); return; }
					setRoot(d.root);
					const l = await fetch(API + "/list?path=" + encodeURIComponent(""));
					const ld = await l.json();
					setTop(ld.ok ? ld : null);
					setStatus(ld.ok ? (ld.dirs.length + ' 个目录 · ' + ld.files.length + ' 个文件') : (ld.error || '无内容'));
				} catch (e) { setStatus('无法读取工作区: ' + String(e.message || e)); }
			};
			const openPanel = async () => {
				setOpen(true);
				if (!top) { setStatus('加载中…'); await loadRoot(); }
			};
			const refresh = () => { setTop(null); setStatus('加载中…'); setGen((g) => g + 1); loadRoot(); };
			const revealRoot = () => {
				if (!root) return;
				fetch(BRIDGE + "/reveal?path=" + encodeURIComponent(root))
					.then((r) => r.json())
					.then((d) => { if (!d.ok) setStatus(d.error || '打开失败'); })
					.catch(() => setStatus('在资源管理器中显示需要桌面应用'));
			};

			if (!open) {
				return React.createElement("div", { className: "wt-tab", onClick: openPanel, title: "打开工作区文件树" }, "📁 工作区");
			}
			return React.createElement("div", { className: "wt-panel" },
				React.createElement("div", { className: "wt-head" },
					React.createElement("span", { className: "wt-logo" }, "🐋"),
					React.createElement("span", { className: "wt-title" }, "工作区"),
					React.createElement("span", { className: "wt-sp" }),
					React.createElement("button", { className: "wt-icon-btn", onClick: revealRoot, title: "在资源管理器中打开" }, "📂"),
					React.createElement("button", { className: "wt-icon-btn", onClick: refresh, title: "刷新" }, "⟳"),
					React.createElement("button", { className: "wt-icon-btn", onClick: () => setOpen(false), title: "收起" }, "✕")),
				React.createElement("div", { className: "wt-path", title: root || "" }, root || ""),
				React.createElement("div", { className: "wt-tree", key: gen },
					top
						? top.dirs.map((d) => React.createElement(DirNode, { key: d.rel, rel: d.rel, name: d.name, depth: 0, root, onStatus: setStatus }))
							.concat(top.files.map((f) => React.createElement(FileNode, { key: f.rel, rel: f.rel, name: f.name, size: f.size, depth: 0, root, onStatus: setStatus })))
						: React.createElement("div", { className: "wt-msg" }, status || "加载中…")),
				React.createElement("div", { className: "wt-status" }, status || ""));
		}

		// ---- DSH update checker (settings section) ----
		// Periodically polls the npm registry for @deepseek-ai/dsh and compares
		// with the installed version. Shows a settings page with version info,
		// update status, changelog, and a one-click update button.
		function cmpVersion(a, b) {
			var pa = a.split('-'), pb = b.split('-');
			var va = pa[0].split('.').map(Number), vb = pb[0].split('.').map(Number);
			for (var i = 0; i < 3; i++) {
				if ((va[i] || 0) !== (vb[i] || 0)) return (va[i] || 0) - (vb[i] || 0);
			}
			if (pa[1] && pb[1]) return pa[1].localeCompare(pb[1]);
			if (pa[1]) return -1; if (pb[1]) return 1;
			return 0;
		}

		var NPM_PAGE = "https://www.npmjs.com/package/@deepseek-ai/dsh";

		// Minimal markdown → HTML (bold, headers, lists, links, code)
		function renderMd(md) {
			if (!md) return '';
			// Pre-process: convert safe HTML tags to markdown equivalents
			var safe = md
				.replace(/<h(\d)[^>]*>(.*?)<\/h\d>/gi, function (m, level, text) { return '######'.slice(0, Number(level)) + ' ' + text; })
				.replace(/<li[^>]*>/gi, '- ')
				.replace(/<\/?(ul|ol|li)[^>]*>/gi, '')
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
				.replace(/<em>(.*?)<\/em>/gi, '*$1*')
				.replace(/<code>(.*?)<\/code>/gi, '`$1`')
				.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
				.replace(/<\/?(?:div|span|p|section|article|header|footer|table|tr|td|th|thead|tbody|img|hr|pre|blockquote)[^>]*>/gi, '');
			var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
			var lines = safe.split('\n');
			var html = [];
			var inList = false;
			for (var i = 0; i < lines.length; i++) {
				var l = lines[i];
				if (/^###\s/.test(l)) { html.push('<h4 style="margin:10px 0 4px;font-size:13px">' + esc(l.replace(/^###\s*/, '')) + '</h4>'); }
				else if (/^##\s/.test(l)) { html.push('<h3 style="margin:12px 0 4px;font-size:14px">' + esc(l.replace(/^##\s*/, '')) + '</h3>'); }
				else if (/^[-*]\s/.test(l)) {
					if (!inList) { html.push('<ul style="margin:4px 0;padding-left:18px">'); inList = true; }
					html.push('<li style="margin:2px 0">' + esc(l.replace(/^[-*]\s*/, '')) + '</li>');
				} else {
					if (inList) { html.push('</ul>'); inList = false; }
					var t = esc(l)
						.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
						.replace(/`([^`]+)`/g, '<code style="background:color-mix(in srgb,currentColor 8%,transparent);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
						.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, text, href) {
							if (href.charAt(0) === '#') return text; // anchor = plain text
							return '<a href="' + href + '" target="_blank" rel="noopener" style="color:#4d6bfe">' + text + '</a>';
						});;
					html.push(t ? '<p style="margin:3px 0">' + t + '</p>' : '<br>');
				}
			}
			if (inList) html.push('</ul>');
			return html.join('');
		}

		var S = {
			card: { background: 'color-mix(in srgb, currentColor 4%, transparent)', border: '1px solid color-mix(in srgb, currentColor 12%, transparent)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 },
			row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, lineHeight: '20px' },
			lbl: { opacity: 0.6 },
			val: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
			badgeOk: { display: 'inline-flex', alignItems: 'center', gap: 5, color: '#3fb950', fontWeight: 600, fontSize: 13 },
			badgeNew: { display: 'inline-flex', alignItems: 'center', gap: 5, color: '#d29922', fontWeight: 600, fontSize: 13 },
			btn: { alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 20%, transparent)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
			btnPrimary: { alignSelf: 'flex-start', padding: '8px 18px', borderRadius: 8, border: 'none', background: '#4d6bfe', color: '#fff', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
			changelog: { fontSize: 12, lineHeight: '18px', color: 'color-mix(in srgb, CanvasText 80%, transparent)', maxHeight: 280, overflow: 'auto', padding: '8px 12px', background: 'color-mix(in srgb, currentColor 3%, transparent)', borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 8%, transparent)' },
			mono: { fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', opacity: 0.5, marginTop: 2 },
		};

		function UpdateCheckSettings() {
			var r1 = React.useState({ installed: null, latest: null, changelog: '', loading: true, error: '' });
			var info = r1[0], setInfo = r1[1];
			var r2 = React.useState('idle'); // idle | updating | done | err
			var updState = r2[0], setUpdState = r2[1];
			var r3 = React.useState('');
			var updMsg = r3[0], setUpdMsg = r3[1];

			var check = React.useCallback(async function () {
				setInfo(function (p) { return Object.assign({}, p, { loading: true, error: '' }); });
				var installed = null, latest = null, changelog = '', error = '';
				try {
					var ver = await fetch(API + "/version", { cache: 'no-store' });
					var vd = await ver.json();
					if (vd && vd.version) installed = vd.version;
				} catch { /* ok */ }
				try {
					var ui = await fetch(API + "/update-info", { cache: 'no-store' });
					var uid = await ui.json();
					if (uid && uid.ok) { latest = uid.latest; changelog = uid.changelog || ''; }
					else if (uid && uid.error) { error = uid.error; }
				} catch (e) { error = '检查失败：' + (e.message || String(e)); }
				setInfo({ installed: installed, latest: latest, changelog: changelog, loading: false, error: error });
			}, []);

			React.useEffect(function () { check(); }, [check]);

			var doUpdate = React.useCallback(async function () {
				setUpdState('updating');
				setUpdMsg('');
				try {
					var r = await fetch(API + "/update", { method: 'POST', cache: 'no-store' });
					var d = await r.json();
					if (d && d.ok) {
						setUpdState('done');
						setUpdMsg('已更新到 ' + (d.version || '最新版本') + '。请重启 DSH 服务使新版本生效。');
						// Poll /version until the installed version changes (service restarted)
						var newVer = d.version;
						if (newVer && info.installed && newVer !== info.installed) {
							var attempts = 0;
							var poll = setInterval(async function () {
								attempts++;
								try {
									var vr = await fetch(API + "/version", { cache: 'no-store' });
									var vd = await vr.json();
									if (vd && vd.version && vd.version !== info.installed) {
										clearInterval(poll);
										check(); // full refresh
									}
								} catch {}
								if (attempts > 60) clearInterval(poll); // stop after 5 min
							}, 5000);
						}
					} else {
						setUpdState('err');
						setUpdMsg(d.error || '更新失败');
					}
				} catch (e) {
					setUpdState('err');
					setUpdMsg('更新失败：' + (e.message || String(e)));
				}
			}, [info.installed, check]);

			var hasUpdate = updState !== 'done' && info.latest && (!info.installed || cmpVersion(info.latest, info.installed) > 0);
			var upToDate = updState === 'done' || (info.latest && info.installed && cmpVersion(info.latest, info.installed) <= 0);

			return React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
				// version card
				React.createElement("div", { style: S.card },
					React.createElement("div", { style: S.row },
						React.createElement("span", { style: S.lbl }, "当前版本"),
						React.createElement("span", { style: S.val }, info.installed || (info.loading ? '检查中…' : '—'))),
					React.createElement("div", { style: S.row },
						React.createElement("span", { style: S.lbl }, "最新版本"),
						React.createElement("span", { style: S.val }, info.latest || (info.loading ? '检查中…' : '—'))),
					React.createElement("div", { style: { height: 1, background: 'color-mix(in srgb, currentColor 10%, transparent)' } }),
					info.loading
						? React.createElement("div", { style: { fontSize: 12, opacity: 0.5 } }, "正在查询 npm 官方仓库…")
						: info.error
							? React.createElement("div", { style: { fontSize: 12, color: '#f85149' } }, info.error)
							: hasUpdate
								? React.createElement("div", { style: S.badgeNew }, "⬆ 有新版本可用")
								: upToDate
									? React.createElement("div", { style: S.badgeOk }, "✓ 已是最新版本")
									: null
				),
				// changelog — always show when available
				info.changelog
					? React.createElement("div", null,
						React.createElement("div", { style: { fontSize: 12, fontWeight: 600, marginBottom: 6, opacity: 0.7 } },
							hasUpdate ? "📋 更新内容" : "📋 本版本更新内容"),
						React.createElement("div", { style: S.changelog, dangerouslySetInnerHTML: { __html: renderMd(info.changelog) } }))
					: null,
				// update button + result
				hasUpdate
					? React.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
						updState === 'done'
							? React.createElement("div", { style: { fontSize: 12, color: '#3fb950', fontWeight: 600 } }, "✓ " + updMsg)
							: updState === 'err'
								? React.createElement("div", { style: { fontSize: 12, color: '#f85149' } }, "✗ " + updMsg)
								: null,
						updState !== 'done'
							? React.createElement("button", {
								type: "button", style: S.btnPrimary, onClick: doUpdate, disabled: updState === 'updating',
							}, updState === 'updating' ? '正在更新…' : '一键更新')
							: null,
						React.createElement("a", { href: NPM_PAGE, target: "_blank", rel: "noopener noreferrer", style: { fontSize: 11, color: '#4d6bfe', opacity: 0.7 } }, "前往 npm 页面查看 →"))
					: null,
				// check button
				React.createElement("button", {
					type: "button", style: S.btn, onClick: check, disabled: info.loading,
				}, info.loading ? "检查中…" : "重新检查")
			);
		}

		const inject = ["slots"];

		function apply(ctx) {
			try {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "workspace-tree",
					order: 100,
				}, WorkspaceTree));
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-update-check",
					order: 200,
					label: function () { return "版本更新"; },
				}, UpdateCheckSettings));
				ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
					name: "conversation.composer.dock",
					id: "peak-countdown",
					order: 200,
				}, PeakCountdown));
			} catch (err) {
				console.error("[dsh-workspace-tree] apply failed:", err);
			}
		}

		exports.name = "dsh-workspace-tree";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
