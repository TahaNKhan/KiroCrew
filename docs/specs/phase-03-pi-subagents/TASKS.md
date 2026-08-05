# TASKS — phase-03-pi-subagents

## Dependency table

```
T01 (eligibility fix) ──► T02 (tests) ──► T03 (live verification)
```

## Parallel workgroups

| Gate | Tasks | Gate is satisfied when… | Files touched (disjoint) |
|---|---|---|---|
| **G1** | T01, T02 | `_is_pi` added + eligibility check fixed + 3 unit tests green | T01: `src/kiro_crew/providers/acp.py` (2 small changes) · T02: `test/test_subagent_session_sharing.py` (new) |

Critical path: G1 only. Single gate because the fix is genuinely small
(2-line property change) and the tests are co-located.

G2 would be T03 (live verification) but that has no source changes —
just operational. Listed as its own gate for clarity.

---

## Tasks

### T01 — Fix `is_session_sharing_eligible` for pi backend

- **Description:** Add an `_is_pi` property to `AcpProvider` that mirrors
  the existing `is_claude_backend` pattern (reads from the underlying
  client). Update `is_session_sharing_eligible` to return `False` for
  pi (one process per session, like claude). Default kiro-cli path
  unchanged.
- **Maps to:** FR-01, FR-04, FR-05, NFR-02, NFR-04.
- **Maps to design:** §"The fix".
- **Acceptance criteria:**
  - [ ] `AcpProvider._is_pi` property returns `True` iff
    `self._client.backend == ACP_BACKEND_PI`.
  - [ ] `AcpProvider.is_session_sharing_eligible` returns:
    - `True` for default backend (kiro-cli) when
      `cfg.agent.session_sharing=True`
    - `False` for `acp_backend="pi"`
    - `False` for `acp_backend="claude"`
  - [ ] No changes to other backends' behavior.
- **Dependencies:** none.
- **Estimate:** ~30 min.
- **Status:** todo

### T02 — Unit tests for the eligibility fix

- **Description:** Write `test/test_subagent_session_sharing.py` with
  three tests per the design doc: kiro eligible, pi not eligible, claude
  not eligible. Use the existing test fixture style (parametrize
  `work_dir`, mock `cfg.agent.session_sharing`).
- **Maps to:** FR-01, FR-04, FR-05, NFR-03.
- **Maps to design:** §"Test design".
- **Acceptance criteria:**
  - [ ] Three tests cover the three relevant backends.
  - [ ] Each test is self-contained (no shared mutable state with other
    tests).
  - [ ] `make test` is green with the new tests.
- **Dependencies:** T01.
- **Estimate:** ~30 min.
- **Status:** todo

### T03 — Live verification

- **Description:** Boot the gateway with `KIROCREW_ACP_BACKEND=pi`,
  trigger a subagent spawn via the dashboard chat panel or the
  `POST /api/spawn` endpoint, and confirm:
  (a) the subagent Activity card appears,
  (b) the parent's transcript is unchanged while the subagent runs,
  (c) the subagent gets its own pi-acp subprocess (visible in
  `ps aux | grep pi-acp`).
- **Maps to:** All FRs (acceptance evidence).
- **Acceptance criteria:**
  - [ ] `ps aux | grep pi-acp` shows at least 2 processes during a
    subagent run (parent + subagent).
  - [ ] The subagent's `agentInfo` and `acp_backend` confirm it's on
    pi (logs: `AcpProvider starting runtime: acp_backend='pi'`).
  - [ ] No `kiro_crew.acp.runtime` errors in the gateway log during
    the subagent run.
- **Dependencies:** T01 + T02 merged.
- **Estimate:** ~30 min.
- **Status:** todo

## Out-of-scope tasks (deferred)

- **T-deferred-A**: Subagent isolation testing under load. The
  per-process cost of N+1 pi-acp subprocesses hasn't been measured
  end-to-end. Worth a follow-up if subagent latency becomes a problem.
- **T-deferred-B**: Permission policy templates beyond
  `approval_mode="auto"`. Today the parent policy is inherited
  verbatim. A future feature could let users pin a stricter policy for
  subagents (e.g. parent on `auto`, subagent on `interactive`).
- **T-deferred-C**: A `kirowcr-scope-subagent-runtime` opt-in flag for
  advanced users who want to force shared runtime even when not
  officially supported (off-road — documented as unsafe).
