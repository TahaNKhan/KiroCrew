# TASKS — phase-01-pi-acp-server

## Dependency table

```
T01 (scaffold) ─► T02 (transport) ─► T03 (id allocator)
                ╲                  ╲
                 ╲                  ╲─► T04 (permission gate)
                  ╲                     │
                   ╲                    ▼
                    ╲─► T05 (handlers: initialize/session-new/mode/model)
                        │
                        ▼
                     T06 (notifications module + pi-bridge)
                        │
                        ▼
                     T07 (session-prompt + cancel handlers)
                        │
                        ▼
                     T08 (server.ts main loop wires it all)
                        │
                        ▼
                     T09 (sharp-edge regression tests)
                     T10 (smoke test with FakePiSession)
                     T11 (package.json + tsconfig + lint config)
                        │
                        ▼
                     T12 (README + build verification)
```

## Parallel workgroups

| Gate | Tasks | Gate is satisfied when… | Files touched (disjoint within gate) |
|------|-------|--------------------------|--------------------------------------|
| **G1** | T01, T02, T03 | transport + id allocator exist as tested units | T01: `package.json`, `tsconfig.json`, `eslint.config.js`, `README.md` stub · T02: `src/transport.ts`, `test/transport.test.ts` · T03: `src/id-allocator.ts`, `test/id-allocator.test.ts` |
| **G2** | T04, T05 | permission gate + protocol-method handlers exist as tested units | T04: `src/permission.ts`, `test/permission.test.ts` · T05: `src/handlers/{initialize,session-new,session-mode,session-model}.ts`, `test/handlers/*.test.ts` |
| **G3** | T06, T07 | notifications module + session-prompt + cancel handlers | T06: `src/notifications.ts`, `src/pi-bridge.ts`, `test/notifications.test.ts` · T07: `src/handlers/{session-prompt,cancel}.ts`, `test/handlers/session-prompt.test.ts`, `test/handlers/cancel.test.ts` |
| **G4** | T08 | server.ts wires it all together | T08: `src/server.ts`, `test/smoke.test.ts` |
| **G5** | T09, T10, T11, T12 | sharp edges + smoke + package config + README — final polish | T09: `test/sharp-edges.test.ts` · T10: extends `test/smoke.test.ts` (FakePiSession) · T11: `package.json` finalization, `.npmignore` · T12: `packages/pi-acp-server/README.md`, CI integration notes |

## Critical paths

- **G1 → G2 → G3 → G4** is the linear critical path (each gate depends on
  prior exports). Wall-clock = sum of gate times.
- **G5** is parallel polish — runs after G4 green.
- **G1's T01/T02/T03** fan out in parallel (3 subagents, no shared files).
- **G2's T04/T05** fan out in parallel (2 subagents, no shared files).
- **G3's T06/T07** depend on G2 (T07 imports permission gate from T04). They
  can parallelize on the file footprint (no overlap) but the test code in
  T07 imports from T04 — small risk of import-order churn, gated by G3's
  smoke test.

---

## Tasks

### T01 — Package scaffold

- **Description:** Create `packages/pi-acp-server/` with `package.json`
  (name: `pi-acp-server`, version 0.1.0, type: module, bin entry:
  `bin/pi-acp-server`), `tsconfig.json` (ESM, strict, target ES2022),
  `eslint.config.js` extending `website/eslint.config.js`, empty
  `src/.gitkeep`, `test/.gitkeep`. Stub `README.md`.
- **Maps to:** FR-01, NFR-02, NFR-03, NFR-04.
- **Maps to design:** §"Package layout" (just the root files).
- **Acceptance criteria:**
  - [ ] `cd packages/pi-acp-server && npm install` succeeds.
  - [ ] `npx tsc --noEmit` exits 0 (no source yet).
  - [ ] `npx eslint .` exits 0.
  - [ ] `package.json` bin field resolves to a real script.
- **Dependencies:** none.
- **Estimate:** ~30 min.
- **Status:** todo

### T02 — Transport layer

- **Description:** Implement `src/transport.ts` — a `Transport` class
  wrapping stdin/stdout with newline-delimited JSON-RPC discipline. Reads
  one line at a time from stdin via `readline`, parses JSON, emits a
  `Message` event per object. Writes `JSON.stringify(msg) + "\n"` to
  stdout. Logs go to stderr via the constructor's `logger` arg.
