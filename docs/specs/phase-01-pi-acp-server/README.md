# Phase 01 — pi-acp-server

**Status:** planning
**Branch:** `main` (direct, per user)
**Push policy:** after each gate
**Source spec:** [`../../system-specs/features/pi-acp-server.md`](../../system-specs/features/pi-acp-server.md)
**Build spec (wire shapes):** [`../../system-specs/features/pi-acp-server-build-spec.md`](../../system-specs/features/pi-acp-server-build-spec.md)

## One-line summary

Build `pi-acp-server` — a standalone TypeScript package that wraps pi's
`AgentSession` behind ACP JSON-RPC, so KiroCrew can drive pi as a third
backend (alongside kiro-cli and claude-agent-acp).

## Acceptance criteria (phase-level)

1. Package compiles (`tsc`) and lint-clean.
2. Unit tests for the transport, JSON-RPC framing, the permission gate,
   cancel composition, and notification shape emission all pass.
3. A recorded-frame replay fixture (parses a fixture file of KiroCrew's
   expected `session/update` shapes) passes shape validation.
4. Spawning the package under KiroCrew's `acp/client.py` test harness
   completes `initialize` + `session/new` against the package; this is
   covered by an integration test using a recorded-frame driver.
5. Public KiroCrew core unchanged: no edits under `src/kiro_crew/`. The
   companion seam is **out of scope for this phase** (Phase 02 in the
   next companion-feature folder); this phase ships the package only.

## Out of scope

- KiroCrew-side companion seam (Phase 02 — registers the new backend
  via `ProviderRegistry.register_acp_backends`).
- The companion seam work would call into this package from KiroCrew's
  spawn path; this phase delivers only the package itself.

## Stop signal

When all `todo` tasks in `TASKS.md` are `done` AND a final integration
test (`tests/test_pi_acp_smoke.py`) passes, mark README `Status: done`
and advance to the After-phase section.
