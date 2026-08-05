# Design — pi-acp-server

## Package layout

```
packages/pi-acp-server/
├── package.json              # name, deps (pi SDK, vitest, tsc), bin entry
├── tsconfig.json             # ESM, strict
├── src/
│   ├── server.ts             # main() — readline loop, dispatches handlers
│   ├── transport.ts          # newline-delimited JSON-RPC read/write
│   ├── handlers/
│   │   ├── initialize.ts     # §2.1 of build spec
│   │   ├── session-new.ts    # §2.2
│   │   ├── session-mode.ts   # §2.3 no-op
│   │   ├── session-model.ts  # §2.4 set_model / set_config_option
│   │   ├── session-prompt.ts # §2.5 — the core
│   │   └── cancel.ts         # §2.6
│   ├── notifications.ts      # §3 — emit_session_update builders
│   ├── permission.ts         # §4 — request_permission emit + reply wait
│   └── pi-bridge.ts          # wraps createAgentSession, event → notif mapping
├── test/
│   ├── fixtures/
│   │   └── frames.jsonl      # recorded KiroCrew-shaped frames
│   ├── transport.test.ts     # newline framing + write
│   ├── initialize.test.ts    # handshake
│   ├── session-new.test.ts
│   ├── session-prompt.test.ts # streaming text/thinking deltas
│   ├── permission.test.ts    # the gate + id namespace isolation
│   ├── cancel.test.ts
│   ├── sharp-edges.test.ts   # the 6 §8 gotchas as regression tests
│   └── smoke.test.ts         # end-to-end with fake pi session
└── README.md
```

## Wire shapes (canonical reference)

All shapes pinned in [`../../system-specs/features/pi-acp-server-build-spec.md`](../../system-specs/features/pi-acp-server-build-spec.md).
This design does not redefine them; tests assert against them.

## Key design choices

1. **Transport layer first.** A `Transport` class wraps stdin/stdout with
   the readline + newline-write discipline. All handlers depend on it; no
   handler touches `process.stdout` directly.

2. **Permission gate as a Promise barrier.** A `PermissionGate` holds a
   `Map<requestId, {resolve: (reply) => void}>`. The pi `on("tool_call")`
   hook awaits a Promise resolved when the matching reply arrives. This
   is the verified-Q1 path (pi's hook is async-awaitable).

3. **id namespace isolation.** A single `IdAllocator` class with two
   separate counters: `_outReq` for client→server requests handled by us,
   and `_permReq` for server→client permission requests. They start
   disjoint so collision is impossible.

4. **Event → notification mapping lives in `pi-bridge.ts`.** The
   `AgentSession` event subscription is a thin mapper; the rest of the
   server doesn't depend on pi SDK types. This isolates the SDK surface
   area to one file and makes unit testing trivial (a fake `AgentSession`
   that emits scripted events).

5. **No live pi SDK at test time.** Tests inject a fake `AgentSession`
   interface so the server logic is testable without booting pi. The
   integration smoke test is gated on `INTEGRATION=1` env var and
   requires `@earendil-works/pi-coding-agent` to be installed.

6. **Sharp-edge regression tests.** §8 of the build spec lists 6
   silent-failure traps. Each gets a dedicated test case that fails if
   the regression is reintroduced:
   - `tool_call_update` discriminator (not `tool_result`)
   - permission id namespace isolation
   - `{block,reason}` not throw
   - `loadSession: false` in initialize
   - integer protocolVersion
   - stdout cleanliness (no non-JSON on stdout)

## Test strategy

- **Unit tests** use a `FakeTransport` that records writes and feeds
  scripted lines on read.
- **Smoke test** uses a `FakePiSession` that emits scripted events and
  records tool calls. Validates the full prompt → notifications →
  permission → resolve cycle.
- **Sharp-edge tests** assert the wire shapes match the build spec
  exactly (snapshot-style).
