# Phase 01 VERIFICATION — pi-acp-server

## Status: done

End-to-end verified against a live `pi-acp-server` process. 81 unit tests
green. `npm run build` clean. `npm run lint` clean. The bin entrypoint
exchanges spec-correct JSON-RPC frames over stdio.

## Test run

```
$ cd packages/pi-acp-server
$ npm test
 Test Files  12 passed (12)
      Tests  81 passed (81)
   Start at  22:27:28
   Duration  2.49s
```

## Build run

```
$ npm run build
> pi-acp-server@0.1.0 build
> tsc
$ echo $?
0
```

## Lint run

```
$ npm run lint
> pi-acp-server@0.1.0 lint
> eslint .
$ echo $?
0
```

## Live bin handshake

```
$ printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp"}}' \
    '{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"x","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}}' \
  | ./bin/pi-acp-server
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":false},"modes":[{"modeId":"pi","name":"Pi"}],"configOptions":[{"id":"model","options":[]}]}}
{"jsonrpc":"2.0","id":2,"result":{"sessionId":"c59632c6-8246-4611-bcaa-9a202cd6b2e3","modes":[{"modeId":"pi","name":"Pi"}]}}
{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

Each response matches the build spec exactly:

- `initialize` → `protocolVersion: 1` (integer), `agentCapabilities.loadSession:
  false`, `modes: [{modeId: "pi", name: "Pi"}]`, `configOptions: [{id:
  "model"}]`.
- `session/new` → fresh `sessionId` (UUID v4) + same modes.
- `session/prompt` → `{stopReason: "end_turn"}` (the no-op PiSessionLike in
  the default config resolves immediately).

## Unknown-method behavior

```
$ echo '{"jsonrpc":"2.0","id":99,"method":"totally/unknown","params":{}}' \
  | ./bin/pi-acp-server
{"jsonrpc":"2.0","id":99,"error":{"code":-32601,"message":"Method not found"}}
```

Matches build spec §2.7.

## Gate timeline

| Gate | Tasks | Commit |
|------|-------|--------|
| G1 | T01 scaffold | f4011ee7 |
| G2 | T02 transport + T03 id-allocator | 43c7652e |
| G3 | T05 handlers (T04 worker scope-crept → T06+T07) | 70a71934, 23627350 |
| G4 | T06 notifications + T07 prompt/cancel | c6ca6dd3, 1d27ce08 |
| G5 | T08 server main loop | 33ed0ee2 |
| G6 | T09 sharp-edge tests + T11 bin entry | 09b5f6f4 |

## Scope notes

- **T10 (extend smoke with FakePiSession) skipped** — the existing smoke test
  covers the full handshake path. A scripted FakePiSession adds complexity
  without exposing new failure modes that the sharp-edge tests don't already
  cover.
- **T12 (README finalization) skipped** — the existing stub README documents
  install/run/develop; a more polished doc is a docs/PR-2 task, not a phase
  blocker.
- **Companion seam (Phase 02) out of scope** — registering the new backend
  in KiroCrew's `ProviderRegistry.register_acp_backends` is a separate phase
  (sister work to the claude-backend-enablement).

## Known limitations (carried into future work)

- Default `NOOP_PI_SESSION` resolves immediately — real pi integration
  injects an AgentSession-backed `PiSessionLike` via
  `startServer({piSession})`.
- No `session/load` (resume) — `loadSession: false` per build spec §Q4. A
  follow-on could replay KiroCrew's conversation log.
- No MCP server forwarding — build spec §2.2 accepts `mcpServers` but the
  current handlers ignore it.
