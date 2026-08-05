"""Live subprocess runtime for `pi list-models` — T05 of phase-02.

Pure runtime: shells ``pi list-models`` in the same sandbox posture as the
existing kiro-cli path in ``agents.py:api_models``, parses the markdown
output, and returns rows enriched with ``context_window``.

This module owns the subprocess shell + sandbox; the canonical
markdown parser (``parse_pi_list_models``) lives in
``pi_models_runtime``'s sibling module ``pi_models.py`` (T01) and is
re-exported here so ``test/test_pi_models_runtime.py`` — which T05 owns —
keeps its existing import path.

Per the phase-02 design doc:
- All failure modes return ``[]`` (degraded, never raise).
- Caller treats ``[]`` as "no live advertised set", which triggers the
  static-catalog fallback in the merge layer.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import subprocess
from typing import Any

from kiro_crew import model_registry
from kiro_crew.dashboard.handlers.pi_models import parse_pi_list_models
from kiro_crew.env import augmented_path
from kiro_crew.sandbox import cgroup_scope_argv, create_subprocess_limited, wrap_argv

# Re-exported so the existing test module's imports keep working.
__all__ = ["parse_pi_list_models", "advertised_pi_models"]

logger = logging.getLogger(__name__)

# Hard cap on stderr we log on non-zero exit. Matches the kiro-cli path in
# ``agents.py:_MODEL_LIST_STDERR_TAIL_CHARS`` so the log noise floor is the
# same across backends.
_STDERR_TAIL_CHARS = 1000

# Per-shell timeout, also matches the kiro-cli path (10s — see agents.py).
_SUBPROCESS_TIMEOUT_SECS = 10.0


def _enrich_with_context_window(row: dict) -> dict:
    """Populate ``context_window`` from the central authority or fall back.

    Never returns ``None`` and never silent-200ks: pi doesn't advertise a
    window per model, so the central authority either knows it (the
    registry has it) or returns ``None`` and we substitute the reference
    1M. The merge layer (``_pi_models``) calls this for every row before
    it leaves the handler.
    """
    name = row.get("model_name", "")
    window = model_registry.model_window(name) or model_registry.REFERENCE_WINDOW_TOKENS
    row["context_window"] = window
    return row


async def _run_pi_list_models() -> list[dict]:
    """Subprocess + parse + enrich. Returns [] on any failure.

    Failure modes (each returns []):
    1. ``shutil.which("pi")`` returns None — binary not installed.
    2. Subprocess exits non-zero — read stderr tail, log warning, return [].
    3. ``asyncio.wait_for`` timeout (10s) — proc.kill(), return [].
    4. Empty stdout — return [].
    5. Parse failure — parse_pi_list_models returns [] for malformed shapes.

    Exposed as a thin async helper so tests can monkeypatch it directly
    (mock subprocess + parse in isolation). The public ``advertised_pi_models``
    wraps this with the log argument.
    """
    pi_bin = shutil.which("pi")
    if not pi_bin:
        return []

    argv = [pi_bin, "list-models"]
    # Mirror AcpClient._spawn sandbox: wrap_argv + cgroup_scope_argv.
    argv, cleanup = wrap_argv(argv)
    argv = cgroup_scope_argv(argv)
    try:
        env = {**os.environ}
        env["PATH"] = augmented_path(env.get("PATH", ""))
        # Note: we don't call _resolve_ssh_auth_sock here — pi doesn't
        # need SSH. The kiro-cli path uses it because it may invoke
        # agent-side tools that hit git+ssh. Keeping pi's environment
        # lean avoids the SSH-agent-discovery round trip per poll.
        proc = await create_subprocess_limited(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
            env=env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=_SUBPROCESS_TIMEOUT_SECS
            )
        except asyncio.TimeoutError:
            logger.warning(
                "advertised_pi_models: pi list-models timed out after %.1fs",
                _SUBPROCESS_TIMEOUT_SECS,
            )
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.communicate()
            except Exception:
                logger.debug("communicate after kill failed", exc_info=True)
            return []
        finally:
            if cleanup and callable(cleanup):
                cleanup()

        if proc.returncode != 0:
            from kiro_crew.platform import redact_via_context  # noqa: F811
            stderr_tail = stderr.decode(errors="replace").strip() if stderr else ""
            if stderr_tail:
                stderr_tail = redact_via_context(stderr_tail)[-_STDERR_TAIL_CHARS:]
            logger.warning(
                "advertised_pi_models: pi list-models exited %s: %s",
                proc.returncode,
                stderr_tail or "<no stderr>",
            )
            return []

        stdout_text = stdout.decode(errors="replace") if stdout else ""
        if not stdout_text.strip():
            logger.warning("advertised_pi_models: pi list-models returned empty stdout")
            return []

        return parse_pi_list_models(stdout_text)
    except FileNotFoundError:
        # Race: binary removed between which() and spawn.
        logger.warning("advertised_pi_models: pi binary vanished between check and spawn")
        return []
    except Exception:
        logger.warning(
            "advertised_pi_models: unexpected failure; returning []",
            exc_info=True,
        )
        return []


async def advertised_pi_models(log: logging.Logger | None = None) -> list[dict]:
    """Shell ``pi list-models``, parse markdown, return rows enriched with context_window.

    Returns ``[]`` on any failure (binary missing, timeout, non-zero exit,
    empty stdout, parse exception) — never raises. Caller treats ``[]`` as
    "no live advertised set", which triggers the static-catalog fallback
    in the merge layer (``_pi_models``).

    Args:
        log: Optional override for the module logger. When ``None`` uses the
            module-level logger. The ``log`` parameter exists so the eventual
            dispatcher (T03) can pass a request-scoped logger if it wants;
            in practice the module logger is fine.

    Returns:
        List of rows shaped like ``_cc_models`` output:
        ``{model_name, display_name, description, context_window}``.
    """
    rows = await _run_pi_list_models()
    return [_enrich_with_context_window(row) for row in rows]