- **Maps to:** FR-01 (transport portion), §1 of build spec.
- **Maps to design:** §"Transport layer first."
- **Acceptance criteria:**
  - [ ] `Transport` reads `'{"jsonrpc":"2.0","id":1,"method":"x"}\n'` and emits a `Message`.
  - [ ] Non-JSON lines are skipped silently.
  - [ ] Empty lines are skipped silently.
  - [ ] Writes serialize as `JSON.stringify(msg) + "\n"`.
  - [ ] Unit tests cover: read good frame, skip non-JSON, skip empty, write roundtrip.
- **Dependencies:** T01.
- **Estimate:** ~1 hr.
- **Status:** todo

### T03 — Id allocator

- **Description:** Implement `src/id-allocator.ts` — a class with two
  disjoint counters: `_outReq` for our outbound client→server requests
  (initialize, session/new, etc.) starting at 1, and `_permReq` for
  server→client permission requests starting at `1000000` (different
  range guarantees no collision). Methods: `nextOutbound()` and
  `nextPermission()`.
- **Maps to:** FR-09, §4 of build spec.
- **Maps to design:** §"id namespace isolation."
- **Acceptance criteria:**
  - [ ] Sequential calls to `nextOutbound()` return 1, 2, 3, ...
  - [ ] Sequential calls to `nextPermission()` return 1000000, 1000001, ...
  - [ ] The two ranges never overlap.
  - [ ] Unit test asserts both counters produce ≥1000 distinct ids with no overlap.
- **Dependencies:** T01.
- **Estimate:** ~30 min.
- **Status:** todo

### T04 — Permission gate

- **Description:** Implement `src/permission.ts` — a `PermissionGate`
  class with `Map<number, {resolve, reject}>`. Methods:
  `createRequest(options, toolCall)` → returns `{requestId, awaitable}`.
  `resolveReply(requestId, reply)` looks up the pending request and
  resolves. Export `mapReplyToHookResult(reply)` that translates the
  three reply shapes (`selected`/allow*, `selected`/reject*,
  `cancelled`) to `{block: true, reason}` for deny or `undefined` for
  allow. NEVER throws — even on malformed replies, returns block with
  a "Malformed permission reply" reason.
- **Maps to:** FR-06, FR-09, §4 + §5 of build spec.
- **Maps to design:** §"Permission gate as a Promise barrier."
- **Acceptance criteria:**
  - [ ] `createRequest` returns `{requestId, awaitable}` with disjoint id (uses IdAllocator).
  - [ ] `resolveReply(allow)` makes the awaitable resolve to `{allow: true}`.
  - [ ] `resolveReply(reject)` makes it resolve to `{block: true, reason}`.
  - [ ] `resolveReply(cancelled)` makes it resolve to `{block: true, reason: "Denied by host"}`.
  - [ ] Resolving an unknown id is a no-op (no throw).
  - [ ] Unit tests cover: allow, reject, cancel, malformed input, unknown id.
- **Dependencies:** T03.
- **Estimate:** ~1.5 hr.
- **Status:** todo

### T05 — Protocol-method handlers (initialize / session/new / mode / model)

- **Description:** Implement four handlers in
  `src/handlers/{initialize,session-new,session-mode,session-model}.ts`,
  each exporting `handle(params, ctx): Promise<result>`. Per build spec
  §2.1–§2.4: initialize returns `loadSession: false` + modes +
  configOptions; session/new returns a fresh uuid + modes; set_mode is
  a no-op returning `{}`; set_model and set_config_option both call
  `ctx.setModel(value)`. Each handler exports a `registerOn(transport,
  ctx)` that subscribes to the right method name.
- **Maps to:** FR-02, FR-03, FR-04.
- **Maps to design:** §"Protocol-method handlers."
- **Acceptance criteria:**
  - [ ] `initialize` response has `protocolVersion: 1` (integer, not string).
  - [ ] `initialize` response has `agentCapabilities.loadSession: false`.
  - [ ] `initialize` response has `modes: [{modeId: "pi", name: "Pi"}]`.
  - [ ] `initialize` response has at least one `configOptions` entry with `id: "model"`.
  - [ ] `session/new` response has a `sessionId` (non-empty uuid).
  - [ ] `session/set_mode` accepts and returns `{}`.
  - [ ] `session/set_model` calls `ctx.setModel(model)` and returns `{}`.
  - [ ] `session/set_config_option` with `configId: "model"` calls `ctx.setModel(option)` and returns `{}`.
  - [ ] Unit tests cover all four handlers with scripted params.
