# pi-acp-server

A standalone TypeScript package that wraps pi's `AgentSession` behind the
Agent Client Protocol (ACP — JSON-RPC 2.0 over stdio), so KiroCrew can drive
pi as a third backend alongside `kiro-cli` and `claude-agent-acp`.

**Status:** phase-01 in progress (T01 scaffold complete, T02+ pending).

See `docs/system-specs/features/pi-acp-server.md` for the design and
`docs/system-specs/features/pi-acp-server-build-spec.md` for the wire-level
contract.

## Install (once published)

```bash
npm i -g @taha-khan/pi-acp-server   # placeholder; not published yet
```

## Run

```bash
pi-acp-server    # reads JSON-RPC frames on stdin, writes to stdout
```

## Develop

```bash
cd packages/pi-acp-server
npm install
npm test
npm run build
npm run lint
```
