"""Tests for AcpProvider.is_session_sharing_eligibility.

Phase-03 fix: this property used to return True for the pi backend
(``not self.is_claude_backend``), but pi-acp is one-process-per-session
like claude — it does not support multiplexed sessions. Subagent
spawning under pi therefore silently tried to multiplex onto a single
pi-acp subprocess, which doesn't work. These tests pin the corrected
behavior.

The downstream consumer (``SubagentManager._should_use_session_sharing``,
which calls ``sessions.is_session_sharing_eligible(parent_key)``)
already does the right thing given a correct answer here, so the only
contract under test is the property itself.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from kiro_crew.acp.types import ACP_BACKEND_CLAUDE, ACP_BACKEND_KIRO, ACP_BACKEND_PI
from kiro_crew.providers.acp import AcpProvider


def _make_provider(*, backend: str) -> AcpProvider:
    """Build an AcpProvider with a mocked AcpClient carrying the given backend."""
    with patch("kiro_crew.providers.acp.AcpClient"):
        provider = AcpProvider()
    # AcpProvider.__init__ assigns self._client; replace it with a Mock that
    # exposes only the attributes is_session_sharing_eligible reads.
    mock_client = MagicMock()
    mock_client.backend = backend
    # _is_pi reads self._client._is_pi (a bool property on AcpClient).
    mock_client._is_pi = backend == ACP_BACKEND_PI
    provider._client = mock_client
    return provider


def test_kiro_default_backend_is_session_sharing_eligible():
    """Empty / kiro-cli backend: eligible. Multiplexing works on AcpRuntime."""
    p = _make_provider(backend=ACP_BACKEND_KIRO)
    assert p.is_claude_backend is False
    assert p._is_pi is False
    assert p.is_session_sharing_eligible is True


def test_pi_backend_is_NOT_session_sharing_eligible():
    """Pi backend: NOT eligible. pi-acp is one-process-per-session.

    Regression guard for the phase-03 fix: before this, ``not
    is_claude_backend`` returned True for pi and subagent spawning
    under pi silently tried to multiplex onto a single pi-acp process.
    """
    p = _make_provider(backend=ACP_BACKEND_PI)
    assert p._is_pi is True
    assert p.is_session_sharing_eligible is False


def test_claude_backend_is_NOT_session_sharing_eligible():
    """Claude backend (dormant seam): NOT eligible. Same reason as pi."""
    p = _make_provider(backend=ACP_BACKEND_CLAUDE)
    assert p.is_claude_backend is True
    assert p.is_session_sharing_eligible is False


def test_is_pi_handles_missing_attribute():
    """If a client implementation lacks ``_is_pi`` (forward-compat), the
    property returns False instead of raising. This is the safer default:
    a future backend that doesn't set ``_is_pi`` is treated as not-pi
    (and so would inherit session-sharing eligibility from the kiro
    default, which is the safe multiplex-capable assumption).
    """
    p = _make_provider(backend="some_future_backend")
    # Delete the attribute the property reads.
    del p._client._is_pi
    # Should not raise; should return False.
    assert p._is_pi is False


def test_eligibility_matches_session_manager_delegation():
    """The session-manager side (``sessions.is_session_sharing_eligible``)
    ultimately reads from the provider. The provider's answer and the
    session-manager's answer must agree for the same session.
    """
    for backend, expected in [
        (ACP_BACKEND_KIRO, True),
        (ACP_BACKEND_PI, False),
        (ACP_BACKEND_CLAUDE, False),
    ]:
        p = _make_provider(backend=backend)
        assert p.is_session_sharing_eligible is expected, (
            f"backend={backend!r}: expected {expected}, got {p.is_session_sharing_eligible}"
        )
