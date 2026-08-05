"""Tests for ``pi_models_runtime`` — T05 of phase-02.

Covers both pure-markdown parsing and the subprocess-runtime path.
The subprocess is mocked — these are unit tests, not integration tests.
Real ``pi list-models`` coverage is in T06 (live verification).
"""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# --- pytest-asyncio config ---------------------------------------------------
# The repo's existing pytest setup uses an event-loop fixture per-test
# (see conftest.py at /home/taha/projects/KiroCrew/test/conftest.py).
# Mirror that pattern here so we don't conflict with global state.

# Import the module under test. Use the full module path so it's mockable
# from the test (we patch the _run_pi_list_models symbol on this module).
from kiro_crew.dashboard.handlers import pi_models_runtime
from kiro_crew.dashboard.handlers.pi_models_runtime import (
    _enrich_with_context_window,
    advertised_pi_models,
    parse_pi_list_models,
)


# ---------------------------------------------------------------------------
# Pure parser tests — no subprocess involved.
# ---------------------------------------------------------------------------


def test_parser_handles_full_pi_list_models_output():
    """The exact format ``pi list-models`` emits on this machine today."""
    text = (
        "Available models:\n\n"
        "**Bifrost**\n"
        "- `GLM/glm-4.5`\n"
        "- `GLM/glm-4.5-air`\n"
        "- `Minimax/MiniMax-M3` **(current)**\n"
        "- `opencode-go/deepseek-v4-pro` *(thinking)*\n\n"
        "**Claude CLI**\n"
        "- `claude-fable-5`\n"
        "- `claude-opus-4-8`\n\n"
        "Use `Ctrl+P` to cycle configured models, or launch with:\n\n"
        "```bash\n"
        "pi --model Minimax/MiniMax-M3\n"
        "```\n"
    )
    rows = parse_pi_list_models(text)
    assert [r["model_name"] for r in rows] == [
        "GLM/glm-4.5",
        "GLM/glm-4.5-air",
        "Minimax/MiniMax-M3",
        "opencode-go/deepseek-v4-pro",
        "claude-fable-5",
        "claude-opus-4-8",
    ]
    assert rows[0]["description"] == "via Bifrost"
    assert rows[2]["description"] == "Active model · via Bifrost"
    assert rows[3]["description"] == "Thinking · via Bifrost"
    assert rows[4]["description"] == "via Claude CLI"
    assert rows[5]["description"] == "via Claude CLI"


def test_parser_handles_empty_input():
    assert parse_pi_list_models("") == []
    assert parse_pi_list_models("Available models:\n") == []
    assert parse_pi_list_models("\n\n\n   \n") == []


def test_parser_skips_malformed_lines_without_raising():
    """Random prose between provider blocks must not produce phantom rows."""
    text = (
        "**Bifrost**\n"
        "- `model-a`\n"
        "blah blah random prose\n"
        "and another line of prose\n"
        "**Claude CLI**\n"
        "- `model-b`\n"
    )
    rows = parse_pi_list_models(text)
    assert [r["model_name"] for r in rows] == ["model-a", "model-b"]


def test_parser_stops_at_code_fence():
    """Markdown code fences end the parse even when they look like model lines."""
    text = (
        "**P**\n"
        "- `m1`\n"
        "```bash\n"
        "echo 'looks like a row: `- \\`m2\\``'\n"
        "```\n"
        "- `m3`\n"
    )
    rows = parse_pi_list_models(text)
    assert [r["model_name"] for r in rows] == ["m1"]


def test_parser_handles_no_provider_headers():
    """Pi without provider headers (rare) — rows just have empty provider info."""
    text = "- `lone-model`\n"
    rows = parse_pi_list_models(text)
    assert len(rows) == 1
    assert rows[0]["model_name"] == "lone-model"
    assert rows[0]["description"] == ""


# ---------------------------------------------------------------------------
# Enrichment tests — context_window fallback.
# ---------------------------------------------------------------------------


def test_enrich_uses_registry_window_when_known(monkeypatch):
    """A model in the central authority picks up the registry's window."""
    # Patch model_registry.model_window to return a deterministic value.
    monkeypatch.setattr(
        "kiro_crew.model_registry.model_window",
        lambda name: 200_000 if name == "claude-opus-4-8" else None,
    )
    row = {"model_name": "claude-opus-4-8", "display_name": "claude-opus-4-8", "description": "via Claude CLI"}
    out = _enrich_with_context_window(row)
    assert out["context_window"] == 200_000