- **Dependencies:** T01.
- **Estimate:** ~2 hr.
- **Status:** todo

### T06 — Notifications module + pi-bridge

- **Description:** Implement `src/notifications.ts` exporting the five
  notification builders from §3.1–§3.5 of build spec, plus
  `src/pi-bridge.ts` exporting `subscribeToAgentSession(session,
  transport, sessionId)` that subscribes to pi events and emits the right
  notification. The pi-bridge must translate `text_delta` →
  `agent_message_chunk`, `thinking_delta` → `agent_thought_chunk`,
  `beforeToolCall` hook → `tool_call` notification + permission request,
  tool result → `tool_call_update` with `rawOutput`. The pi-bridge must
  take an `AgentSession` interface (for testability) so tests can inject
  a fake.
- **Maps to:** FR-05, FR-06, §3 + §6 of build spec.
- **Maps to design:** §"Event → notification mapping lives in
  pi-bridge.ts."
- **Acceptance criteria:**
  - [ ] `textChunk(text)` emits `agent_message_chunk` with `content.text`.
  - [ ] `thinkingChunk(text)` emits `agent_thought_chunk`.
  - [ ] `toolCall(toolCallId, title, kind, input)` emits `tool_call` with all fields.
  - [ ] `toolResult(toolCallId, output)` emits `tool_call_update` (NOT tool_result) with `status: "completed"`.
  - [ ] `usageUpdate(size, inputTokens, outputTokens)` emits `usage_update`.
  - [ ] `subscribeToAgentSession(fakeSession, transport, sessionId)` wires all five event types.
  - [ ] Unit tests assert the JSON shapes byte-for-byte against fixture golden files.
- **Dependencies:** T04 (uses PermissionGate).
- **Estimate:** ~2 hr.
- **Status:** todo

### T07 — session-prompt + cancel handlers

- **Description:** Implement `src/handlers/session-prompt.ts` (the core)
  and `src/handlers/cancel.ts`. session-prompt: receive user text, call
  `ctx.piSession.prompt(text)`, await pi turn completion, respond to
  the original request with `{stopReason: "end_turn"}`. Cancel: respond
  to in-flight prompt with `stopReason: "cancelled"` and call
  `ctx.piSession.abort()`. Both register on the transport.
- **Maps to:** FR-03 (prompt portion), FR-07.
- **Maps to design:** §"session-prompt is the core" + cancel handler.
- **Acceptance criteria:**
  - [ ] session-prompt resolves the JSON-RPC request only AFTER the pi turn ends.
  - [ ] Response has `stopReason: "end_turn"` on normal completion.
  - [ ] Cancel handler aborts and responds with `stopReason: "cancelled"`.
  - [ ] If cancel arrives mid-prompt, the prompt's awaitable resolves with cancelled.
  - [ ] Unit tests with FakePiSession: prompt completes → response sent; cancel mid-prompt → cancelled response.
- **Dependencies:** T04 (uses PermissionGate indirectly via pi-bridge).
- **Estimate:** ~1.5 hr.
- **Status:** todo

### T08 — server.ts main loop

- **Description:** Implement `src/server.ts` — the entrypoint. Wires
  transport + all handlers + pi-bridge together. Reads messages from
  transport, dispatches to the right handler based on `method`, sends
  responses/notifications via transport. Handles unknown methods by
  sending `-32601` for requests (those with id). The bin script
  (`bin/pi-acp-server`) just runs `node src/server.ts`.
