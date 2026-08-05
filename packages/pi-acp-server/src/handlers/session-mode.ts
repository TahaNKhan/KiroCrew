// src/handlers/session-mode.ts — JSON-RPC `session/set_mode` handler.
//
// Per build spec §2.3: no-op. KiroCrew's claude backend skips set_mode
// entirely (client.py:2400) and pi does the same conceptually. Accept the
// request and respond `{}` so the client doesn't hang on a missing reply.
import type { TransportLike } from "../transport-like";
import { type HandlerContext, respond } from "./context";

export function handle(_params: unknown, _ctx: HandlerContext): unknown {
	return {};
}

export function registerOn(transport: TransportLike, ctx: HandlerContext): void {
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as { method?: unknown; id?: unknown; params?: unknown };
		if (m.method !== "session/set_mode") return;
		if (!("id" in m) || m.id === undefined) return;
		const result = handle(m.params, ctx);
		respond(transport, m.id, result);
	});
}
