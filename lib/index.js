import z from "@deepseek-ai/schemastery";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
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
const name = "antigravity-status";
/** The route needs the browser surface only; a headless profile skips it. */
const inject = [];
const Config = z.object({
	command: z.string(),
	refreshMs: z.natural().default(6e4)
});
/**
* Serve the account status from a scope that exists only where `connection` does.
* @param ctx - Host plugin context.
* @param config - resolved plugin config.
*/
function apply(ctx, config) {
	const command = config.command ?? defaultCommand();
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
