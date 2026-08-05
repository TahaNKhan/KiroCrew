"""Tests for ``pi_models_runtime`` — T05 of phase-02.

Subprocess-mocking tests only. The pure parser logic is tested in
``test_parse_pi_models_markdown.py``. These tests use the modern
``pi --list-models`` fixed-column output format.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kiro_crew.dashboard.handlers import pi_models_runtime
from kiro_crew.dashboard.handlers.pi_models_runtime import (
    advertised_pi_models,
    parse_pi_list_models,
)


# (No module-level cache in the simple T05 runtime — the merge layer
# handles caching. Each test gets a fresh subprocess.)


# Real ``pi --list-models`` output (truncated for tests).
_PI_OUTPUT = (
    b"provider       model            context  max-out  thinking  images\n"
    b"bifrost        GLM/glm-4.5      131.1K   8.2K     no        no\n"
    b"bifrost        claude-opus-4-8  1.0M     128K     yes       yes\n"
)


def _make_proc(*, returncode: int = 0, stdout: bytes = b"", stderr: bytes = b""):
    proc = MagicMock()
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    proc.returncode = returncode
    proc.kill = MagicMock()
    return proc


# ---------------------------------------------------------------------------
# 503-on-failure semantics
# ---------------------------------------------------------------------------


def test_returns_empty_when_binary_missing():
    """``shutil.which('pi')`` returns None → ``advertised_pi_models()`` returns []."""
    async def _run():
        with patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which",
            return_value=None,
        ):
            return await advertised_pi_models()

    assert asyncio.run(_run()) == []


def test_returns_empty_on_subprocess_failure():
    """Subprocess exits non-zero → log a stderr-tail warning and return []."""

    async def _run():
        proc = _make_proc(returncode=127, stdout=b"", stderr=b"somethings broken")
        with patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which",
            return_value="/usr/bin/pi",
        ), patch(
            "asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ):
            return await advertised_pi_models()

    assert asyncio.run(_run()) == []


def test_returns_empty_on_empty_stdout():
    """Empty stdout from the subprocess (rare but possible) → []."""

    async def _run():
        proc = _make_proc(returncode=0, stdout=b"   \n")
        with patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which",
            return_value="/usr/bin/pi",
        ), patch(
            "asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ):
            return await advertised_pi_models()

    assert asyncio.run(_run()) == []


def test_returns_empty_on_unparseable_output():
    """Garbage that the parser cannot interpret → [] (callers fall back to static catalog)."""

    async def _run():
        proc = _make_proc(returncode=0, stdout=b"this is not a valid format")
        with patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which",
            return_value="/usr/bin/pi",
        ), patch(
            "asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ):
            return await advertised_pi_models()

    assert asyncio.run(_run()) == []


def test_returns_rows_on_success():
    """On success, parse the subprocess output and enrich with context_window."""

    async def _run():
        proc = _make_proc(returncode=0, stdout=_PI_OUTPUT)
        with patch(
            "kiro_crew.dashboard.handlers.pi_models_runtime.shutil.which",
            return_value="/usr/bin/pi",
        ), patch(
            "asyncio.create_subprocess_exec",
            new=AsyncMock(return_value=proc),
        ):
            return await advertised_pi_models()

    rows = asyncio.run(_run())
    names = {r["model_name"] for r in rows}
    assert "GLM/glm-4.5" in names
    assert "claude-opus-4-8" in names
    for r in rows:
        assert r["context_window"] > 0
