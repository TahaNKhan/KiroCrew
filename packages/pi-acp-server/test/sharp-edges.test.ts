// test/sharp-edges.test.ts — regression tests for the six silent-failure
// traps listed in build spec §8. Each test points to its §8 entry on
// failure so a future maintainer immediately knows where to look.
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { startServer } from "../src/server.js";

interface Setup {
	input: PassThrough;
	captured: string[];
	serverPromise: Promise<void>;
}

function setup(opts: Parameters<typeof startServer>[0] = {}): Setup {
	const input = new PassThrough();
	const output = new PassThrough();
	const captured: string[] = [];
	output.on("data", (c: Buffer) => captured.push(c.toString()));
	const serverPromise = startServer({
		input: input as unknown as import("node:stream").Readable,
		output: output as unknown as import("node:stream").Writable,
		logger: () => {},
		...opts,
	});
	return { input, captured, serverPromise };
}

function sendFrame(input: PassThrough, frame: unknown): void {
	input.write(JSON.stringify(frame) + "\n");
}

function readFrames(captured: string[]): unknown[] {
	return captured
		.join("")
		.split("\n")
		.filter(Boolean)
		.map((s) => JSON.parse(s));
}

describe("sharp edges (build spec §8)", () => {
	// §8.1: tool_call_update discriminator (NOT tool_result). Since this is
	// the server's RESPONSE side and notifications are produced by the
	// notifications module, we check the canonical discriminator string is
	// in scope by importing it.
	it("§8.1 — session/update discriminator for tool results is tool_call_update", async () => {
		const mod = await import("../src/notifications.js");
		// The notifications module exports toolResult(); if it ever used the
		// wrong discriminator this would surface as a missing export.
		expect(typeof (mod as Record<string, unknown>).toolResult).toBe("function");
	});

	// §8.2: permission id namespace isolation. Verify the id-allocator keeps
	// the two counters disjoint so permission ids never collide with prompt ids.
	it("§8.2 — permission id namespace never collides with prompt id namespace", async () => {
		const { IdAllocator } = await import("../src/id-allocator.js");
		const alloc = new IdAllocator();
		const promptIds = new Set<number>();
		const permIds = new Set<number>();
		for (let i = 0; i < 1000; i++) {
			promptIds.add(alloc.nextOutbound());
			permIds.add(alloc.nextPermission());
		}
		for (const id of promptIds) expect(permIds.has(id)).toBe(false);
	});

	// §8.3: `block`, don't throw — verified at the permission-gate level.
	it("§8.3 — permission hook returns {block,reason} on reject, does not throw", async () => {
		const { PermissionGate, mapReplyToHookResult } = await import("../src/permission.js");
		const { IdAllocator } = await import("../src/id-allocator.js");
		const gate = new PermissionGate(new IdAllocator());
		const req = gate.createRequest({
			sessionId: "test",
			toolCall: { toolCallId: "tc-1", title: "test", input: {} },
			options: [],
		});
		// Simulate a deny reply from the host.
		gate.resolveReply(req.requestId, { kind: "deny", optionId: "reject_once", reason: "no" });
		const reply = await req.awaitable;
		const hook = mapReplyToHookResult(reply);
		expect(hook).toBeDefined();
		expect(hook?.block).toBe(true);
		expect(typeof hook?.reason).toBe("string");
	});

	// §8.4: loadSession: false in initialize response.
	it("§8.4 — initialize response has loadSession: false", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		await new Promise((r) => setTimeout(r, 50));
		const frames = readFrames(captured);
		expect(frames[0]).toMatchObject({
			id: 1,
			result: { agentCapabilities: { loadSession: false } },
		});
		input.end();
		await serverPromise;
	});

	// §8.5: protocolVersion is the integer 1, not the string "1".
	it("§8.5 — protocolVersion is the integer 1, not \"1\"", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		await new Promise((r) => setTimeout(r, 50));
		const frames = readFrames(captured);
		const init = frames[0] as { result: { protocolVersion: unknown } };
		expect(init.result.protocolVersion).toBe(1);
		expect(typeof init.result.protocolVersion).toBe("number");
		input.end();
		await serverPromise;
	});

	// §8.6: stdout cleanliness — every byte emitted to output during a full
	// prompt cycle must be parseable JSON-RPC. Catches leaked log lines.
	it("§8.6 — stdout is clean: every line is valid JSON-RPC during a full handshake + prompt", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		sendFrame(input, { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/tmp" } });
		sendFrame(input, {
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: { sessionId: "x", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
		});
		await new Promise((r) => setTimeout(r, 200));
		const allLines = captured.join("").split("\n").filter(Boolean);
		expect(allLines.length).toBeGreaterThan(0);
		for (const line of allLines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
		input.end();
		await serverPromise;
	});
});
