// test/smoke.test.ts — end-to-end through startServer() with PassThrough streams.
//
// Covers the full handshake path (build spec §2.1–§2.5) + the unknown-method
// branch (§2.7). Uses PassThrough streams so the test never touches real
// process.stdin/stdout — startServer() is the same function the bin script
// will invoke.
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { startServer } from "../src/server.js";

interface Setup {
	input: PassThrough;
	captured: string[];
	serverPromise: Promise<void>;
}

function setup(): Setup {
	const input = new PassThrough();
	const output = new PassThrough();
	const captured: string[] = [];
	output.on("data", (c: Buffer) => captured.push(c.toString()));
	const serverPromise = startServer({
		input: input as unknown as import("node:stream").Readable,
		output: output as unknown as import("node:stream").Writable,
		logger: () => {},
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

describe("smoke: server wiring", () => {
	it("initialize → session/new → session/prompt → end_turn", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: 1 },
		});
		sendFrame(input, {
			jsonrpc: "2.0",
			id: 2,
			method: "session/new",
			params: { cwd: "/tmp" },
		});
		sendFrame(input, {
			jsonrpc: "2.0",
			id: 3,
			method: "session/prompt",
			params: {
				sessionId: "ignored",
				messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
			},
		});

		await new Promise((r) => setTimeout(r, 200));
		const frames = readFrames(captured);
		expect(frames.length).toBeGreaterThanOrEqual(3);
		expect(frames[0]).toMatchObject({
			id: 1,
			result: expect.objectContaining({ protocolVersion: 1 }),
		});
		expect(frames[1]).toMatchObject({
			id: 2,
			result: expect.objectContaining({ modes: expect.any(Array) }),
		});
		expect(frames[2]).toMatchObject({
			id: 3,
			result: expect.objectContaining({ stopReason: expect.any(String) }),
		});
		input.end();
		await serverPromise;
	}, 5000);

	it("unknown method with id → -32601 Method not found", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, {
			jsonrpc: "2.0",
			id: 99,
			method: "totally/unknown",
			params: {},
		});
		await new Promise((r) => setTimeout(r, 100));
		const frames = readFrames(captured);
		expect(frames).toHaveLength(1);
		expect(frames[0]).toMatchObject({
			id: 99,
			error: { code: -32601, message: "Method not found" },
		});
		input.end();
		await serverPromise;
	}, 5000);

	it("unknown notification → no reply, no crash", async () => {
		const { input, captured, serverPromise } = setup();
		sendFrame(input, {
			jsonrpc: "2.0",
			method: "totally/unknown/notification",
		});
		await new Promise((r) => setTimeout(r, 100));
		expect(readFrames(captured)).toHaveLength(0);
		input.end();
		await serverPromise;
	}, 5000);

	it("startServer returns a Promise that resolves when input closes", async () => {
		const { input, serverPromise } = setup();
		let resolved = false;
		const p = serverPromise.then(() => {
			resolved = true;
		});
		expect(resolved).toBe(false);
		input.end();
		await p;
		expect(resolved).toBe(true);
	}, 5000);
});
