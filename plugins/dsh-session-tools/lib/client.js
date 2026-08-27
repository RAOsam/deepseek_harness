// dsh-session-tools — browser half.
// Registers three text buttons (备份 / 回退 / 恢复) into the conversation
// session header's action row. Clicking them calls the desktop app's loopback
// HTTP bridge (127.0.0.1:3090) which performs the actual backup / rollback /
// restore.
window.__ModuleLoader__.load({
	id: "dsh-session-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		// theme-aware styles (injected once; cleaned up by the loader/HMR)
		const STYLE_ID = "dsh-session-tools";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-session-tools";
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = `
.st-actions { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
.st-btn {
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary, #eee) 22%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, #888) 10%, transparent);
  color: var(--dsw-alias-label-primary, #eee);
  border-radius: 8px;
  padding: 3px 12px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, transform .06s ease;
}
.st-btn:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, #888) 22%, transparent); border-color: var(--dsw-alias-border-l3, #999); }
.st-btn:active { transform: scale(.96); }
.st-btn:disabled { opacity: .45; cursor: default; transform: none; }
.st-btn.st-rollback { border-color: color-mix(in srgb, #f4897f 60%, transparent); color: #f4897f; }
.st-btn.st-rollback:hover { background: rgba(244, 137, 127, .15); border-color: #f4897f; }
.st-btn.st-restore { border-color: color-mix(in srgb, #7bd0a0 55%, transparent); color: #7bd0a0; }
.st-btn.st-restore:hover { background: rgba(123, 208, 160, .13); border-color: #7bd0a0; }
.st-msg { font-size: 11px; color: var(--dsw-alias-label-secondary, #999); margin-left: 8px; white-space: nowrap; }
.st-msg.ok { color: #7bd0a0; }
.st-msg.bad { color: #f4897f; }
`;
			(document.head || document.documentElement).appendChild(style);
		}

		const BASE = "http://127.0.0.1:3090";

		function SessionTools(props) {
			const [busy, setBusy] = React.useState("");
			const [msg, setMsg] = React.useState(null); // { text, kind }

			const run = async (action, label) => {
				setBusy(action);
				setMsg(null);
				try {
					const res = await fetch(BASE + "/" + action, { cache: "no-store" });
					let data = {};
					try { data = await res.json(); } catch { /* non-json */ }
					if (data && data.ok === true) setMsg({ text: label + "完成 ✓", kind: "ok" });
					else setMsg({ text: label + "失败：" + ((data && data.error) || ("HTTP " + res.status)), kind: "bad" });
				} catch {
					setMsg({ text: label + "失败（桌面端未运行？）", kind: "bad" });
				} finally {
					setBusy("");
				}
			};

			const renderBtn = (action, label, extra) => React.createElement("button", {
				key: action,
				type: "button",
				className: "st-btn" + (extra ? " " + extra : ""),
				onClick: () => run(action, label),
				disabled: busy !== "",
				title: action === "backup" ? "备份当前会话" : action === "rollback" ? "回退到最近的备份（会重启服务，会话自动恢复）" : "恢复/重连会话视图",
			}, busy === action ? "处理中…" : label);

			const runSafeCompact = async () => {
				setBusy('compact');
				setMsg(null);
				// Step 1: backup
				try {
					const bRes = await fetch(BASE + '/backup', { cache: 'no-store' });
					let bData = {};
					try { bData = await bRes.json(); } catch {}
					if (!bData || bData.ok !== true) {
						setMsg({ text: '备份失败，中止压缩', kind: 'bad' });
						setBusy('');
						return;
					}
				} catch {
					setMsg({ text: '备份失败（桌面端未运行？）', kind: 'bad' });
					setBusy('');
					return;
				}
				// Step 2: compact via DSH command
				try {
					const cRes = await fetch('http://127.0.0.1:3080/api/compact', { method: 'POST', cache: 'no-store' });
					let cData = {};
					try { cData = await cRes.json(); } catch {}
					if (cData && cData.ok === true) setMsg({ text: '备份+压缩完成 ✓', kind: 'ok' });
					else setMsg({ text: '压缩失败：' + ((cData && cData.error) || ('HTTP ' + cRes.status)), kind: 'bad' });
				} catch {
					setMsg({ text: '压缩失败', kind: 'bad' });
				}
				setBusy('');
			};

			return React.createElement("span", { className: "st-actions" },
				renderBtn("backup", "备份"),
				renderBtn("rollback", "⟲ 回退", "st-rollback"),
				renderBtn("restore", "⟳ 恢复", "st-restore"),
				React.createElement("button", { type: "button", className: "st-btn", onClick: runSafeCompact, disabled: busy !== "", title: "先自动备份，再压缩会话历史" }, busy === 'compact' ? '处理中…' : '备份+压缩'),
				msg ? React.createElement("span", { key: "msg", className: "st-msg " + msg.kind }, msg.text) : null);
		}

		const inject = ["slots"];

		function apply(ctx) {
			// Buttons removed — use /backup, /compact commands instead
		}

		exports.name = "dsh-session-tools";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
