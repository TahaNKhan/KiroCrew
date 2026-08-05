// src/handlers/session-model.ts — JSON-RPC `session/set_model` +
// `session/set_config_option` handler.
//
// Per build spec §2.4: both methods drive `ctx.setModel(value)` and respond
// `{}`. `set_model` params: `{sessionId, modelId}` — value is `modelId`.
// `set_config_option` params: `{sessionId, configId, option}` — only
// `configId === "model"` is wired (the only option the server advertises in
// initialize). Other configIds are ignored so a future configOption addition
// doesn't silently trigger model changes.
import type { TransportLike } from "../transport-like.js";
import { type HandlerContext, respond } from "./context.js";

export function handle(params: unknown, ctx: HandlerContext): unknown {
	const p = (params ?? {}) as { modelId?: unknown };
	const modelId = typeof p.modelId === "string" ? p.modelId : "";
	if (modelId) ctx.setModel(modelId);
	return {};
}

export function handleConfigOption(params: unknown, ctx: HandlerContext): unknown {
	const p = (params ?? {}) as { configId?: unknown; option?: unknown };
	if (p.configId === "model") {
		const option = typeof p.option === "string" ? p.option : "";
		if (option) ctx.setModel(option);
	}
	return {};
}

export function registerOn(transport: TransportLike, ctx: HandlerContext): void {
	transport.onMessage((msg: unknown) => {
		if (!msg || typeof msg !== "object") return;
		const m = msg as { method?: unknown; id?: unknown; params?: unknown };
		if (!("id" in m) || m.id === undefined) return;
		let result: unknown;
		if (m.method === "session/set_model") {
			result = handle(m.params, ctx);
		} else if (m.method === "session/set_config_option") {
			result = handleConfigOption(m.params, ctx);
		} else {
			return;
		}
		respond(transport, m.id, result);
	});
}
