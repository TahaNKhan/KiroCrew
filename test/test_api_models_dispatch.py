"""T03 — test the api_models dispatcher routes on KIROCREW_ACP_BACKEND.

The dispatcher reads env at request time, so each test patches
``os.environ`` and verifies the corresponding handler was invoked. The
handlers themselves (``_kiro_cli_models`` and ``_pi_models_response``)
have their own deeper tests; these pin the ROUTING.
"""

from __future__ import annotations

import json
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kiro_crew.dashboard.handlers import agents as agents_mod


def _web_request():
    """Minimal aiohttp-like request the handlers can read."""
    req = MagicMock()
    req.app = {"state": MagicMock()}
    # reject_if_kiro_unverified checks request.app[...]. for some attrs; stub
    # whatever it needs minimally.
    return req


@pytest.mark.asyncio
async def test_default_backend_calls_kiro_cli_path():
    """Unset KIROCREW_ACP_BACKEND → kiro-cli subprocess path."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("KIROCREW_ACP_BACKEND", None)
        with patch.object(
            agents_mod, "_kiro_cli_models", new=AsyncMock(return_value=MagicMock())
        ) as kiro_mock, patch.object(
            agents_mod, "_pi_models_response", new=AsyncMock()
        ) as pi_mock:
            await agents_mod.api_models(_web_request())
    kiro_mock.assert_awaited_once()
    pi_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_pi_backend_calls_pi_path():
    """KIROCREW_ACP_BACKEND=pi → pi merge-function path."""
    with patch.dict(os.environ, {"KIROCREW_ACP_BACKEND": "pi"}):
        with patch.object(
            agents_mod, "_pi_models_response",
            new=AsyncMock(return_value=MagicMock())
        ) as pi_mock, patch.object(
            agents_mod, "_kiro_cli_models", new=AsyncMock()
        ) as kiro_mock:
            await agents_mod.api_models(_web_request())
    pi_mock.assert_awaited_once()
    kiro_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_kiro_backend_value_routes_to_kiro_cli():
    """KIROCREW_ACP_BACKEND=kiro (explicit kiro-cli) routes to the kiro path."""
    with patch.dict(os.environ, {"KIROCREW_ACP_BACKEND": "kiro"}):
        with patch.object(
            agents_mod, "_kiro_cli_models", new=AsyncMock(return_value=MagicMock())
        ) as kiro_mock, patch.object(
            agents_mod, "_pi_models_response", new=AsyncMock()
        ) as pi_mock:
            await agents_mod.api_models(_web_request())
    kiro_mock.assert_awaited_once()
    pi_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_claude_backend_routes_to_kiro_cli_fallback_for_now():
    """Claude backend is a dormant seam — only a companion edition reaches
    it, and even then via `_advertised_cc_models` invoked elsewhere. The
    default dispatcher treats it as the kiro-cli path so the picker
    doesn't show empty when only ``KIROCREW_ACP_BACKEND=claude`` is set.
    """
    with patch.dict(os.environ, {"KIROCREW_ACP_BACKEND": "claude"}):
        with patch.object(
            agents_mod, "_kiro_cli_models", new=AsyncMock(return_value=MagicMock())
        ) as kiro_mock, patch.object(
            agents_mod, "_pi_models_response", new=AsyncMock()
        ) as pi_mock:
            await agents_mod.api_models(_web_request())
    kiro_mock.assert_awaited_once()
    pi_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_whitespace_env_var_treated_as_unset():
    """``KIROCREW_ACP_BACKEND='   '`` (whitespace) treated as unset → kiro-cli."""
    with patch.dict(os.environ, {"KIROCREW_ACP_BACKEND": "   "}):
        with patch.object(
            agents_mod, "_kiro_cli_models", new=AsyncMock(return_value=MagicMock())
        ) as kiro_mock, patch.object(
            agents_mod, "_pi_models_response", new=AsyncMock()
        ) as pi_mock:
            await agents_mod.api_models(_web_request())
    kiro_mock.assert_awaited_once()
    pi_mock.assert_not_awaited()
