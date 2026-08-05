import { describe, it, expect } from "vitest";
import { handle, registerOn } from "../../src/handlers/initialize";
import { FakeTransport, FakeCtx } from "./helpers";

describe("initialize handler", () => {
	it("returns the spec-correct shape", () => {
		const result = handle({}, new FakeCtx()) as Record<string, unknown>;

		expect(result.protocolVersion).toBe(1);
		// Must be the NUMBER 1, not "1" — clients (incl. KiroCrew's
		// AcpClient._initialize_session at client.py:2268) branch on
		// isinstance(protocol_version, int). A string "1" silently breaks
		// the handshake on real clients.
		expect(typeof result.protocolVersion).toBe("number");

		const caps = result.agentCapabilities as { loadSession: boolean };
		expect(caps.loadSession).toBe(false);

		const modes = result.modes as Array<{ modeId: string; name: string }>;
		expect(modes).toEqual([{ modeId: "pi", name: "Pi" }]);

		const opts = result.configOptions as Array<{ id: string }>;
		expect(opts.length).toBeGreaterThanOrEqual(1);
		expect(opts.some((o) => o.id === "model")).toBe(true);
	});

	it("registers on the transport and replies to requests with the shape", () => {
		const transport = new FakeTransport();
		const ctx = new FakeCtx();
		registerOn(transport, ctx);

		transport.dispatch({
			jsonrpc: "2.0",
			id: 42,
			method: "initialize",
			params: { protocolVersion: 1 },
		});

		expect(transport.writes).toHaveLength(1);
		const reply = transport.writes[0] as { id: unknown; result: unknown };
		expect(reply.id).toBe(42);
		const r = reply.result as { protocolVersion: unknown; modes: unknown[] };
		expect(r.protocolVersion).toBe(1);
		expect(Array.isArray(r.modes)).toBe(true);
	});

	it("ignores initialize notifications (no id)", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());

		transport.dispatch({ method: "initialize" }); // no id

		expect(transport.writes).toHaveLength(0);
	});

	it("ignores messages for other methods", () => {
		const transport = new FakeTransport();
		registerOn(transport, new FakeCtx());

		transport.dispatch({ id: 1, method: "session/new" });

		expect(transport.writes).toHaveLength(0);
	});
});
