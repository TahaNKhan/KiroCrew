import { describe, it, expect } from "vitest";
import { handle, registerOn } from "../../src/handlers/session-mode";
import { FakeTransport, FakeCtx } from "./helpers";

describe("session/set_mode handler", () => {
	it("returns empty result regardless of params", () => {
		expect(handle({ sessionId: "x", modeId: "anything" }, new FakeCtx())).toEqual({});
		expect(handle({}, new FakeCtx())).toEqual({});
	});

	it("does not touch the context (no-op contract)", () => {
		const ctx = new FakeCtx();
		handle({ modeId: "toolsmith" }, ctx);
		expect(ctx.setModelCalls).toEqual([]);
	});

	it("replies with empty result on the transport", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());

		transport.dispatch({ id: 11, method: "session/set_mode", params: { modeId: "x" } });

		expect(transport.writes).toHaveLength(1);
		const reply = transport.writes[0] as { id: unknown; result: unknown };
		expect(reply.id).toBe(11);
		expect(reply.result).toEqual({});
	});

	it("ignores other methods", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());
		transport.dispatch({ id: 1, method: "session/prompt" });
		expect(transport.writes).toHaveLength(0);
	});
});
