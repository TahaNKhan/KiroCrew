// test/transport.test.ts — Transport unit tests (newline JSON-RPC framing).
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transport, type TransportOptions } from "../src/transport.js";

function makeTransport() {
	const input = new PassThrough();
	const output = new PassThrough();
	const captured: string[] = [];
	output.on("data", (c: Buffer) => captured.push(c.toString()));
	const messages: unknown[] = [];
	// TransportOptions uses node:stream's abstract Readable/Writable; PassThrough
	// satisfies the runtime shape but TS rejects it because the abstract types
	// expose Node 25's internal stream state. Cast at the seam.
	const opts: TransportOptions = {
		input: input as unknown as TransportOptions["input"],
		output: output as unknown as TransportOptions["output"],
	};
	const t = new Transport(opts);
	t.onMessage((m) => messages.push(m));
	return { t, input, output, messages, captured };
}

// Wait one microtask + a macrotask so readline's line event has a chance to fire.
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("Transport", () => {
	let tr: ReturnType<typeof makeTransport>;

	beforeEach(() => {
		tr = makeTransport();
		tr.t.start();
	});

	afterEach(() => {
		tr.t.stop();
	});

	it("reads a JSON frame and delivers the parsed object", async () => {
		tr.input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
		await tick();
		expect(tr.messages).toHaveLength(1);
		expect(tr.messages[0]).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
	});

	it("skips non-JSON lines silently (no throw, no log to stderr)", async () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		tr.input.write("not json at all\n");
		tr.input.write("{\n");
		tr.input.write("\n");
		await tick();
		expect(tr.messages).toHaveLength(0);
		// stderr must remain silent for skipped garbage — stdout cleanliness
		// is the wire contract and stderr noise would defeat diagnostics.
		expect(stderrSpy).not.toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("skips empty lines silently", async () => {
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		tr.input.write("\n");
		tr.input.write("   \n"); // whitespace-only — trim() yields ""
		await tick();
		expect(tr.messages).toHaveLength(0);
		expect(stderrSpy).not.toHaveBeenCalled();
		stderrSpy.mockRestore();
	});

	it("writes JSON.stringify(msg) + \"\\n\" to output", () => {
		tr.t.write({ jsonrpc: "2.0", id: 1, result: "ok" });
		expect(tr.captured.join("")).toBe('{"jsonrpc":"2.0","id":1,"result":"ok"}\n');
	});

	it("round-trips: write → read on a connected pair", async () => {
		// Wire two Transports through a connected PassThrough pair and verify
		// what one writes, the other parses back as the same object.
		const a2b = new PassThrough();
		const b2a = new PassThrough();
		const a = new Transport({
			input: b2a as unknown as TransportOptions["input"],
			output: a2b as unknown as TransportOptions["output"],
		});
		const b = new Transport({
			input: a2b as unknown as TransportOptions["input"],
			output: b2a as unknown as TransportOptions["output"],
		});
		const received: unknown[] = [];
		b.onMessage((m) => received.push(m));
		a.start();
		b.start();

		const sent = { jsonrpc: "2.0", id: 42, method: "echo", params: { hello: "world" } };
		a.write(sent);
		await tick();

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(sent);

		a.stop();
		b.stop();
	});

	it("supports multiple handlers, all invoked per message", async () => {
		const seen1: unknown[] = [];
		const seen2: unknown[] = [];
		tr.t.onMessage((m) => seen1.push(m));
		tr.t.onMessage((m) => seen2.push(m));
		tr.input.write('{"id":1}\n');
		await tick();
		expect(seen1).toHaveLength(1);
		expect(seen2).toHaveLength(1);
	});
});
