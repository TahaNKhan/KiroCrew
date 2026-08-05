import { describe, it, expect } from "vitest";
import { handle, registerOn } from "../../src/handlers/session-new";
import { FakeTransport, FakeCtx } from "./helpers";

describe("session/new handler", () => {
	it("returns a non-empty sessionId and the pi mode", () => {
		const ctx = new FakeCtx();
		const result = handle({ cwd: "/tmp" }, ctx) as {
			sessionId: string;
			modes: Array<{ modeId: string }>;
		};

		expect(result.sessionId).toBeTruthy();
		expect(typeof result.sessionId).toBe("string");
		expect(result.sessionId.length).toBeGreaterThan(0);
		expect(result.modes).toEqual([{ modeId: "pi", name: "Pi" }]);
	});

	it("mints a fresh sessionId per call", () => {
		const ctx = new FakeCtx();
		const a = handle({}, ctx) as { sessionId: string };
		const b = handle({}, ctx) as { sessionId: string };
		expect(a.sessionId).not.toBe(b.sessionId);
	});

	it("replies on the transport with the same id", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());

		transport.dispatch({ id: 7, method: "session/new", params: {} });

		expect(transport.writes).toHaveLength(1);
		const reply = transport.writes[0] as { id: unknown; result: { sessionId: string } };
		expect(reply.id).toBe(7);
		expect(reply.result.sessionId).toBeTruthy();
	});

	it("ignores notifications (no id)", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());
		transport.dispatch({ method: "session/new" });
		expect(transport.writes).toHaveLength(0);
	});
});
