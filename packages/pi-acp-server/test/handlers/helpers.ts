// test/handlers/helpers.ts — shared test fixtures for handler tests.
//
// FakeTransport captures writes (sync, like the real Transport's write) so
// tests can assert the response frame byte-for-byte. FakeCtx exposes a
// setModel spy via a Set, plus deterministic session id minting for tests
// that need to assert sessionId presence.
import type { MessageHandler } from "../../src/transport";
import type { TransportLike } from "../../src/transport-like";
import type { HandlerContext } from "../../src/handlers/context";

export class FakeTransport implements TransportLike {
	readonly writes: unknown[] = [];
	private readonly handlers: MessageHandler[] = [];

	write(msg: unknown): void {
		this.writes.push(msg);
	}

	onMessage(handler: MessageHandler): void {
		this.handlers.push(handler);
	}

	/** Feed a parsed message through the handler chain (mirrors real transport
	 * line → parse → handler dispatch in transport.ts). */
	dispatch(msg: unknown): void {
		for (const h of this.handlers) h(msg);
	}
}

export class FakeCtx implements HandlerContext {
	private model = "";
	private nextId = 1;
	readonly setModelCalls: string[] = [];

	setModel(model: string): void {
		this.model = model;
		this.setModelCalls.push(model);
	}

	getModel(): string {
		return this.model;
	}

	currentSessionId(): string | null {
		return null;
	}

	createSessionId(): string {
		const id = `test-session-${this.nextId}`;
		this.nextId += 1;
		return id;
	}
}
