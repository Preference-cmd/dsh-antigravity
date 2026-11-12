import z from "@deepseek-ai/schemastery";
import { AssistantOutputFold, NO_START_CAPABILITIES, assertUsableCwd, settleRunResult, subprocessRunHandle } from "@deepseek-ai/dsh-subagent";
import { randomUUID } from "node:crypto";
import { brandString } from "@deepseek-ai/dsh-brand";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
// src/print.ts
/**
* Print-mode runner for `agy`: one non-interactive turn over
* `--output-format stream-json`, folded into one subagent result.
*
* The child publishes three event kinds — `init`, `step_update`, and `result`.
* Assistant text arrives as `step_update.text_delta` pieces and the terminal
* `result.response` repeats the completed answer, so the fold prefers the
* streamed text and falls back to the response when no delta was observed.
*
* @module dsh-antigravity/print
*/
/**
* Conservative bound for one `-p` argument. Print mode takes the prompt on the
* command line, where the host caps total argv bytes; a longer prompt fails
* with an actionable diagnostic instead of an opaque `E2BIG` spawn error.
*/
const MAX_PROMPT_BYTES = 131072;
/** Node's maximum timer delay; also the ceiling for one bounded exit wait. */
const MAX_TIMER_DELAY_MS = 2147483647;
/**
* Extra wait beyond the provider's termination grace. The subprocess contract
* lets a provider spend the whole `graceMs` escalating, so waiting exactly that
* long can observe a range that is still being terminated.
*/
const EXIT_MARGIN_MS = 1e3;
/**
* Flatten the prompt into the single argv text print mode accepts.
* @param prompt - the request's content blocks.
* @returns the joined text.
* @throws when the prompt carries a non-text block, which print mode cannot express.
*/
function promptText(prompt) {
	const segments = [];
	for (const block of prompt) {
		if (block.type !== "text") throw new Error(`dsh-antigravity: print mode accepts text prompts only, received a "${block.type}" block`);
		segments.push(block.text);
	}
	return segments.join("\n\n");
}
/** Read the assistant text a `step_update` contributes, if any. */
function stepText(event) {
	const update = event.step_update;
	if (update === void 0 || update.step_type !== "agent_response") return void 0;
	return update.text_delta;
}
/**
* Start one print-mode child and publish its run handle.
* @param request - the start request; its signal is the cancellation channel.
* @param spec - the resolved invocation: command, flags, cwd, env, grace, and spawn.
* @returns the ready run handle for the child process.
*/
async function startPrintRun(request, spec) {
	if (request.signal.aborted) throw new Error("dsh-antigravity: request was aborted before the agy child started");
	const text = promptText(request.prompt);
	if (Buffer.byteLength(text, "utf8") > MAX_PROMPT_BYTES) throw new Error(`dsh-antigravity: prompt exceeds the ${MAX_PROMPT_BYTES} byte print-mode argv limit; shorten the task`);
	const id = brandString(randomUUID());
	const argv = [
		spec.command,
		...spec.args,
		"--output-format",
		"stream-json",
		`-p=${text}`
	];
	let child;
	try {
		child = spec.spawn({
			argv,
			cwd: spec.cwd,
			stdio: {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe"
			},
			graceMs: spec.disposeGraceMs,
			env: spec.env
		});
	} catch (error) {
		throw new Error(`dsh-antigravity: agy could not be spawned: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	/* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
	if (child.stdout === void 0 || child.stderr === void 0) throw new Error("dsh-antigravity: subprocess implementation dropped a piped stream");
	/* v8 ignore stop */
	child.done.catch(() => {});
	const fold = new AssistantOutputFold();
	const flags = { cancelled: false };
	let terminal;
	let failureDetail;
	let stderrText = "";
	let buffered = "";
	const observeLine = (line) => {
		if (line.length === 0) return;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		const delta = stepText(event);
		if (delta !== void 0) fold.pushText(delta);
		if (event.result !== void 0) terminal = event.result;
	};
	const consume = (chunk) => {
		buffered += chunk;
		let index = buffered.indexOf("\n");
		while (index !== -1) {
			observeLine(buffered.slice(0, index).trim());
			buffered = buffered.slice(index + 1);
			index = buffered.indexOf("\n");
		}
	};
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", consume);
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderrText += chunk;
	});
	let settleCancel;
	const cancelSettled = new Promise((resolve) => {
		settleCancel = resolve;
	});
	const requestCancel = () => {
		if (flags.cancelled) return;
		flags.cancelled = true;
		settleCancel();
		child.terminate();
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	const collectOutput = () => fold.collect() ?? [];
	const collectDiagnostic = () => {
		if (failureDetail !== void 0) return failureDetail;
		const trimmed = stderrText.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	};
	const result = settleRunResult({
		attempt: async () => {
			await Promise.race([child.done, cancelSettled.then(() => {
				throw new Error("subagent cancelled while the agy turn was running");
			})]);
			observeLine(buffered.trim());
			const settled = terminal;
			if (settled === void 0) throw new Error("dsh-antigravity: agy exited without reporting a result event");
			if (settled.status !== "SUCCESS") {
				failureDetail = `agy reported ${settled.status ?? "no status"}: ${settled.error ?? settled.response ?? "no detail"}`;
				throw new Error(`dsh-antigravity: ${failureDetail}`);
			}
			if (fold.collect() === void 0 && settled.response !== void 0 && settled.response.length > 0) fold.pushText(settled.response);
			return {
				output: collectOutput(),
				stopReason: "completed"
			};
		},
		collectOutput,
		collectDiagnostic,
		cancelled: () => flags.cancelled,
		...spec.onError === void 0 ? {} : { onError: spec.onError },
		signal: request.signal,
		onAbort
	});
	return subprocessRunHandle({
		id,
		result,
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown: async () => {
			child.terminate();
			const deadline = Math.min(MAX_TIMER_DELAY_MS, Math.ceil(spec.disposeGraceMs) + EXIT_MARGIN_MS);
			if (!await child.waitForExit(AbortSignal.timeout(deadline))) throw new Error(`dsh-antigravity: agy did not exit within ${deadline}ms; the process range is still live`);
		}
	});
}
// src/provider.ts
/** Provider name the model-facing tool refers to. */
const PROVIDER_NAME = "antigravity";
/** Execution modes `agy --mode` accepts. */
const ANTIGRAVITY_MODES = [
	"accept-edits",
	"auto",
	"plan"
];
/** Reasoning efforts `agy --effort` accepts. */
const ANTIGRAVITY_EFFORTS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
/**
* Compose the deployment flags for one run.
* @param config - resolved provider settings.
* @returns the flags placed before `--output-format` and the prompt.
*/
function deploymentArgs(config) {
	const args = [];
	if (config.model !== void 0) args.push("--model", config.model);
	if (config.mode !== void 0) args.push("--mode", config.mode);
	if (config.effort !== void 0) args.push("--effort", config.effort);
	args.push(...config.args);
	return args;
}
/** One `agy` print-mode provider instance. */
var AntigravityProvider = class {
	name;
	ctx;
	config;
	capabilities = NO_START_CAPABILITIES;
	inheritsParentContext = false;
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
	}
	async start(request) {
		let cwd;
		try {
			cwd = assertUsableCwd("dsh-antigravity", "child cwd", request.cwd);
		} catch (error) {
			this.ctx.logger.warn(`dsh-antigravity "${this.name}": child start failed: %o`, error);
			throw new Error(`dsh-antigravity: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
		if (request.signal.aborted) throw new Error("dsh-antigravity: request was aborted before the agy child started");
		return startPrintRun(request, {
			command: this.config.command,
			args: deploymentArgs(this.config),
			cwd,
			env: this.config.env,
			disposeGraceMs: this.config.disposeGraceMs,
			spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`dsh-antigravity "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
/**
* Register the provider on the subagent service.
* @param ctx - context carrying the subagent and subprocess services.
* @param config - resolved provider settings.
*/
function registerAntigravityProvider(ctx, config) {
	ctx.effect(() => ctx.subagents.registerProvider(new AntigravityProvider(config.providerName, ctx, config)));
}
// src/protocol.ts
/**
* The panel's wire types: what the Host route returns and where it lives.
* Imported by both faces, so it must stay free of Node-only imports.
*
* @module dsh-antigravity/protocol
*/
/** The authenticated route the browser half reads. */
const STATUS_PATH = "/api/antigravity/status";
// src/status.ts
/**
* Host-side Antigravity account and quota probe.
*
* Every datum comes from a slash command the CLI answers itself: they cost no
* model tokens (`num_turns: 0`, zeroed usage), so the panel may refresh them
* freely. `agy models` is the sign-in probe — unlike a prompt it fails fast
* instead of blocking in an interactive OAuth flow.
*
* @module dsh-antigravity/status
*/
/** Default binary location: the per-user install `agy` documents. */
function defaultCommand() {
	return process.env.AGY_BIN ?? join(homedir(), ".local", "bin", "agy");
}
/**
* Run one CLI invocation and capture its streams.
* @param command - the `agy` executable.
* @param args - arguments after the executable.
* @param timeoutMs - hard limit for the child process.
* @returns the outcome; a spawn failure is `missing`, a non-zero exit is `failed`.
*/
function run(command, args, timeoutMs) {
	return new Promise((resolve) => {
		execFile(command, [...args], {
			timeout: timeoutMs,
			maxBuffer: 4194304
		}, (error, stdout, stderr) => {
			if (error === null) {
				resolve({
					kind: "ok",
					stdout
				});
				return;
			}
			if (typeof error.code !== "number") {
				resolve({ kind: "missing" });
				return;
			}
			resolve({
				kind: "failed",
				code: error.code,
				stderr
			});
		});
	});
}
/**
* Read one slash-command payload.
* @param command - the `agy` executable.
* @param slash - the command text, e.g. `/usage`.
* @returns the decoded JSON body, or undefined when the call failed.
*/
async function readSlash(command, slash) {
	const outcome = await run(command, [
		"--output-format",
		"json",
		`-p=${slash}`
	], 2e4);
	if (outcome.kind !== "ok") return void 0;
	try {
		const parsed = JSON.parse(outcome.stdout);
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/** Read one nested object path without assuming the CLI's full envelope. */
function at(value, ...path) {
	let current = value;
	for (const key of path) {
		if (typeof current !== "object" || current === null) return void 0;
		current = current[key];
	}
	return current;
}
/** Project the CLI's `/usage` envelope onto the panel's quota rows. */
function readQuota(payload) {
	const groups = at(payload, "command", "data", "groups");
	if (!Array.isArray(groups)) return [];
	const quota = [];
	for (const group of groups) {
		if (typeof group !== "object" || group === null) continue;
		const name = group.name;
		const buckets = group.buckets;
		if (typeof name !== "string" || !Array.isArray(buckets)) continue;
		const rows = [];
		for (const bucket of buckets) {
			if (typeof bucket !== "object" || bucket === null) continue;
			const fields = bucket;
			if (typeof fields.id !== "string" || typeof fields.remaining_fraction !== "number") continue;
			rows.push({
				id: fields.id,
				name: typeof fields.name === "string" ? fields.name : fields.id,
				window: typeof fields.window === "string" ? fields.window : "",
				remainingFraction: Math.min(1, Math.max(0, fields.remaining_fraction)),
				resetTime: typeof fields.reset_time === "string" ? fields.reset_time : ""
			});
		}
		quota.push({
			group: name,
			buckets: rows
		});
	}
	return quota;
}
/** Project the CLI's `/credits` envelope onto the panel's credits row. */
function readCredits(payload) {
	const remaining = at(payload, "command", "data", "remaining_credits");
	const upgrade = at(payload, "command", "data", "upgrade_uri");
	if (typeof remaining !== "number") return void 0;
	return {
		remaining,
		upgradeUri: typeof upgrade === "string" ? upgrade : ""
	};
}
/**
* Probe one account: sign-in first, then the two zero-cost quota commands.
* @param command - the `agy` executable.
* @returns the panel payload with a fixed reason when something is missing.
*/
async function readAntigravityStatus(command) {
	const checkedAt = Date.now();
	const [signIn, usage, credits] = await Promise.all([
		run(command, ["models"], 15e3),
		readSlash(command, "/usage"),
		readSlash(command, "/credits")
	]);
	if (signIn.kind === "missing") return {
		state: "unavailable",
		checkedAt,
		quota: [],
		detail: "binary-not-found"
	};
	if (signIn.kind === "failed") return {
		state: "signed-out",
		checkedAt,
		quota: [],
		detail: "not-signed-in"
	};
	const quota = readQuota(usage);
	const credit = readCredits(credits);
	return {
		state: "signed-in",
		checkedAt,
		quota,
		...credit === void 0 ? {} : { credits: credit },
		...quota.length === 0 ? { detail: "quota-unavailable" } : {}
	};
}
// src/index.ts
const name = "dsh-antigravity";
/**
* Both halves are topology-dependent: a profile without a browser surface has
* no `connection`, and one without delegation has no `subagents`. Each half
* therefore mounts inside its own injection scope.
*/
const inject = [];
const Config = z.object({
	command: z.string(),
	refreshMs: z.natural().default(6e4),
	providerName: z.string().min(1).default(PROVIDER_NAME),
	model: z.string().min(1),
	mode: z.union([...ANTIGRAVITY_MODES]),
	effort: z.union([...ANTIGRAVITY_EFFORTS]),
	args: z.array(z.string()).default([]),
	env: z.dict(z.string()).default({}),
	disposeGraceMs: z.natural().default(3e3)
});
/**
* Register the provider and serve the account status.
* @param ctx - Host plugin context.
* @param config - resolved plugin config.
*/
function apply(ctx, config) {
	const command = config.command ?? defaultCommand();
	if (config.disposeGraceMs <= 0 || config.disposeGraceMs > 2147483647) throw new Error(`dsh-antigravity: disposeGraceMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`);
	ctx.inject(["subagents", "subprocess"], (scoped) => {
		registerAntigravityProvider(scoped, {
			providerName: config.providerName,
			command,
			...config.model === void 0 ? {} : { model: config.model },
			...config.mode === void 0 ? {} : { mode: config.mode },
			...config.effort === void 0 ? {} : { effort: config.effort },
			args: config.args,
			env: config.env,
			disposeGraceMs: config.disposeGraceMs
		});
	});
	ctx.inject(["connection"], (scoped) => {
		let cached;
		let inflight;
		const read = (force) => {
			if (!force && cached !== void 0 && Date.now() - cached.at < config.refreshMs) return Promise.resolve(cached.value);
			inflight ??= readAntigravityStatus(command).catch(() => ({
				state: "unavailable",
				checkedAt: Date.now(),
				quota: [],
				detail: "probe-failed"
			})).then((value) => {
				cached = {
					at: Date.now(),
					value
				};
				inflight = void 0;
				return value;
			});
			return inflight;
		};
		scoped.effect(() => scoped.connection.fetch.register({
			path: STATUS_PATH,
			methods: ["GET"],
			requestBody: "buffered",
			fetch: async (request) => Response.json(await read(new URL(request.url).searchParams.has("refresh")))
		}), "antigravity-status: read route");
	});
}
export { Config, STATUS_PATH, apply, inject, name };
