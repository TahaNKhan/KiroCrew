// src/handlers/initialize.ts — JSON-RPC `initialize` handler.
//
// Per build spec §2.1: protocolVersion is the INTEGER 1 (claude-agent-acp
// form), NOT the kiro date-string "2025-08-22". `loadSession: false` makes
// KiroCrew's AcpClient skip `session/load` entirely (client.py:2282). The
// `modes` array feeds only the dashboard's agent dropdown — single synthetic
// entry is enough. `configOptions` advertises the `model` selector; T06 will
// expand the option list as models are wired.
import type { TransportLike } from "../transport-like.js";
import { type HandlerContext, respond } from "./context.js";

export function handle(_params: unknown, _ctx: HandlerContext): unknown {
	return {
		protocolVersion: 1,
		agentCapabilities: {
			loadSession: false,
		},
		modes: [{ modeId: "pi", name: "Pi" }],
		configOptions: [{ id: "model", options: [] }],
	};
}

export function registerOn(transport: TransportLike, ctx: HandlerContext): void {
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as { method?: unknown; id?: unknown; params?: unknown };
		if (m.method !== "initialize") return;
		if (!("id" in m) || m.id === undefined) return;
		const result = handle(m.params, ctx);
		respond(transport, m.id, result);
	});
}
