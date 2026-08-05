"""Phase-02 pi-acp-server model discovery — parser + merge.

Single module grouping:
- ``parse_pi_list_models(text)`` — T01: pure markdown parser
- ``advertised_pi_models()`` — re-exported from ``pi_models_runtime``
  (T05: subprocess that calls the parser)
- ``pi_models(configured_default)`` — T02: merge + enrich

The dispatcher (T03) lives in ``agents.py:api_models`` and dispatches on
``KIROCREW_ACP_BACKEND``.
"""

from __future__ import annotations

import re

from kiro_crew import model_registry

# Provider header: a line that is exactly ``**Foo**`` (no other text).
# Names like ``Bifrost``, ``Claude CLI``, ``opencode-go`` all match.
_PROVIDER_RE = re.compile(r"^\*\*(?P<p>[^*]+)\*\*$")

# Model line: ``- `id``` (with optional trailing suffix tokens).
# Group ``id`` captures everything inside the backticks; group ``suf``
# captures everything after the closing backtick (whitespace + tokens).
_MODEL_RE = re.compile(r"^- `(?P<id>[^`]+)`(?:\s*(?P<suf>.*))?$")


def parse_pi_list_models(text: str) -> list[dict]:
    """Parse ``pi list-models`` markdown output into API row records.

    Returns one record per model:
    ``{"model_name": <id>, "display_name": <id>, "description": <tokens>}``.

    Robust to extra whitespace, blank lines, and trailing footer text
    (markdown code fences or ``Use Ctrl+P ...`` prose). Returns ``[]`` on
    empty input.

    Description tokens (joined by ``" · "``):
    - ``"Active model"`` if ``(current)`` appears in the line suffix.
    - ``"Thinking"`` if ``thinking`` appears in the line suffix — the model
      id itself may contain ``-thinking`` (e.g. ``claude-opus-4-5-thinking``)
      and that does NOT count.
    - ``"via <Provider>"`` using the most recent ``**Provider**`` header.

    Footer: stop parsing at any line starting with three backticks. Whitespace
    lines skipped; lines that match neither pattern are silently skipped
    (random prose between provider blocks).
    """
    if not text or not text.strip():
        return []

    rows: list[dict] = []
    provider: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("```"):
            break
        m_provider = _PROVIDER_RE.match(line)
        if m_provider:
            provider = m_provider.group("p").strip()
            continue
        m_model = _MODEL_RE.match(line)
        if not m_model:
            continue

        model_id = m_model.group("id")
        suffix = m_model.group("suf") or ""

        description_parts: list[str] = []
        if "current" in suffix:
            description_parts.append("Active model")
        if "thinking" in suffix:
            description_parts.append("Thinking")
        if provider:
            description_parts.append(f"via {provider}")

        rows.append(
            {
                "model_name": model_id,
                "display_name": model_id,
                "description": " · ".join(description_parts),
            }
        )

    return rows


def pi_models(configured_default: str = "") -> list[dict]:
    """Assemble the pi model dropdown.

    Combines ``advertised_pi_models()`` (live ``pi list-models``) with
    the static ``acp`` provider rows from ``model_registry``. The
    picker returns this list directly under
    ``KIROCREW_ACP_BACKEND=pi``.

    Parity with ``_cc_models`` in ``agents.py``:
    - When the backend advertises nothing (cold start, broken subprocess),
      return the static catalog enriched with windows — matches the CC
      "no advertised yet" branch that returns the registry unfiltered.
    - When the backend advertises something, merge advertised + registry
      and dedupe by normalized key so we never show two rows for the
      same model.
    - The ``auto`` sentinel is always present and always first.
    - ``configured_default`` (typically ``config.agent.model``) is
      inserted if missing so the user's selection never silently
      vanishes when the live subprocess returns a partial set.
    """
    # Lazy import to avoid a module-load cycle (this module owns the
    # canonical parser; the runtime module owns the subprocess function
    # and also re-exports the parser). Importing at call site keeps the
    # cycle off the import path.
    from kiro_crew.dashboard.handlers.pi_models_runtime import (
        advertised_pi_models as _advertised_pi_models,
    )
    advertised = _advertised_pi_models()
    # Static catalog rows: kiro-cli ACP id space (the picker used to
    # ship them; pi-acp accepts the same wire id format, so the rows
    # are still selectable).
    registry_rows = model_registry.display_list("acp")

    enriched_registry = [
        {
            **row,
            "context_window": (
                model_registry.model_window(row.get("model_name", ""))
                or model_registry.REFERENCE_WINDOW_TOKENS
            ),
        }
        for row in registry_rows
    ]

    if not advertised:
        # Cold start / no live subprocess — return the static catalog
        # only, already enriched above.
        return _insert_auto_and_default(enriched_registry, configured_default)

    enriched_advertised = [
        {
            **row,
            "context_window": (
                model_registry.model_window(row.get("model_name", ""))
                or model_registry.REFERENCE_WINDOW_TOKENS
            ),
        }
        for row in advertised
    ]

    # Dedup by normalized key, registry preferred (it carries richer
    # display metadata), advertised appended for forward-compat on
    # models the registry does not list.
    merged: list[dict] = []
    seen: set[str] = set()
    for entry in (*enriched_registry, *enriched_advertised):
        name = entry.get("model_name", "")
        key = _normalize_model_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    return _insert_auto_and_default(merged, configured_default)


# ---------------------------------------------------------------------------
# Shared helpers — duplicated here rather than importing from agents.py to
# avoid the circular import already documented for kiro_crew.providers.acp.
# Small, intentionally local; refactor if a third caller emerges.
# ---------------------------------------------------------------------------


def _normalize_model_key(name: str) -> str:
    """Lowercase, dedupe-friendly model key. Mirrors agents._normalize_model_key."""
    return (name or "").strip().lower()


def _insert_auto_and_default(rows: list[dict], configured_default: str = "") -> list[dict]:
    """Ensure the picker has ``auto`` (sentinel) and the configured default.

    - ``auto`` is always present and first; it is the configured default
      sentinel rather than a real model.
    - ``configured_default`` (e.g. ``model_registry._FALLBACK_CANONICAL``'s
      canonical key) is inserted at position 1 if it is not already in
      the list — keeps the user's stored selection visible.
    """
    merged = list(rows)
    keys = {_normalize_model_key(r.get("model_name", "")) for r in merged}

    # 1) Insert ``auto`` at the top if missing.
    if "auto" not in keys:
        merged.insert(
            0,
            {
                "model_name": "auto",
                "display_name": "Auto",
                "description": "",
                "context_window": model_registry.REFERENCE_WINDOW_TOKENS,
            },
        )
        keys.add("auto")

    # 2) Insert configured default if it is non-empty and missing.
    if configured_default:
        canonical_default = configured_default
        default_key = _normalize_model_key(canonical_default)
        if default_key and default_key not in keys:
            insert_at = 1 if merged and _normalize_model_key(
                merged[0].get("model_name", "")
            ) == "auto" else 0
            merged.insert(
                insert_at,
                {
                    "model_name": canonical_default,
                    "display_name": canonical_default,
                    "description": "Configured default",
                    "context_window": (
                        model_registry.model_window(canonical_default)
                        or model_registry.REFERENCE_WINDOW_TOKENS
                    ),
                },
            )

    return merged