def test_enrich_falls_back_to_reference_when_unknown(monkeypatch):
    """A model not in the registry gets REFERENCE_WINDOW_TOKENS (1M)."""
    from kiro_crew import model_registry
    monkeypatch.setattr(model_registry, "model_window", lambda name: None)
    row = {"model_name": "Minimax/MiniMax-M3", "display_name": "MiniMax-M3", "description": "via Bifrost"}
    out = _enrich_with_context_window(row)
    assert out["context_window"] == model_registry.REFERENCE_WINDOW_TOKENS
    assert out["context_window"] == 1_000_000


def test_enrich_handles_falsy_zero_window():
    """A registry window of 0 must NOT pass the truthiness gate — fall back."""
    from kiro_crew import model_registry
    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setattr(model_registry, "model_window", lambda name: 0)
        row = {"model_name": "weird-zero", "display_name": "w", "description": ""}
        out = _enrich_with_context_window(row)
        assert out["context_window"] == model_registry.REFERENCE_WINDOW_TOKENS
    finally:
        monkeypatch.undo()


# ---------------------------------------------------------------------------
# Subprocess-runtime tests — failure modes return [].
# ---------------------------------------------------------------------------


def _make_proc(*, returncode: int, stdout: bytes = b"", stderr: bytes = b"") -> AsyncMock:
    """Build a mock asyncio.subprocess.Process."""
    proc = AsyncMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    proc.kill = MagicMock()
    return proc


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value=None)
async def test_returns_empty_when_binary_missing(mock_which):
    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_timeout(mock_spawn, mock_which):
    proc = AsyncMock()
    proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())
    proc.kill = MagicMock()
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert rows == []
    proc.kill.assert_called_once()


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_nonzero_exit(mock_spawn, mock_which):
    proc = _make_proc(returncode=1, stderr=b"auth required: run `pi auth`")
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_empty_stdout(mock_spawn, mock_which):
    proc = _make_proc(returncode=0, stdout=b"")
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_unparseable_output(mock_spawn, mock_which):
    """Garbage stdout that parse_pi_list_models can't structure → []."""
    proc = _make_proc(returncode=0, stdout=b"this is not markdown at all")
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_rows_on_success(mock_spawn, mock_which):
    markdown = (
        "**Bifrost**\n"
        "- `Minimax/MiniMax-M3` **(current)**\n"
        "- `GLM/glm-4.5`\n"
        "**Claude CLI**\n"
        "- `claude-opus-4-8`\n"
    )
    proc = _make_proc(returncode=0, stdout=markdown.encode())
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert len(rows) == 3
    assert rows[0]["model_name"] == "Minimax/MiniMax-M3"
    assert "Active model" in rows[0]["description"]
    assert rows[2]["model_name"] == "claude-opus-4-8"
    # Every row enriched with context_window
    for r in rows:
        assert "context_window" in r
        assert r["context_window"] > 0


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_unexpected_exception(mock_spawn, mock_which):
    """Defense in depth: unexpected errors return [], never raise."""
    mock_spawn.side_effect = RuntimeError("boom")
    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_returns_empty_on_race_binary_vanished(mock_spawn, mock_which):
    """``shutil.which`` says yes, ``FileNotFoundError`` says no — race."""
    mock_spawn.side_effect = FileNotFoundError("pi: not found at exec")
    rows = await advertised_pi_models()
    assert rows == []


@pytest.mark.asyncio
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which", return_value="/usr/bin/pi")
@patch("kiro_crew.dashboard.handlers.pi_models_runtime.create_subprocess_limited")
async def test_context_window_falls_back_to_reference_for_unknown_models(
    mock_spawn, mock_which, monkeypatch
):
    """A pi model with no registry row gets REFERENCE_WINDOW_TOKENS."""
    from kiro_crew import model_registry

    monkeypatch.setattr(model_registry, "model_window", lambda name: None)

    markdown = "**Bifrost**\n- `SomeFuture/Model-XYZ`\n"
    proc = _make_proc(returncode=0, stdout=markdown.encode())
    mock_spawn.return_value = proc

    rows = await advertised_pi_models()
    assert len(rows) == 1
    assert rows[0]["model_name"] == "SomeFuture/Model-XYZ"
    assert rows[0]["context_window"] == model_registry.REFERENCE_WINDOW_TOKENS
