window.__ModuleLoader__.load({
	id: "deepseek-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ── 主题自适应样式（data-plugin 标记，HMR/卸载时由 loader 与 HMR 驱动器清理）──
		const STYLE_ID = "deepseek-balance";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(STYLE_ID) + "]") === null) {
			const style = document.createElement("style");
			style.dataset.plugin = "deepseek-balance";
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = `
.dsb-root { position: relative; display: flex; align-items: center; }
.dsb-trigger {
	display: flex; align-items: center; gap: 6px;
	width: 100%; min-width: 0; padding: 6px 8px;
	border: 1px solid transparent; border-radius: 8px;
	background: transparent; color: inherit; font: inherit; font-size: 12px;
	cursor: pointer; text-align: left; overflow: hidden; white-space: nowrap;
}
.dsb-trigger:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.dsb-trigger:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 1px; }
.dsb-rail { justify-content: center; width: 36px; height: 36px; padding: 0; }
.dsb-balance { font-variant-numeric: tabular-nums; font-weight: 600; }
.dsb-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dsb-dot.ok { background: #3fb950; }
.dsb-dot.low { background: #d29922; }
.dsb-dot.crit { background: #f85149; }
.dsb-dot.err { background: #f85149; animation: dsb-blink 1.2s infinite; }
@keyframes dsb-blink { 50% { opacity: .25; } }
.dsb-spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color: currentColor; border-radius: 50%; animation: dsb-spin .8s linear infinite; }
@keyframes dsb-spin { to { transform: rotate(360deg); } }
.dsb-pop {
	position: fixed; z-index: 99999; width: 300px; max-width: calc(100vw - 16px);
	background: color-mix(in srgb, Canvas 96%, transparent);
	color: CanvasText;
	border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
	border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28);
	font-size: 12px; line-height: 1.5;
}
.dsb-pop-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px; font-weight: 700; }
.dsb-pop-close { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 6px; }
.dsb-pop-close:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsb-pop-body { padding: 4px 12px 12px; }
.dsb-total { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
.dsb-sub { color: color-mix(in srgb, CanvasText 62%, transparent); margin-top: 2px; }
.dsb-stats { margin-top: 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.dsb-stat { background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 8px; padding: 6px 8px; }
.dsb-stat b { display: block; font-variant-numeric: tabular-nums; font-size: 13px; }
.dsb-stat span { color: color-mix(in srgb, CanvasText 58%, transparent); font-size: 11px; }
.dsb-chart { margin-top: 10px; display: flex; align-items: flex-end; gap: 3px; height: 76px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
.dsb-bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.dsb-bar { opacity: .78; }
.dsb-bar:hover { opacity: 1; }
.dsb-bar-val { font-size: 9px; line-height: 1; white-space: nowrap; color: color-mix(in srgb, CanvasText 70%, transparent); }
.dsb-bar-full { flex: 0 1 auto; width: 100%; max-width: 56px; margin: 0 auto; }
.dsb-line { width: 100%; height: 100%; display: block; overflow: visible; }
.dsb-line-path { fill: none; stroke: #4d6bfe; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.dsb-area { fill: #4d6bfe; opacity: .12; }
.dsb-dot2 { fill: #4d6bfe; stroke: color-mix(in srgb, Canvas 75%, transparent); stroke-width: 1; }
.dsb-val { font-size: 9px; fill: color-mix(in srgb, CanvasText 70%, transparent); text-anchor: middle; }
.dsb-date { font-size: 8px; fill: color-mix(in srgb, CanvasText 50%, transparent); text-anchor: middle; }
.dsb-chart-empty { margin-top: 10px; height: 60px; display: flex; align-items: center; justify-content: center; color: color-mix(in srgb, CanvasText 45%, transparent); border-bottom: 1px dashed color-mix(in srgb, CanvasText 15%, transparent); font-size: 11px; }
.dsb-err { color: #f85149; background: color-mix(in srgb, #f85149 10%, transparent); border-radius: 8px; padding: 8px 10px; margin-top: 8px; }
.dsb-actions { margin-top: 10px; display: flex; gap: 8px; }
.dsb-btn { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.dsb-btn:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.dsb-btn.primary { background: #4d6bfe; border-color: #4d6bfe; color: #fff; }
.dsb-btn.primary:hover { background: #3f5cf0; }
.dsb-note { margin-top: 8px; color: color-mix(in srgb, CanvasText 45%, transparent); font-size: 11px; }
`;
			(document.head || document.documentElement).appendChild(style);
		}

		let React = require("react");
		let ReactDOM = require("react-dom");

		const TOP_UP_URL = "https://platform.deepseek.com/top_up";
		const LOW_THRESHOLD = 10;
		const CRIT_THRESHOLD = 1;

		const fmt = (n, currency) => {
			if (n === null || n === undefined || Number.isNaN(n)) return "—";
			const s = (Number(n) || 0).toFixed(2);
			return (currency === "USD" ? "$" : "¥") + s;
		};

		function WalletIcon({ size }) {
			return React.createElement(
				"svg",
				{ width: size || 16, height: size || 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
				React.createElement("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }),
				React.createElement("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }),
				React.createElement("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" })
			);
		}

		function dotClass(view) {
			if (!view || !view.ok) return "err";
			if (view.balance) {
				if (view.balance.total < CRIT_THRESHOLD) return "crit";
				if (view.balance.total < LOW_THRESHOLD) return "low";
				return "ok";
			}
			return "err";
		}

		function BalanceWidget(props) {
			const wide = !!props.wide;
			const [view, setView] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
			const [open, setOpen] = React.useState(false);
			const triggerRef = React.useRef(null);
			const popRef = React.useRef(null);

			const load = React.useCallback(async (mode) => {
				setLoading(true);
				try {
					const res = await fetch(mode === "state" ? "/dsb/api/state" : "/dsb/api/balance", { cache: "no-store" });
					let data;
					try { data = await res.json(); } catch { data = null; }
					if (!data || typeof data !== "object") throw new Error("接口返回格式异常");
					setView(data);
				} catch (err) {
					setView({ ok: false, error: (err && err.message) || String(err), topUpUrl: TOP_UP_URL });
				} finally {
					setLoading(false);
				}
			}, []);

			const refreshMs = (view && view.config && view.config.refreshSec ? view.config.refreshSec : 60) * 1000;

			React.useEffect(() => {
				load("state");
				load("balance");
				const timer = setInterval(() => load("balance"), refreshMs);
				return () => clearInterval(timer);
			}, [load, refreshMs]);

			// 点击外部关闭弹层
			React.useEffect(() => {
				if (!open) return;
				const onDown = (e) => {
					if (popRef.current && popRef.current.contains(e.target)) return;
					if (triggerRef.current && triggerRef.current.contains(e.target)) return;
					setOpen(false);
				};
				document.addEventListener("pointerdown", onDown);
				return () => document.removeEventListener("pointerdown", onDown);
			}, [open]);

			const balance = view && view.ok && view.balance ? view.balance : null;
			const stats = view && view.stats ? view.stats : null;
			const showErr = view && (!view.ok || !balance);
			const errText = view && view.error ? view.error : "";

			const trigger = React.createElement(
				"button",
				{
					type: "button",
					ref: triggerRef,
					className: "dsb-trigger" + (wide ? "" : " dsb-rail"),
					title: "DeepSeek 余额",
					"aria-label": "DeepSeek 余额" + (balance ? "，当前余额 " + fmt(balance.total, balance.currency) : ""),
					"aria-expanded": open,
					onClick: () => setOpen((v) => !v),
				},
				React.createElement(WalletIcon, { size: wide ? 15 : 17 }),
				wide &&
					(balance
						? React.createElement("span", { className: "dsb-balance" }, fmt(balance.total, balance.currency))
						: loading
							? React.createElement("span", { className: "dsb-spinner" })
							: React.createElement("span", { className: "dsb-balance" }, "余额 —")),
				React.createElement("span", { className: "dsb-dot " + dotClass(view) })
			);

			let pop = null;
			if (open) {
				const rect = triggerRef.current ? triggerRef.current.getBoundingClientRect() : null;
				const style = rect
					? { left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)), top: Math.max(8, rect.top - 344), width: 300 }
					: { left: 8, bottom: 8, width: 300 };
				const head = React.createElement(
					"div",
					{ className: "dsb-pop-head" },
					React.createElement("span", null, "DeepSeek 余额"),
					React.createElement("button", { type: "button", className: "dsb-pop-close", "aria-label": "关闭", onClick: () => setOpen(false) }, "✕")
				);
				if (balance) {
				let chart;
				if (stats && stats.history && stats.history.length >= 1) {
					// 多天/单天数据：柱状图（SVG）——每根柱子按当日消耗高度缩放；≤7 天时在柱顶显示数值
					const items = stats.history;
					const max = Math.max(0.01, ...items.map((x) => x.spend));
					const n = items.length;
					const W = 276, H = 76, PAD_X = 8, PAD_TOP = 16, PAD_BOT = 24;
					const innerW = W - PAD_X * 2;
					const innerH = H - PAD_TOP - PAD_BOT;
					const barW = Math.max(3, Math.min(18, Math.floor((innerW - (n - 1) * 2) / n)));
					const gap = n > 1 ? Math.max(2, Math.floor((innerW - n * barW) / (n - 1))) : 0;
					const labelAll = n <= 7;
					const dateAll = n <= 14;
					const fmtDay = (d) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + '-' + m[3] : d.slice(5, 10); };
					const nodes = [];
					items.forEach((h, i) => {
						const x = PAD_X + i * (barW + gap);
						const barH = Math.max(1, (h.spend / max) * innerH);
						const y = PAD_TOP + innerH - barH;
						nodes.push(React.createElement("g", { key: h.day },
							React.createElement("title", null, h.day + " 消耗 " + fmt(h.spend, balance.currency)),
							React.createElement("rect", { x, y, width: barW, height: barH, rx: 2, fill: "#4d6bfe", className: "dsb-bar" }),
							labelAll ? React.createElement("text", { x: x + barW / 2, y: Math.max(9, y - 4), className: "dsb-val" }, fmt(h.spend, balance.currency)) : null,
							dateAll ? React.createElement("text", { x: x + barW / 2, y: H - 4, className: "dsb-date" }, fmtDay(h.day)) : null));
					});
					chart = React.createElement("div", { className: "dsb-chart" },
						React.createElement("svg", { className: "dsb-line", viewBox: "0 0 " + W + " " + H }, nodes));
				} else {
					chart = React.createElement("div", { className: "dsb-chart-empty" }, "暂无消耗记录，启用后将逐日累积");
				}
				body = React.createElement(
					React.Fragment,
					null,
					React.createElement("div", { className: "dsb-total" }, fmt(balance.total, balance.currency)),
					React.createElement("div", { className: "dsb-sub" },
						"充值余额 " + fmt(balance.toppedUp, balance.currency) + " · 赠送余额 " + fmt(balance.granted, balance.currency) +
						(balance.isAvailable ? " · 可用" : " · 不可用")),
					React.createElement("div", { className: "dsb-stats" },
						React.createElement("div", { className: "dsb-stat" },
							React.createElement("b", null, fmt(stats ? stats.todaySpend : null, balance.currency)),
							React.createElement("span", null, "今日消耗")),
						React.createElement("div", { className: "dsb-stat" },
							React.createElement("b", null, fmt(stats ? stats.weekSpend : null, balance.currency)),
							React.createElement("span", null, "近 7 天")),
						React.createElement("div", { className: "dsb-stat" },
							React.createElement("b", null, fmt(stats ? stats.sinceInstallSpend : null, balance.currency)),
							React.createElement("span", null, "累计(自启用)"))),
					chart,
					React.createElement("div", { className: "dsb-actions" },
						React.createElement("button", { type: "button", className: "dsb-btn", onClick: () => load("balance"), disabled: loading },
							loading ? "刷新中…" : "刷新"),
						React.createElement("button", {
							type: "button",
							className: "dsb-btn primary",
							onClick: () => { window.open(view.topUpUrl || TOP_UP_URL, "_blank", "noopener,noreferrer"); },
						}, "充值 ↗"))
				);
				} else {
					body = React.createElement(
						React.Fragment,
						null,
						React.createElement("div", { className: "dsb-err" },
							showErr && errText ? errText : (loading ? "正在查询余额…" : "余额暂不可用")),
						React.createElement("div", { className: "dsb-actions" },
							React.createElement("button", { type: "button", className: "dsb-btn", onClick: () => load("balance"), disabled: loading },
								loading ? "刷新中…" : "重试"),
							React.createElement("button", {
								type: "button",
								className: "dsb-btn primary",
								onClick: () => { window.open((view && view.topUpUrl) || TOP_UP_URL, "_blank", "noopener,noreferrer"); },
							}, "充值 ↗"))
					);
				}
				const note = React.createElement("div", { className: "dsb-note" },
					"数据来自 DeepSeek 官方余额接口，约每分钟自动刷新；点击「充值」前往官方充值页。");
				pop = ReactDOM.createPortal(
					React.createElement("div", { ref: popRef, className: "dsb-pop", style, role: "dialog", "aria-label": "DeepSeek 余额详情" },
						head, React.createElement("div", { className: "dsb-pop-body" }, body, note)),
					document.body
				);
			}

			return React.createElement("div", { className: "dsb-root" }, trigger, pop);
		}

		const inject = ["slots"];

		function apply(ctx) {
			try {
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "deepseek-balance",
					order: 100,
				}, BalanceWidget));
			} catch (err) {
				console.error("[deepseek-balance] apply failed:", err);
			}
		}

		exports.name = "deepseek-balance";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
