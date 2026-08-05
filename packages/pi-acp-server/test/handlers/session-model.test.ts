import { describe, it, expect } from "vitest";
import { handle, handleConfigOption, registerOn } from "../../src/handlers/session-model";
import { FakeTransport, FakeCtx } from "./helpers";

describe("session/set_model + session/set_config_option handler", () => {
	it("set_model drives ctx.setModel with params.modelId", () => {
		const ctx = new FakeCtx();
		handle({ sessionId: "s", modelId: "anthropic/claude-opus-4-8" }, ctx);
		expect(ctx.setModelCalls).toEqual(["anthropic/claude-opus-4-8"]);
	});

	it("set_model with empty/missing modelId does not call setModel", () => {
		const ctx = new FakeCtx();
		handle({}, ctx);
		handle({ sessionId: "s" }, ctx);
		expect(ctx.setModelCalls).toEqual([]);
	});

	it("set_config_option with configId='model' drives setModel with option", () => {
		const ctx = new FakeCtx();
		handleConfigOption({ sessionId: "s", configId: "model", option: "claude-opus" }, ctx);
		expect(ctx.setModelCalls).toEqual(["claude-opus"]);
	});

	it("set_config_option with a non-model configId is a no-op", () => {
		const ctx = new FakeCtx();
		handleConfigOption({ sessionId: "s", configId: "effort", option: "high" }, ctx);
		expect(ctx.setModelCalls).toEqual([]);
	});

	it("both handlers reply {} on the transport with the matching id", () => {
		const transport = new FakeTransport();
		const ctx = new FakeCtx();
		registerOn(transport, ctx);

		transport.dispatch({
			id: 21,
			method: "session/set_model",
			params: { sessionId: "s", modelId: "m1" },
		});
		transport.dispatch({
			id: 22,
			method: "session/set_config_option",
			params: { sessionId: "s", configId: "model", option: "m2" },
		});

		expect(transport.writes).toHaveLength(2);
		expect((transport.writes[0] as { id: unknown }).id).toBe(21);
		expect((transport.writes[1] as { id: unknown }).id).toBe(22);
		expect((transport.writes[0] as { result: unknown }).result).toEqual({});
		expect((transport.writes[1] as { result: unknown }).result).toEqual({});
		expect(ctx.setModelCalls).toEqual(["m1", "m2"]);
	});

	it("ignores non-matching methods", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());
		transport.dispatch({ id: 1, method: "session/prompt" });
		expect(transport.writes).toHaveLength(0);
	});

	it("ignores notifications (no id)", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());
		transport.dispatch({ method: "session/set_model" });
		expect(transport.writes).toHaveLength(0);
	});
});
