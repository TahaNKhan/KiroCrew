# Requirements — pi-acp-server

## Functional

- **FR-01** Standalone TypeScript package at `packages/pi-acp-server/`
  that runs as a stdio process speaking newline-delimited JSON-RPC 2.0.
- **FR-02** Accepts `initialize` with `protocolVersion: 1` (integer),
  responds with `{protocolVersion: 1, agentCapabilities: {loadSession:
  false}, modes: [{modeId: "pi", name: "Pi"}], configOptions: [...]}`.
- **FR-03** Accepts `session/new` and `session/prompt`, returning the
  correct JSON-RPC responses.
- **FR-04** Accepts `session/set_mode`, `session/set_model`,
  `session/set_config_option`, `session/cancel` as no-op or model-setting
  handlers.
- **FR-05** Streams `session/update` notifications for text chunks,
  thinking chunks, tool calls, tool results, and optional usage.
- **FR-06** Emits `session/request_permission` from the pi `on("tool_call")`
  hook and blocks the pi turn until the host replies.
- **FR-07** On `cancel`, aborts the pi turn cleanly and resolves any
  in-flight `session/prompt` request with `stopReason: "cancelled"`.
- **FR-08** Returns `-32601 Method not found` for any unrecognized
  client→server request (no dropped requests with `id`).
- **FR-09** Permission request id namespace is independent of the prompt
  id counter (no collisions).

## Non-functional

- **NFR-01** Test harness: vitest. Unit tests cover transport,
  framing, permission gate, cancel, and notification emission.
- **NFR-02** Builds with `tsc` to ESM, no warnings.
- **NFR-03** Lints clean under the existing repo's eslint config
  (extends `website/eslint.config.js`).
- **NFR-04** `bin/pi-acp-server` entry is executable via node.
- **NFR-05** Public KiroCrew core unchanged (`src/kiro_crew/` not
  modified).

## Test harness

- `vitest run` (matches `website/package.json` test script convention)
- A fixture file under `packages/pi-acp-server/test/fixtures/frames.jsonl`
  containing KiroCrew-shaped frames; the server is driven against a
  scripted pi-session fake.

## Verification command

```
cd packages/pi-acp-server
npm install
npm test
npm run lint
npm run build
```
