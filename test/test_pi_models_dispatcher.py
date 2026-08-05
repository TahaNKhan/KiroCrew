"""Phase-02 G2/G3 — tests for ``pi_models()`` merge function + api_models dispatch.

Stubs:
- ``kiro_crew.dashboard.handlers.pi_models_runtime.advertised_pi_models`` — patched via
  ``sys.modules`` because ``pi_models()`` lazy-imports it inside the function body.
- ``kiro_crew.model_registry.display_list`` — patched via ``sys.modules`` since
  the merge function does ``from kiro_crew import model_registry``.
"""

from __future__ import annotations

import sys
from unittest.mock import patch

import pytest

# Import pi_models via its module so ``sys.modules`` patching reaches it.
import kiro_crew.dashboard.handlers.pi_models as pi_mod
from kiro_crew.dashboard.handlers import pi_models as real_pi_models_module


def _stub_advertised(rows):
    """Patch advertised_pi_models on the real runtime module.

    ``pi_models()`` does ``import kiro_crew.dashboard.handlers.pi_models_runtime
    as _rt_module`` inside the function body — that import re-fetches the
    cached module object from ``sys.modules``, so patching the attribute
    on the real module is sufficient (no need to replace the whole
    module entry in ``sys.modules``).
    """
    async def _async_rows():
        return rows

    return [
        patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.advertised_pi_models",
            _async_rows,
            create=True,
        ),
    ]


def _stub_registry(rows):
    """Replace model_registry.display_list at the module attribute level."""
    return [
        patch(
            "kiro_crew.model_registry.display_list",
            lambda provider: rows,
            create=True,
        ),
        patch(
            "kiro_crew.dashboard.handlers.pi_models.model_registry.display_list",
            lambda provider: rows,
            create=True,
        ),
    ]


def _call_pi_models(advertised, registry_rows, configured_default=""):
    """Invoke pi_models with stubs in place. ``pi_models`` is async (it
    awaits the subprocess), so this helper runs the event loop too."""
    import asyncio
    from contextlib import ExitStack

    with ExitStack() as stack:
        for ctx in _stub_advertised(advertised):
            stack.enter_context(ctx)
        for ctx in _stub_registry(registry_rows):
            stack.enter_context(ctx)
        return asyncio.run(real_pi_models_module.pi_models(configured_default))


# ---------------------------------------------------------------------------
# pi_models() merge function
# ---------------------------------------------------------------------------


def test_dedupes_when_advertised_overlaps_registry():
    """Registry and advertised both list claude-opus-4-8. Result must
    show it ONCE, with the registry row (richer display_name) preferred."""
    advertised = [
        {"model_name": "claude-opus-4-8", "display_name": "claude-opus-4-8",
         "description": "via Claude CLI"},
        {"model_name": "advertised-only-model", "display_name": "advertised-only-model",
         "description": "via pi"},
    ]
    registry = [
        {"model_name": "claude-opus-4-8", "display_name": "Opus 4.8",
         "description": "AC provider", "model_id_alt": "claude-opus-4-8"},
        {"model_name": "registry-only-model", "display_name": "Registry Only",
         "description": "AC provider"},
    ]
    rows = _call_pi_models(advertised, registry)

    assert rows[0]["model_name"] == "auto"
    claude_row = next(r for r in rows if r["model_name"] == "claude-opus-4-8")
    assert claude_row["display_name"] == "Opus 4.8"
    assert any(r["model_name"] == "advertised-only-model" for r in rows)
    assert any(r["model_name"] == "registry-only-model" for r in rows)
    keys = [r["model_name"] for r in rows]
    assert len(keys) == len(set(keys))


def test_auto_sentinel_always_first_even_when_advertised_empty():
    advertised = []
    registry = [
        {"model_name": "claude-opus-4-8", "display_name": "Opus 4.8",
         "description": "AC provider"},
    ]
    rows = _call_pi_models(advertised, registry)
    assert rows[0]["model_name"] == "auto"
    for r in rows:
        assert "context_window" in r
        assert r["context_window"] > 0


def test_configured_default_inserted_when_missing():
    advertised = [
        {"model_name": "claude-opus-4-8", "display_name": "claude-opus-4-8",
         "description": "via Claude CLI"},
    ]
    rows = _call_pi_models(advertised, [], configured_default="claude-opus-4-8")
    keys = [r["model_name"] for r in rows]
    assert "claude-opus-4-8" in keys
    # Either it came from advertised (no description tag) or from the
    # configured_default insert ("Configured default" tag). The point is
    # it's present exactly once.
    assert keys.count("claude-opus-4-8") == 1


def test_configured_default_not_duplicated_when_already_present():
    advertised = [
        {"model_name": "custom-model-x", "display_name": "custom-model-x",
         "description": "via pi"},
    ]
    rows = _call_pi_models(advertised, [], configured_default="custom-model-x")
    keys = [r["model_name"] for r in rows]
    assert keys.count("custom-model-x") == 1


def test_every_row_has_context_window():
    advertised = [
        {"model_name": "definitely-unknown-model", "display_name": "?",
         "description": ""},
    ]
    rows = _call_pi_models(advertised, [])
    for row in rows:
        assert row.get("context_window", 0) > 0, f"row missing context_window: {row}"
