window.__ModuleLoader__.load({
	id: "dsh-antigravity",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/protocol.ts
		/**
		* The panel's wire types: what the Host route returns and where it lives.
		* Imported by both faces, so it must stay free of Node-only imports.
		*
		* @module dsh-antigravity/protocol
		*/
		/** The authenticated route the browser half reads. */
		const STATUS_PATH = "/api/antigravity/status";
		// src/client/StatusPanel.tsx
		/**
		* The bundle page's status section: sign-in state, quota windows, and credits.
		* It renders only for this plugin's own bundle, so the slot stays quiet on
		* every other plugin page.
		*
		* @module dsh-antigravity/client/StatusPanel
		*/
		/**
		* Format an instant in the Harness language, which the locale service publishes
		* on the document, rather than in the operating system's locale.
		* @param value - epoch milliseconds or an ISO instant.
		* @returns the localized date and time.
		*/
		function formatInstant(value, withTime) {
			const language = document.documentElement.lang;
			const locale = language === "" ? void 0 : language;
			const instant = new Date(value);
			return withTime ? instant.toLocaleString(locale) : instant.toLocaleTimeString(locale);
		}
		/** The section entry rendered for a plugin detail page. */
		function StatusPanel({ subject, t }) {
			if (subject.kind !== "bundle" || subject.pkg?.name !== "dsh-antigravity") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusCard, { t });
		}
		const BORDER = "var(--dsw-alias-border-l1, #ddd)";
		const LABEL_PRIMARY = "var(--dsw-alias-label-primary, inherit)";
		const LABEL_SECONDARY = "var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.6))";
		const LABEL_TERTIARY = "var(--dsw-alias-label-tertiary, rgba(0, 0, 0, 0.45))";
		const SUCCESS = "var(--dsw-alias-state-success-primary, #2f9e44)";
		const WARN = "var(--dsw-alias-state-warn-primary, #f08c00)";
		const ERROR = "var(--dsw-alias-state-error-primary, #e03131)";
		/** Remaining share at which a window stops reading as comfortable. */
		function barColor(fraction) {
			if (fraction <= .1) return ERROR;
			if (fraction <= .3) return WARN;
			return SUCCESS;
		}
		/** One quota window: label, remaining bar, and its refresh instant. */
		function BucketRow({ t, name, fraction, resetTime }) {
			const percent = Math.round(fraction * 100);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 4
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						justifyContent: "space-between",
						gap: 12,
						fontSize: 12,
						color: LABEL_SECONDARY
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { color: LABEL_TERTIARY },
						children: [`${t("remaining")} ${percent}%`, resetTime === "" ? "" : ` · ${t("resetAt")} ${formatInstant(resetTime, true)}`]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						height: 6,
						borderRadius: 3,
						background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))"
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
						width: `${Math.max(2, percent)}%`,
						height: "100%",
						borderRadius: 3,
						background: barColor(fraction)
					} })
				})]
			});
		}
		/** The card itself: fetch on mount, refresh on demand. */
		function StatusCard({ t }) {
			const [status, setStatus] = (0, react.useState)(void 0);
			const [failed, setFailed] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(true);
			const load = (0, react.useCallback)(async (force) => {
				setBusy(true);
				setFailed(false);
				try {
					const response = await fetch(force ? `${STATUS_PATH}?refresh=1` : STATUS_PATH, { headers: { accept: "application/json" } });
					if (!response.ok) throw new Error(`status ${response.status}`);
					setStatus(await response.json());
				} catch {
					setFailed(true);
				} finally {
					setBusy(false);
				}
			}, []);
			(0, react.useEffect)(() => {
				load(false);
			}, [load]);
			const badge = failed || status?.state === "unavailable" ? {
				text: t("unavailable"),
				color: ERROR
			} : status === void 0 ? {
				text: t("checking"),
				color: LABEL_TERTIARY
			} : status.state === "signed-in" ? {
				text: t("signedIn"),
				color: SUCCESS
			} : {
				text: t("signedOut"),
				color: WARN
			};
			const hint = failed ? t("failedHint") : status === void 0 ? void 0 : status.detail === "binary-not-found" ? t("missingHint") : status.state === "unavailable" ? t("failedHint") : status.state === "signed-out" ? t("signedOutHint") : status.quota.length === 0 ? t("quotaUnavailable") : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 12,
					padding: 16,
					border: `0.5px solid ${BORDER}`,
					borderRadius: 10
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 12
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 13,
									fontWeight: 600,
									color: LABEL_PRIMARY
								},
								children: t("title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									display: "inline-flex",
									alignItems: "center",
									gap: 5,
									fontSize: 12,
									color: LABEL_SECONDARY
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
									width: 7,
									height: 7,
									borderRadius: "50%",
									background: badge.color
								} }), badge.text]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								load(true);
							},
							disabled: busy,
							style: {
								fontSize: 12,
								padding: "3px 10px",
								borderRadius: 6,
								cursor: busy ? "default" : "pointer",
								color: LABEL_SECONDARY,
								background: "transparent",
								border: `0.5px solid ${BORDER}`,
								opacity: busy ? .5 : 1
							},
							children: busy ? t("checking") : t("refresh")
						})]
					}),
					hint === void 0 ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: 0,
							fontSize: 12,
							color: LABEL_TERTIARY
						},
						children: hint
					}),
					status?.quota.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 12,
								fontWeight: 600,
								color: LABEL_SECONDARY
							},
							children: group.group
						}), group.buckets.map((bucket) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BucketRow, {
							t,
							name: bucket.name,
							fraction: bucket.remainingFraction,
							resetTime: bucket.resetTime
						}, bucket.id))]
					}, group.group)),
					status?.credits === void 0 ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							justifyContent: "space-between",
							fontSize: 12,
							color: LABEL_SECONDARY
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("credits") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.credits.remaining })]
					}),
					status === void 0 ? void 0 : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
						style: {
							fontSize: 11,
							color: LABEL_TERTIARY
						},
						children: `${t("checkedAt")} ${formatInstant(status.checkedAt, false)}`
					})
				]
			});
		}
		// src/client/locales.ts
		/** Locale namespace owned by this plugin's status section. */
		const NS = "dshAntigravity";
		/** Chinese dictionary; the key set is the source of truth. */
		const zh = {
			title: "Antigravity",
			refresh: "刷新",
			checking: "读取中…",
			signedIn: "已登录",
			signedOut: "未登录",
			unavailable: "不可用",
			signedOutHint: "在终端运行 agy 完成 Google 登录后，这里会显示用量限额。",
			missingHint: "没有找到 agy。安装 Antigravity CLI，或用 AGY_BIN 指定可执行文件路径。",
			failedHint: "读取失败，稍后重试。",
			quotaUnavailable: "已登录，但这次没有读到限额数据。",
			credits: "G1 额度",
			remaining: "剩余",
			resetAt: "重置",
			checkedAt: "更新于"
		};
		/** English dictionary; completeness is checked against {@link AntigravityKey}. */
		const en = {
			title: "Antigravity",
			refresh: "Refresh",
			checking: "Reading…",
			signedIn: "Signed in",
			signedOut: "Signed out",
			unavailable: "Unavailable",
			signedOutHint: "Run agy in a terminal to finish Google sign-in; quotas appear here afterwards.",
			missingHint: "agy was not found. Install the Antigravity CLI or point AGY_BIN at the executable.",
			failedHint: "Could not read the account. Try again shortly.",
			quotaUnavailable: "Signed in, but no quota rows came back this time.",
			credits: "G1 credits",
			remaining: "remaining",
			resetAt: "resets",
			checkedAt: "Updated"
		};
		// src/client/index.ts
		const inject = ["slots", "locale"];
		/**
		* Register the dictionaries and the section entry.
		* @param ctx - Browser plugin context; the injected services are ready because of {@link inject}.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-antigravity: dictionaries");
			ctx.slots.inject("plugins.detail.section", () => ctx.slots.register({
				name: "plugins.detail.section",
				id: "antigravity-status",
				locale: NS
			}, StatusPanel));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
