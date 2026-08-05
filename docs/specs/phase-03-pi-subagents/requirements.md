# Requirements — pi Subagent Support

## Functional

- **FR-01** When `KIROCREW_ACP_BACKEND=pi` is set, spawning a subagent via
  `POST /api/spawn` (or via the `use_subagent` MCP tool) creates an
  independent pi-acp subprocess per subagent. Each subagent's turns are
  isolated from the parent's session — no cross-contamination of
  transcripts, tool-call state, or MCP server connections.
- **FR-02** Subagent tool calls under pi go through the same
  `session/request_permission` round-trip as the parent. When the parent
  has `approval_policy="auto"` (set by YOLO trust or the dashboard trust
  toggle), subagent tool calls are auto-approved without a
  user-visible approval card. Otherwise, the dashboard surfaces an
  approval card via the existing `EVENT_PERMISSION_REQUEST` path, with
  the subagent's `toolCallId` so the user can approve/deny the
  specific subagent call.
- **FR-03** The Activity panel (`SubagentProgressBar`,
  `SubagentDeliveryProgress`) renders the per-subagent status correctly
  when the backend is pi. This already works because the cards are
  driven by the existing `EVENT_SUBAGENT_*` events from
  `SubagentManager._fire_event`, not by ACP notifications.
- **FR-04** Existing kiro-cli behavior is preserved: subagents use
  session sharing (one process, multiple sessions) when
  `cfg.agent.session_sharing=True`. This is the default and should
  remain unchanged.
- **FR-05** The dormant claude backend (reachable only via a
  companion edition's `register_acp_backends`) keeps its current
  behavior — `is_session_sharing_eligible` returns `False` for claude,
  subagents get their own companion runtime per spawn.

## Non-functional

- **NFR-01** One pi-acp subprocess per subagent means N concurrent
  subagents = N+1 pi-acp processes (parent + N). The existing
  `max_concurrent` limit (`compute_max_subagents`) caps this to a
  reasonable upper bound (default 3). The `cgroup_scope_argv` wraps
  each spawn with a `pids.max` + `memory.max` ceiling.
- **NFR-02** The fix is **a 2-line property change** plus tests.
  No new modules, no new abstractions. This is the minimum correct
  behavior given that pi-acp is one-process-per-session.
- **NFR-03** Existing `make test` suite must continue to pass.
- **NFR-04** `is_session_sharing_eligible` is the **single source of
  truth** for the multiplexed-vs-isolated decision. The fix lives in
  one place; downstream callers (`SubagentManager._should_use_session_sharing`,
  `SessionManager.is_session_sharing_eligible`) read it via the same
  call site.

## Test harness

- Existing `pytest` (Makefile target `make test`).
- New tests live in `test/test_subagent_session_sharing.py`.
- Live verification: a real subagent spawn via the dashboard chat panel,
  asserting the spawned Activity card appears and the subagent's
  transcript is independent of the parent.

## Verification command

```bash
cd /home/taha/projects/KiroCrew
make test                            # full pytest suite
# Live verification:
KIROCREW_ACP_BACKEND=pi kirocrew gateway &
sleep 4
TOKEN=$(kirocrew token | tail -1 | sed 's|http://localhost:5476?token=||')
# Trigger a subagent spawn via POST /api/spawn:
curl -s -X POST -b "mc_token_5476=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task":"echo subagent test","parent_slot":"chat-1-1785893722"}' \
  http://localhost:5476/api/spawn
# Inspect Activity panel via the dashboard at http://localhost:5476/chat/...
```

## Acceptance criteria (phase-level)

1. **Unit:** `AcpProvider.is_session_sharing_eligible` returns:
   - `True` when backend is default (kiro-cli) and `cfg.agent.session_sharing=True`
   - `False` when backend is pi (`acp_backend="pi"`)
   - `False` when backend is claude (`acp_backend="claude"`)
2. **Unit:** `SubagentManager._should_use_session_sharing(info)` returns
   `False` for any info whose parent session is on a pi-acp backend.
3. **Integration:** Spawning a subagent under pi produces an independent
   pi-acp subprocess; the parent's transcript is unchanged while the
   subagent runs.
4. **No regression:** Spawning a subagent under default kiro-cli still
   uses the multiplexed `AcpRuntime` (one process, many sessions).
5. **Permission flow:** Under pi with parent `approval_policy="auto"`,
   subagent tool calls are auto-approved; otherwise they surface a
   dashboard approval card.
6. **Test suite:** `make test` is green before and after this phase.

## Mapping

| Feature | FR/NFR |
|---|---|
| `is_session_sharing_eligible` correctness for pi | FR-01, FR-04, FR-05, NFR-02, NFR-04 |
| Subagent spawn produces independent subprocess | FR-01, NFR-01 |
| Permission flow inheritance from parent | FR-02 |
| kiro-cli path preserved | FR-04, NFR-03 |
| claude backend preserved | FR-05 |
