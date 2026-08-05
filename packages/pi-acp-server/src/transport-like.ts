// src/transport-like.ts — structural type used by handlers and tests.
//
// `Transport` (src/transport.ts) is a class with private members (input,
// output, logger, rl, started). `Pick<Transport, "write" | "onMessage">`
// does NOT structurally satisfy the class type because class privates are
// not in the Pick — TypeScript treats them as required. Handlers and tests
// only need the *behavioral* surface (write + onMessage + dispatch), so
// declare that surface here as an interface and let both the real
// `Transport` and the test `FakeTransport` satisfy it implicitly via
// structural typing.

export interface TransportLike {
	write(msg: unknown): void;
	onMessage(handler: (msg: unknown) => void): void;
}
