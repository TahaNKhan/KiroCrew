// src/handlers/context.ts — shared context + tiny respond helper for handlers.
//
// HandlerContext is the narrow surface handlers are allowed to touch. The wider
// runtime (server.ts wires this from the AgentSession + permission gate) owns
// the rest. Keeping the surface small makes per-handler tests trivial — every
// test substitutes a FakeContext with setModel spy.
import type { TransportLike } from "../transport-like";

export interface HandlerContext {
	/** Update the model the server advertises + hands to pi. */
	setModel(model: string): void;
	/** Current model id (read-only to handlers; server.ts owns it). */
	getModel(): string;
	/** Currently active session id, or null before session/new completes. */
	currentSessionId(): string | null;
	/** Mint a fresh session id (server.ts backs this with crypto.randomUUID). */
	createSessionId(): string;
}

/** Send a JSON-RPC response frame. Mirrors the client's _send_response shape
 * (src/kiro_crew/acp/client.py:2517): `{jsonrpc, id, result}`. */
export function respond(transport: TransportLike, id: unknown, result: unknown): void {
	transport.write({ jsonrpc: "2.0", id, result });
}
