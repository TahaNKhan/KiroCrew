// src/handlers/session-new.ts — JSON-RPC `session/new` handler.
//
// Per build spec §2.2: response MUST contain a non-empty sessionId (the client
// raises at client.py:2386 if missing). ctx.createSessionId() backs this with
// crypto.randomUUID() in server.ts; we don't call crypto here so tests can
// pin the id deterministically.
import type { TransportLike } from "../transport-like.js";
import { type HandlerContext, respond } from "./context.js";

export function handle(_params: unknown, ctx: HandlerContext): unknown {
	const sessionId = ctx.createSessionId();
	return {
		sessionId,
		modes: [{ modeId: "pi", name: "Pi" }],
	};
}

export function registerOn(transport: TransportLike, ctx: HandlerContext): void {
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as { method?: unknown; id?: unknown; params?: unknown };
		if (m.method !== "session/new") return;
		if (!("id" in m) || m.id === undefined) return;
		const result = handle(m.params, ctx);
		respond(transport, m.id, result);
	});
}
