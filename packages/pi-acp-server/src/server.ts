// src/server.ts — stdio JSON-RPC main loop wiring the ACP handlers.
//
// Reads newline-delimited JSON-RPC frames from `input`, dispatches to the
// right handler by `msg.method`, writes responses/notifications to `output`.
// Unknown methods with an id get `-32601 Method not found`; unknown
// notifications are silently ignored. `startServer` returns a Promise that
// resolves when the input stream ends/closes.
//
// Maps to build spec §2 (Protocol contract) + §2.7 (unknown → -32601).
import type { Readable, Writable } from "node:stream";
import { Transport } from "./transport.js";
import { registerOn as regInit } from "./handlers/initialize";
import { registerOn as regNew } from "./handlers/session-new";
import { registerOn as regMode } from "./handlers/session-mode";
import { registerOn as regModel } from "./handlers/session-model";
import { handleSessionPrompt, type PiSessionLike } from "./handlers/session-prompt";
import { handleCancel } from "./handlers/cancel";
import { type HandlerContext } from "./handlers/context.js";

const KNOWN_METHODS = new Set([
	"initialize",
	"session/new",
	"session/load",
	"session/set_mode",
	"session/set_model",
	"session/set_config_option",
	"session/prompt",
	"cancel",
]);

export interface ServerOptions {
	input?: Readable;
	output?: Writable;
	/** Override the default no-op PiSessionLike. Real pi agents inject here. */
	piSession?: PiSessionLike;
	logger?: (msg: string) => void;
}

export function createHandlerContext(): HandlerContext {
	let model = "";
	let sessionId: string | null = null;
	return {
		setModel(m: string) {
			model = m;
		},
		getModel() {
			return model;
		},
		currentSessionId() {
			return sessionId;
		},
		createSessionId() {
			sessionId = crypto.randomUUID();
			return sessionId;
		},
	};
}

/** Default PiSessionLike: resolves immediately with stopReason "end_turn".
 * Real pi agents inject their own via ServerOptions.piSession. */
const NOOP_PI_SESSION: PiSessionLike = {
	async prompt(): Promise<{ stopReason: "end_turn" | "cancelled" }> {
		return { stopReason: "end_turn" };
	},
	abort(): void {
		/* no in-flight turn */
	},
};

export async function startServer(opts: ServerOptions = {}): Promise<void> {
	const input: Readable = opts.input ?? process.stdin;
	const output: Writable = opts.output ?? process.stdout;
	const logger = opts.logger ?? ((m: string) => process.stderr.write(`[server] ${m}\n`));

	const transport = new Transport({ input, output, logger });
	const ctx = createHandlerContext();
	const piSession = opts.piSession ?? NOOP_PI_SESSION;

	// Default dispatcher: route known methods to the registered handlers, fall
	// through to -32601 for unknown requests. Notifications (no id) with
	// unknown methods are ignored — JSON-RPC semantics never require a reply.
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as { method?: unknown; id?: unknown };
		if (typeof m.method !== "string") return;
		if (KNOWN_METHODS.has(m.method)) return; // a handler owns this
		if (!("id" in m) || m.id === undefined) return; // unknown notification
		transport.write({
			jsonrpc: "2.0",
			id: m.id,
			error: { code: -32601, message: "Method not found" },
		});
	});

	regInit(transport, ctx);
	regNew(transport, ctx);
	regMode(transport, ctx);
	regModel(transport, ctx);

	// session/prompt + cancel are wired manually — they share a PiSessionLike.
	// piSession.abort() inside the cancel handler flips the in-flight
	// prompt's awaitable, so no separate tracking is needed here.
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as {
			method?: unknown;
			id?: unknown;
			params?: { sessionId?: string; messages?: Array<{ role: string; content: unknown }> };
		};
		if (m.method === "session/prompt") {
			if (typeof m.id === "undefined" || m.id === null) return;
			const sessionId = m.params?.sessionId ?? "";
			const messages = m.params?.messages ?? [];
			void handleSessionPrompt(transport, { sessionId, piSession }, m.id as number, {
				sessionId,
				messages,
			});
			return;
		}
		if (m.method === "cancel") {
			handleCancel(transport, {
				piSession,
				cancelInFlight: () => {
					/* in-flight prompt's awaitable resolves with stopReason:cancelled
					 * when piSession.abort() fires — no server-side tracking needed */
				},
			});
			return;
		}
	});

	transport.start();

	return new Promise<void>((resolve) => {
		const finish = () => {
			transport.stop();
			resolve();
		};
		input.on("end", finish);
		input.on("close", finish);
	});
}
