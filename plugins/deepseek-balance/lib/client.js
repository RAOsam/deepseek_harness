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
	border: 1px solid transparent; border-radius: var(--dsw-radius-sm, 8px);
	background: transparent; color: var(--dsw-alias-label-primary, inherit); font: inherit; font-size: 12px;
	cursor: pointer; text-align: left; overflow: hidden; white-space: nowrap;
}
.dsb-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsb-trigger:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.dsb-rail { justify-content: center; width: 36px; height: 36px; padding: 0; }
.dsb-balance { font-variant-numeric: tabular-nums; font-weight: 600; }
.dsb-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dsb-dot.ok { background: var(--dsw-alias-state-success-primary, #3fb950); }
.dsb-dot.low { background: var(--dsw-alias-state-warn-primary, #d29922); }
.dsb-dot.crit, .dsb-dot.err { background: var(--dsw-alias-state-error-primary, #f85149); }
.dsb-dot.err { animation: dsb-blink 1.2s infinite; }
@keyframes dsb-blink { 50% { opacity: .25; } }
.dsb-spinner { width: 12px; height: 12px; border: 2px solid var(--dsw-alias-border-l3, currentColor); border-top-color: var(--dsw-alias-label-primary, currentColor); border-radius: 50%; animation: dsb-spin .8s linear infinite; }
@keyframes dsb-spin { to { transform: rotate(360deg); } }

/* 弹层：对齐官方面板材质（specific-menu + border-inverted + shadow-lv3 + radius-md） */
.dsb-pop {
	position: fixed; z-index: 99999; width: 300px; max-width: calc(100vw - 16px);
	background: var(--dsw-specific-menu, Canvas);
	color: var(--dsw-alias-label-primary, CanvasText);
	border: 1px solid var(--dsw-alias-border-inverted, rgba(128,128,128,.3));
	border-radius: var(--dsw-radius-md, 12px);
	box-shadow: var(--dsw-shadow-lv3, 0 8px 28px rgba(0,0,0,.28));
	font-size: 12px; line-height: 1.5;
}
.dsb-pop-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px; font-weight: 700; cursor: move; user-select: none; touch-action: none; }
.dsb-pop.dsb-dragging .dsb-pop-head { cursor: grabbing; }
.dsb-pop.dsb-dragging { user-select: none; }
.dsb-pop-close { border: none; background: transparent; color: inherit; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: var(--dsw-radius-xs, 6px); }
.dsb-pop-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsb-pop-body { padding: 4px 12px 12px; }

/* 余额卡片：逐项对齐官方 AccountSection.module.css（_8RVnMG_balanceCard / _row / _actions / _linkButton） */
.dsb-card {
	border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4, rgba(128,128,128,.25)));
	border-radius: var(--dsw-radius-xl, 20px);
	background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, transparent));
	padding: 12px 16px;
	display: flex; flex-direction: column; gap: 8px;
}
.dsb-row { box-sizing: border-box; min-height: 40px; padding: 6px 0; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.dsb-row-label { color: var(--dsw-alias-label-primary, inherit); font-size: 13px; line-height: 22px; }
.dsb-row-value { font-size: 14px; font-weight: 500; line-height: 22px; font-variant-numeric: tabular-nums; }
.dsb-divider { border-top: .5px solid var(--dsw-alias-border-l2); }
.dsb-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px; }
.dsb-link-button {
	box-sizing: border-box; display: inline-flex; justify-content: center; align-items: center;
	min-width: 58px; height: 36px; padding: 0 14px;
	border: .5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
	border-radius: var(--dsw-radius-md, 12px);
	background: 0 0; color: var(--dsw-alias-label-primary, inherit);
	font: inherit; font-size: 14px; line-height: 22px; white-space: nowrap; flex: none;
	cursor: pointer; text-decoration: none;
}
.dsb-link-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsb-link-button:disabled { opacity: .45; cursor: default; }
.dsb-link-button.dsb-primary { color: var(--dsw-alias-label-primary-foreground, #fff); background: var(--dsw-alias-button-primary-fill); border-color: transparent; font-weight: 500; }
.dsb-link-button.dsb-primary:hover { background: var(--dsw-alias-button-primary-hover); }

/* 用量统计与图表：官方没有，插件独有，沿用官方令牌 */
.dsb-stats { margin-top: 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.dsb-stat { background: var(--dsw-alias-interactive-bg-hover); border-radius: var(--dsw-radius-sm, 8px); padding: 6px 8px; }
.dsb-stat b { display: block; font-variant-numeric: tabular-nums; font-size: 13px; }
.dsb-stat span { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dsb-chart { margin-top: 10px; display: flex; align-items: flex-end; gap: 3px; height: 76px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsb-bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.dsb-bar { fill: var(--dsw-alias-brand-primary, #4d6bfe); opacity: .78; }
.dsb-bar:hover { opacity: 1; }
.dsb-line { width: 100%; height: 100%; display: block; overflow: visible; }
.dsb-val { font-size: 9px; fill: var(--dsw-alias-label-tertiary); text-anchor: middle; }
.dsb-date { font-size: 8px; fill: var(--dsw-alias-label-tertiary); text-anchor: middle; }
.dsb-chart-empty { margin-top: 10px; height: 60px; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); border-bottom: 1px dashed var(--dsw-alias-border-l2); font-size: 11px; }
.dsb-err { color: var(--dsw-alias-state-error-primary, #f85149); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(248,81,73,.1)); border-radius: var(--dsw-radius-sm, 8px); padding: 8px 10px; margin-top: 8px; font-size: 12px; line-height: 18px; }
.dsb-note { margin-top: 8px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
`;
			(document.head || document.documentElement).appendChild(style);
		}

		let React = require("react");
		let ReactDOM = require("react-dom");

		const TOP_UP_URL = "https://platform.deepseek.com/top_up";
		const LOW_THRESHOLD = 10;
		const CRIT_THRESHOLD = 1;

		const fmt = (n, currency) => {
			if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
			// 官方金额格式：两位小数 + 千分位分组
			const s = Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
			// 弹窗位置：null = 按触发器自动定位；拖动后固定为 { left, top }
			const [pos, setPos] = React.useState(null);
			const [dragging, setDragging] = React.useState(false);
			const dragRef = React.useRef(null);

			const onDragDown = (e) => {
				const pop = popRef.current;
				if (!pop) return;
				if (e.target && e.target.closest && e.target.closest(".dsb-pop-close")) return;
				const r = pop.getBoundingClientRect();
				dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top };
				setDragging(true);
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
				e.preventDefault();
			};
			const onDragMove = (e) => {
				const d = dragRef.current;
				if (!d || d.id !== e.pointerId) return;
				const pop = popRef.current;
				if (!pop) return;
				const w = pop.offsetWidth, h = pop.offsetHeight;
				// 钳制在视口内，避免拖出屏幕后无法再抓回来
				const left = Math.min(Math.max(0, d.left + (e.clientX - d.x)), Math.max(0, window.innerWidth - w));
				const top = Math.min(Math.max(0, d.top + (e.clientY - d.y)), Math.max(0, window.innerHeight - h));
				setPos({ left, top });
			};
			const onDragUp = (e) => {
				const d = dragRef.current;
				if (!d || d.id !== e.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
			};

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
				const style = pos
					? { left: pos.left, top: pos.top, width: 300 }
					: rect
						? { left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)), top: Math.max(8, rect.top - 344), width: 300 }
						: { left: 8, bottom: 8, width: 300 };
				const head = React.createElement(
					"div",
					{
						className: "dsb-pop-head",
						title: "按住拖动可移动",
						onPointerDown: onDragDown,
						onPointerMove: onDragMove,
						onPointerUp: onDragUp,
						onPointerCancel: onDragUp,
					},
					React.createElement("span", null, "DeepSeek 余额"),
					React.createElement("button", { type: "button", className: "dsb-pop-close", "aria-label": "关闭", onClick: () => setOpen(false) }, "✕")
				);
				if (balance) {
				let chart;
				if (stats && stats.history && stats.history.length >= 1) {
					// 多天/单天数据：柱状图（SVG）——每根柱子按当日消耗高度缩放；≤7 天时在柱顶显示数值
					const items = stats.history;
					const max = Math.max(0.01, ...items.map((x) => x.spend || 0));
					const n = items.length;
					const W = 276, H = 76, PAD_X = 8, PAD_TOP = 16, PAD_BOT = 24;
					const innerW = W - PAD_X * 2;
					const innerH = H - PAD_TOP - PAD_BOT;
					const barW = Math.max(3, Math.min(18, Math.floor((innerW - (n - 1) * 2) / n)));
					const gap = n > 1 ? Math.max(2, Math.floor((innerW - n * barW) / (n - 1))) : 0;
					const labelAll = n <= 7;
					const fmtDay = (d) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[2] + '-' + m[3] : d.slice(5, 10); };
					const fmtDayShort = (d) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? String(parseInt(m[3])) + '日' : ''; };
					const nodes = [];
					items.forEach((h, i) => {
						const x = PAD_X + i * (barW + gap);
						const barH = Math.max(1, (h.spend / max) * innerH);
						const y = PAD_TOP + innerH - barH;
						nodes.push(React.createElement("g", { key: h.day },
							React.createElement("title", null, h.day + " 消耗 " + fmt(h.spend, balance.currency)),
							React.createElement("rect", { x, y, width: barW, height: barH, rx: 2, className: "dsb-bar" }),
							labelAll ? React.createElement("text", { x: x + barW / 2, y: Math.max(9, y - 4), className: "dsb-val" }, fmt(h.spend, balance.currency)) : null,
							React.createElement("text", { x: x + barW / 2, y: H - 4, className: "dsb-date" }, n <= 7 ? fmtDay(h.day) : fmtDayShort(h.day))));
					});
					chart = React.createElement("div", { className: "dsb-chart" },
						React.createElement("svg", { className: "dsb-line", viewBox: "0 0 " + W + " " + H }, nodes));
				} else {
					chart = React.createElement("div", { className: "dsb-chart-empty" }, "暂无消耗记录，启用后将逐日累积");
				}
				body = React.createElement(
					React.Fragment,
					null,
					React.createElement("div", { className: "dsb-card" },
						React.createElement("div", { className: "dsb-row" },
							React.createElement("span", { className: "dsb-row-label" }, "充值余额"),
							React.createElement("span", { className: "dsb-row-value" }, fmt(balance.toppedUp, balance.currency))),
						Number(balance.granted) > 0 || loading || !balance.isAvailable
							? React.createElement("div", { className: "dsb-row" },
								React.createElement("span", { className: "dsb-row-label" }, "赠金余额"),
								React.createElement("span", { className: "dsb-row-value" }, fmt(balance.granted, balance.currency)))
							: null,
						!balance.isAvailable
							? React.createElement(React.Fragment, null,
								React.createElement("div", { className: "dsb-divider" }),
								React.createElement("div", { className: "dsb-row" },
									React.createElement("span", { className: "dsb-row-label" }, "账户状态"),
									React.createElement("a", { className: "dsb-row-value", href: "https://platform.deepseek.com/usage", target: "_blank", rel: "noopener noreferrer" }, "前往开放平台查看")))
							: null,
						React.createElement("div", { className: "dsb-actions" },
							React.createElement("button", { type: "button", className: "dsb-link-button", onClick: () => load("balance"), disabled: loading },
								loading ? "刷新中…" : "刷新"),
							React.createElement("a", {
								className: "dsb-link-button dsb-primary",
								href: view.topUpUrl || TOP_UP_URL, target: "_blank", rel: "noopener noreferrer",
							}, "充值"))),
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
					chart
				);
				} else {
					body = React.createElement(
						React.Fragment,
						null,
						React.createElement("div", { className: "dsb-err" },
							showErr && errText ? errText : (loading ? "正在查询余额…" : "余额暂不可用")),
						React.createElement("div", { className: "dsb-actions" },
							React.createElement("a", { className: "dsb-link-button", href: "https://platform.deepseek.com/usage", target: "_blank", rel: "noopener noreferrer" }, "前往开放平台查看"),
							React.createElement("button", { type: "button", className: "dsb-link-button", onClick: () => load("balance"), disabled: loading },
								loading ? "刷新中…" : "重试"),
							React.createElement("a", {
								className: "dsb-link-button dsb-primary",
								href: (view && view.topUpUrl) || TOP_UP_URL, target: "_blank", rel: "noopener noreferrer",
							}, "充值"))
					);
				}
				const note = React.createElement("div", { className: "dsb-note" },
					"数据来自 DeepSeek 官方余额接口，约每分钟自动刷新；点击「充值」前往官方充值页。");
				pop = ReactDOM.createPortal(
					React.createElement("div", { ref: popRef, className: "dsb-pop" + (dragging ? " dsb-dragging" : ""), style, role: "dialog", "aria-label": "DeepSeek 余额详情" },
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