- **Maps to:** FR-01, FR-08, §2.7 of build spec.
- **Maps to design:** §"server.ts main loop."
- **Acceptance criteria:**
  - [ ] Server boots and parses stdin frames.
  - [ ] Routes `initialize`, `session/new`, `session/set_mode`,
    `session/set_model`, `session/set_config_option`, `session/prompt`,
    `cancel` to the right handlers.
  - [ ] Unknown methods with an id get a `-32601` error response.
  - [ ] Notifications (no id) are dispatched or ignored, never replied to.
  - [ ] Smoke test (`test/smoke.test.ts`) sends a scripted sequence
    through a FakeTransport and a FakePiSession, asserts:
    - initialize handshake completes
    - session/new returns a sessionId
    - session/prompt with scripted `text_delta` events emits
      `agent_message_chunk` notifications and responds with
      `end_turn`
    - session/prompt with scripted `beforeToolCall` event emits a
      permission request, waits, then emits tool_call update on
      allow, and responds with `end_turn`
- **Dependencies:** T04, T05, T06, T07.
- **Estimate:** ~2 hr.
- **Status:** todo

### T09 — Sharp-edge regression tests

- **Description:** Add `test/sharp-edges.test.ts` with 6 test cases,
  one per sharp edge from §8 of build spec:
  1. `tool_call_update` discriminator (NOT `tool_result`).
  2. Permission id namespace isolation — drive 100 sequential prompts
     with 1 tool call each, assert permission ids never collide with
     prompt ids.
  3. `block`, don't throw — feed a permission hook a thrown error,
     assert the gate resolves to `{block: true, reason: <error msg>}`
     not a propagated exception.
  4. `loadSession: false` — assert initialize response shape.
  5. Integer `protocolVersion` — assert it's `1` (number, not "1").
  6. stdout cleanliness — capture all stdout during a full prompt cycle,
     assert every line is parseable JSON (no log noise).
- **Maps to:** §8 of build spec.
- **Maps to design:** §"Sharp-edge regression tests."
- **Acceptance criteria:**
  - [ ] All 6 tests pass.
  - [ ] Each test, if failed, gives a pointer to the relevant §8 item.
- **Dependencies:** T08.
- **Estimate:** ~1 hr.
- **Status:** todo

### T10 — Smoke test with FakePiSession

- **Description:** Implement a `FakePiSession` test helper in
  `test/smoke.test.ts` (extend the smoke from T08) that emits a
  scripted sequence: 3 text deltas, 1 tool call (allow), 2 more text
  deltas, end of turn. Asserts the full wire output is correct against
  a golden fixture file
  (`test/fixtures/expected-smoke.jsonl`).
- **Maps to:** §"Smoke test" of design.
- **Acceptance criteria:**
  - [ ] Smoke test passes end-to-end against the golden fixture.
  - [ ] Golden fixture contains exactly the expected stream of
    notifications + responses (verified by diff).
- **Dependencies:** T08.
- **Estimate:** ~1 hr.
- **Status:** todo

### T11 — Package config finalization

- **Description:** Finalize `package.json` (scripts: `test` →
  `vitest run`, `lint` → `eslint .`, `build` → `tsc`), add
  `bin/pi-acp-server` shim, add `.npmignore`, lock dependencies in
  `package-lock.json`. Add `peerDependencies` for
  `@earendil-works/pi-coding-agent` (the pi SDK is a peer, not a
  direct dep — keeps the package small and version-flexible).
- **Maps to:** NFR-01, NFR-02, NFR-04.
- **Acceptance criteria:**
  - [ ] `npm run build` produces a runnable `dist/server.js`.
  - [ ] `npm run lint` exits 0.
  - [ ] `npm test` runs all tests green.
  - [ ] `npx pi-acp-server --help` (or similar) doesn't crash on
    invalid input — exits cleanly.
- **Dependencies:** T08.
- **Estimate:** ~30 min.
- **Status:** todo

### T12 — README + verification walkthrough

- **Description:** Write `packages/pi-acp-server/README.md` covering:
  what it is, install, run, the wire shapes (point to the build spec),
  test commands, and a small section on how a KiroCrew companion would
  consume it. Also produce a verification walkthrough
  (`docs/specs/phase-01-pi-acp-server/VERIFICATION.md`) listing the
  commands run + their green output for the phase's
  acceptance-criteria evidence.
- **Maps to:** phase acceptance criteria.
- **Acceptance criteria:**
  - [ ] README explains purpose, install, run, test.
  - [ ] VERIFICATION.md contains the green output of:
    - `npm install`
    - `npm run build`
    - `npm test`
    - `npm run lint`
- **Dependencies:** T11.
- **Estimate:** ~30 min.
- **Status:** todo
