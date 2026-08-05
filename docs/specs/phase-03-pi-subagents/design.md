# Design — pi Subagent Support

## The bug, in one sentence

`AcpProvider.is_session_sharing_eligible` returns `True` for the pi
backend because it only checks `not is_claude_backend`, but pi-acp is
also one-process-per-session (not multiplexed). Phase-01 inherited
this without considering the new pi backend.

## The fix

Two lines in `src/kiro_crew/providers/acp.py`:

```python
@property
def is_session_sharing_eligible(self) -> bool:
    """True when this provider can host multiplexed subagent sessions.

    Session sharing requires the kiro-cli backend (which supports N
    concurrent sessions per process via AcpRuntime demux). The Claude
    backend AND the pi backend use AcpClient (one process per session)
    and are never eligible — subagents fall back to the legacy per-process
    path (one pi-acp subprocess per subagent).
    """
    if self.is_claude_backend or self._is_pi:
        return False
    # Default kiro-cli path (the only one AcpRuntime's demux supports).
    return True
```

`_is_pi` is already a property on `AcpClient` (added in phase-01). The
`AcpProvider` instance just reads the same flag from its underlying
client:

```python
@property
def _is_pi(self) -> bool:
    return getattr(self._client, "_is_pi", False)
```

That single change makes `_should_use_session_sharing()` correctly
return `False` for pi, so `SubagentManager` falls back to the legacy
`get_subagent_runtime()` path (one process per subagent).

## Why the legacy per-process path is fine for pi

When `_should_use_session_sharing` returns `False`, the subagent flow is:

```
SubagentManager.spawn()
  -> _create_session_for_subagent()  // not _create_shared_session
  -> AcpProvider() via _provider_factory(parent, agent, cwd)
  -> AcpRuntime.spawn()  // one fresh subprocess per subagent
```

Each subagent gets its own `AcpRuntime` (phase-01 already wired
`acp_backend="pi"` through `AcpRuntime.__init__` and `AcpRuntime.spawn`).
The subagent's pi-acp subprocess is independent — its MCP catalog,
tool session, and transcript are isolated.

The trade-off: N concurrent subagents = N+1 pi-acp processes (parent
+ N). Existing `cgroup_scope_argv` already applies per-process
resource ceilings. `compute_max_subagents` caps concurrency at a
sensible bound. So this is fine.

## Permission flow inheritance (FR-02)

The permission flow already works through the existing path. When a
subagent runs on its own pi-acp subprocess, pi-acp emits
`session/request_permission` notifications. These flow through:

```
pi-acp session/request_permission
  -> AcpRuntime._reader_loop
  -> AcpSessionHandle.enqueue_event(EVENT_PERMISSION_REQUEST)
  -> SubagentManager._on_event(...)
  -> Dashboard EVENT_PERMISSION_REQUEST broadcast
  -> Dashboard approval card
```

When the user approves, the reply goes back through
`SubagentManager._pending_permission_replies` (already exists) →
`AcpSessionHandle.approve_tool` → `pi-acp session/request_permission`
reply → pi's tool proceeds.

The `approval_policy="auto"` case is handled at the
`AcpSessionProvider` level: the session reads `info.approval_policy`
from `info` and short-circuits the permission request entirely (a
no-op `approve_tool`). Phase-01 didn't break this; phase-03 doesn't
need to change it.

**No new code needed for FR-02.** Verify via integration test.

## Why the claude backend does NOT change

`is_claude_backend` returns `True` for `acp_backend="claude"` (the
dormant seam). With the new fix:

- `is_claude_backend=True` → returns `False` (no session sharing). Same
  behavior as today.
- `is_pi=True` → returns `False` (no session sharing). **New behavior
  that fixes the latent bug.**
- Default kiro-cli path → returns `True` (session sharing). Same
  behavior as today.

Claude-acp uses one process per session (the dormant seam design,
mirroring what `claude-agent-acp` does). If a future companion edition
makes claude session-sharing-eligible, it must override
`is_session_sharing_eligible` itself — the dormant public-core check
should stay conservative.

## Test design

`test/test_subagent_session_sharing.py`:

```python
import pytest
from kiro_crew.providers.acp import AcpProvider


@pytest.fixture
def tmp_work_dir(tmp_path):
    return str(tmp_path)


def test_kiro_default_is_sharing_eligible(tmp_work_dir):
    """Default kiro-cli backend + session_sharing config: eligible."""
    from kiro_crew.config.loader import KiroCrewConfig
    cfg = KiroCrewConfig.load()
    # patch cfg.agent.session_sharing to True (test fixture)
    cfg.agent.session_sharing = True
    p = AcpProvider(work_dir=tmp_work_dir, acp_backend="")
    assert p.is_session_sharing_eligible is True


def test_pi_is_NOT_sharing_eligible(tmp_work_dir):
    """Pi backend: never eligible — subagent gets its own pi-acp subprocess."""
    p = AcpProvider(work_dir=tmp_work_dir, acp_backend="pi")
    assert p.is_session_sharing_eligible is False


def test_claude_is_NOT_sharing_eligible(tmp_work_dir):
    """Claude backend (dormant seam): never eligible — one process per session."""
    p = AcpProvider(work_dir=tmp_work_dir, acp_backend="claude")
    assert p.is_session_sharing_eligible is False
```

These cover the three relevant backends. The kiro-cli path with
`session_sharing=False` (config-disabled) is already tested in
existing test_subagent_session_sharing tests (the `info.model`,
`info.allowed_tools`, `info.bare` short-circuits already exist in
`_should_use_session_sharing`).

`test/test_pi_subagent_integration.py` (live, gated):

```python
@pytest.mark.integration
async def test_subagent_spawns_independent_pi_subprocess():
    """Spawn a subagent under pi; assert independent subprocess via PIDs."""
    # Use the existing test harness; spawn subagent; capture PIDs;
    # assert parent_pid != subagent_pid.
    ...
```

## Mapping to existing code

| New code | Existing pattern |
|---|---|
| `AcpProvider._is_pi` property | mirrors `is_claude_backend` (already a property) |
| `AcpProvider.is_session_sharing_eligible` 2-line change | already the canonical eligibility check |
| Tests | `test/test_subagent_session_sharing.py` (new file, follows existing test style) |

## Acceptance evidence

After gate-merge:

```bash
# Unit:
pytest -q test/test_subagent_session_sharing.py
# Expected: 3/3 pass (kiro eligible, pi not, claude not)

# Live:
KIROCREW_ACP_BACKEND=pi kirocrew gateway &
sleep 4
TOKEN=$(kirocrew token | tail -1 | sed 's|http://localhost:5476?token=||')

# In the dashboard at http://localhost:5476, type "research pi's tool
# catalog and tell me what you find" — the parent chat spawns a subagent.
# Look at the Activity panel: the subagent card should appear with its
# own progress, and the parent's transcript should be unaffected.
```

## Why this is genuinely a 2-line fix

The whole bug is a property that returns the wrong answer for one
backend. The downstream code (`SubagentManager._should_use_session_sharing`,
`SessionManager.is_session_sharing_eligible`, the runtime-create
branch) is already correct given the right input. No abstractions to
introduce, no new modules, no spec changes — just the eligibility
check returning the truth.

The only "design" question is whether `is_pi` belongs on `AcpProvider`
or stays implicit on `AcpClient`. Mirroring the existing
`is_claude_backend` pattern (provider reads from its client) is the
consistent choice — no new abstraction layer needed.
