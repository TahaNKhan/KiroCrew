# Phase 03 — pi Subagent Support

**Status:** planning
**Branch:** TBD (proposed: `feature/pi-subagent-support`)
**Push policy:** after each gate

## One-line summary

Fix the subagent session-sharing and permission-flow gaps that were
exposed (but not addressed) when phase-01 activated the dormant pi
backend seam, so subagents work end-to-end through pi-acp — same UX as
kiro-cli but routed through pi's MCP catalog.

## Background

### What already works

- **Same provider path:** `SubagentManager.spawn` calls
  `_sessions.get_or_create(session_key, ...)` → `provider_factory(parent, agent, cwd)`
  → `AcpProvider(acp_backend=...)`. Phase-01's last patch already threads
  `acp_backend` through `_parent_runtime_kwargs`, so the subagent runtime
  spawns pi-acp when `KIROCREW_ACP_BACKEND=pi`.
- **Approval policy flow:** `parent_policy = self._sessions.get_approval_policy(parent_session_key)`
  propagates to the subagent session through `_sessions.get_or_create(approval_policy=parent_policy, ...)`.
- **Subagent dashboard panel:** `<SubagentProgressBar>` and `<SubagentDeliveryProgress>`
  are mounted in `ChatPane.tsx:293–295`. Per-subagent Activity cards already render
  via `_native_subagent_sync` (kiro-cli's `_kiro.dev/subagent/list_update`).

### What's broken

Phase-01 changed `AcpProvider.is_session_sharing_eligible` from
`not self.is_claude_backend` (the original code) — but I left it as
`not self.is_claude_backend`. That now returns `True` for pi, but pi-acp
**does not support multiplexed sessions** (one process, multiple
`session/new` calls). This is the latent bug.

**Probe evidence** (recorded during scoping, with `pi-acp` v0.0.33):
- pi-acp advertises `sessionCapabilities.list: {}` so it knows about
  session state but does not behave as a multiplexer.
- Issuing two `session/new` calls in one process via stdin frames: the
  first completes, but subsequent sessions do not materialize a
  second independent turn-stream. The `session/list` returns
  pre-existing sessions from disk (not the one we just created),
  indicating pi-acp maintains a single active session state per
  process.
- ACP spec does not require a backend to support multiplexed sessions;
  it's an optional capability pi-acp simply does not advertise.

**Consequence:** when a subagent is spawned under pi with `keep=False`
(the default), `SubagentManager._should_use_session_sharing(info)`
returns `True`, and `_create_shared_session()` tries to create a second
session on the parent's pi-acp runtime. This either fails silently
(sessions share one process state → cross-contamination), returns the
same sessionId twice (subagent receives parent's transcript), or
deadlocks. Either way, subagents on pi don't work today.

## Goals

1. Subagents spawned under `KIROCREW_ACP_BACKEND=pi` work correctly —
   each gets its own runtime, its own session, and streams results
   independently to the dashboard Activity panel.
2. Subagent permission flow respects the parent's `approval_policy`.
   When the parent is `auto` (YOLO trust), subagent tool calls are
   auto-approved; otherwise they go through the same
   `session/request_permission` round-trip and surface in the dashboard
   approval card.
3. No regression on the kiro-cli path. The default backend must keep
   using session sharing (the kiro-cli ACP demux supports it).
4. The dormant claude backend (dormant seam, only reachable via a
   companion edition) keeps its current "one process per session"
   behavior. `_is_claude_backend` already returns `False` → `True`
   eligibility for claude, which is correct (claude-acp is one-process-
   per-session like pi, BUT only reuses one process when the user
   explicitly opts in — claude sessions must be in their own subprocess).

Wait — that last point needs reconsideration. See design doc.

## Out of scope

- A new dashboard UI for subagent spawning. Existing
  `POST /api/spawn` is sufficient.
- Cross-runtime isolation guarantees (process vs cgroup vs sandbox).
  Out of scope; the existing `cgroup_scope_argv` already bounds.
- Subagent recursion (spawning subagents from subagents). Already
  forbidden by the existing `No spawn recursion` comment in
  `subagent.py:7`.
- Permission policy templates. The existing
  `info.approval_mode="auto"` path covers the YOLO case; nothing new
  needed.

## Phase files
- `requirements.md` — exact failure modes, wire shapes, acceptance
- `design.md` — eligibility fix, permission flow, fallback strategy
- `TASKS.md` — workgroup table for parallel dispatch
