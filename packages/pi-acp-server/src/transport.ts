// src/transport.ts — newline-delimited JSON-RPC 2.0 transport (build spec §1).
//
// Reads one JSON object per `\n` from `input`, invokes registered handlers.
// Writes `JSON.stringify(msg) + "\n"` to `output`. Non-JSON and empty lines
// are skipped silently — stdout cleanliness is the contract (build spec §8).
import { createInterface, type Interface as RLInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type MessageHandler = (msg: unknown) => void;

export interface TransportOptions {
	input?: Readable;
	output?: Writable;
	logger?: (msg: string) => void;
}

export class Transport {
	private readonly input: Readable;
	private readonly output: Writable;
	private readonly logger: (msg: string) => void;
	private readonly handlers: MessageHandler[] = [];
	private rl: RLInterface | null = null;
	private started = false;

	constructor(opts: TransportOptions = {}) {
		this.input = opts.input ?? process.stdin;
		this.output = opts.output ?? process.stdout;
		this.logger = opts.logger ?? ((m) => process.stderr.write(`${m}\n`));
	}

	onMessage(handler: MessageHandler): void {
		this.handlers.push(handler);
	}

	write(msg: unknown): void {
		this.output.write(`${JSON.stringify(msg)}\n`);
	}

	start(): void {
		if (this.started) return;
		this.started = true;
		this.rl = createInterface({ input: this.input, crlfDelay: Infinity });
		this.rl.on("line", (line) => this.handleLine(line));
		// readline emits "close" when input EOFs — flip started so a restart
		// can re-create the interface if the caller reuses the Transport.
		this.rl.on("close", () => {
			this.started = false;
		});
	}

	stop(): void {
		this.rl?.close();
		this.rl = null;
		this.started = false;
	}

	private handleLine(line: string): void {
		const text = line.trim();
		if (text === "") return; // empty lines skipped silently
		let msg: unknown;
		try {
			msg = JSON.parse(text);
		} catch {
			// Non-JSON lines are skipped silently — no throw, no log.
			// Rationale: stdout cleanliness is the wire contract; an adapter
			// that logs every skipped line would defeat the "stdout is JSON"
			// guarantee for downstream consumers. Diagnostics belong on stderr,
			// and even there a hot stream of garbage would be noise.
			return;
		}
		for (const h of this.handlers) h(msg);
	}
}
