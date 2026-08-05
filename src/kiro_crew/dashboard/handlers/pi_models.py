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

# Parser for ``pi --list-models`` output.
#
# Modern pi emits a *fixed-column* table (no longer the markdown ``**Provider**``
# bullet list documented in the phase-02 design doc — pi's CLI was overhauled
# and the markdown format is gone). The fixed-column format is:
#
#     <banner line; "Available models:" or similar>
#     provider       model                            context  max-out  thinking  images
#     bifrost        GLM/glm-4.5                      131.1K   8.2K     no        no
#     bifrost        GLM/glm-4.5-air                  131.1K   8.2K     no        no
#     ...
#     pi-claude-cli  claude-opus-4-8                  1.0M     65.5K    yes       yes
#     ...
#     <footer; "Use Ctrl+P ..." prose, optional markdown code fence>
#
# The provider column is variable-width (e.g. ``bifrost``, ``pi-claude-cli``,
# ``opencode-go``). The model column is also variable-width and is what
# we carry as the wire id. Columns are *whitespace-separated* and any
# amount of whitespace (single space or wider) separates fields.
#
# We split each row on runs of two-or-more spaces — that keeps a row
# together (provider + model are single-spaced) but cleanly separates
# columns. Edge case: a single space inside a model id (``claude sonnet``)
# would be mis-split. pi's catalog has no model ids with internal
# whitespace, so this is safe today; if that changes, switch to a
# fixed-column parser (header widths) or a per-row fixed-width scan.

_COL_SEP = re.compile(r"\s{2,}")

_HEADER_TOKENS = frozenset({
    "provider", "model", "context", "max-out", "thinking", "images",
    "max_out", "maxout",  # tolerated alternate headers
})

# Subset of header tokens that mark a row as data (vs. banner / footer).
#
# The header row IS eligible under a loose "≥2 header tokens match" heuristic
# (it has all six), so we also require a size-like or provider-like token to
# break the tie against real header rows. Real data rows always have a size
# in the context column (e.g. ``131.1K``) and a provider prefix that's NOT one
# of the canonical column names. The header row has no size tokens.
_SIZE_LIKE_RE = re.compile(r"^\d+(?:\.\d+)?[KMG]$", re.IGNORECASE)


def _looks_like_data_row(tokens: list[str]) -> bool:
    """True when the row has the shape of a real data row.

    Header rows have tokens like ``[provider, model, context, max-out,
    thinking, images]`` (column names, no sizes). Data rows have a
    provider in column 0 and a size like ``131.1K`` in column 2. So a
    row is data iff it has at least two tokens AND column 2 is a size.
    """
    if len(tokens) < 2:
        return False
    if len(tokens) < 3:
        # Two-column row can't be a valid data row (provider, model).
        return False
    return bool(_SIZE_LIKE_RE.match(tokens[2]))


def _parse_size(token: str) -> int:
    """Parse a size token like ``"131.1K"`` or ``"1M"`` to a token count.

    Returns None for unrecognized tokens (the caller falls back to
    REFERENCE_WINDOW_TOKENS for ``context_window``).
    """
    t = (token or "").strip()
    if not t:
        return 0
    mult = 1
    if t.endswith("K"):
        mult = 1024
        t = t[:-1]
    elif t.endswith("M"):
        mult = 1024 * 1024
        t = t[:-1]
    elif t.endswith("G"):
        mult = 1024 * 1024 * 1024
        t = t[:-1]
    try:
        return int(float(t) * mult)
    except ValueError:
        return 0


def parse_pi_list_models(text: str) -> list[dict]:
    """Parse ``pi --list-models`` output into API row records.

    Returns one record per model with ``{model_name, display_name,
    description, context_window}``. Robust to whitespace variation. Returns
    ``[]`` on empty input.

    Description tokens (joined by ``" · "``):
    - ``"via <provider>"`` from the row's first column.
    - ``"Thinking"`` if the row's thinking column is ``yes`` / ``true``.

    The picker consumes model_registry.context_window as the source of
    truth; this parser returns pi's advertised size as a hint, but the
    merge layer still enriches with model_registry.model_window() first,
    REFERENCE_WINDOW_TOKENS fallback second.
    """
    if not text or not text.strip():
        return []

    rows: list[dict] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        tokens = _COL_SEP.split(line)
        # Drop the trailing empty string the split leaves behind when a line
        # ends in two+ spaces.
        if tokens and tokens[-1] == "":
            tokens = tokens[:-1]

        if not _looks_like_data_row(tokens):
            continue
        if len(tokens) < 2:
            continue

        provider = tokens[0]
        model_id = tokens[1]
        if not provider or not model_id:
            continue

        # Sizes are token #2 and #3 (context, max-out). pi's column order
        # is stable: provider, model, context, max-out, thinking, images.
        # Tolerate either order / missing by index.
        context_window = _parse_size(tokens[2]) if len(tokens) > 2 else 0
        max_out_tokens = _parse_size(tokens[3]) if len(tokens) > 3 else 0
        thinking_token = tokens[4].lower() if len(tokens) > 4 else ""

        description_parts: list[str] = [f"via {provider}"]
        if thinking_token in ("yes", "true"):
            description_parts.append("Thinking")

        rows.append(
            {
                "model_name": model_id,
                "display_name": model_id,
                "description": " · ".join(description_parts),
                # Pass through raw values too; merge layer overwrites with
                # model_registry.model_window or REFERENCE fallback.
                "_context_tokens": context_window,
                "_max_out_tokens": max_out_tokens,
            }
        )
    return rows


async def pi_models(configured_default: str = "") -> list[dict]:
    """Assemble the pi model dropdown.

    Combines ``advertised_pi_models()`` (live ``pi --list-models``) with
    the static ``acp`` provider rows from ``model_registry``. The
    picker returns this list directly under
    ``KIROCREW_ACP_BACKEND=pi``.

    Parity with ``_cc_models`` in ``agents.py``:
    - When the backend advertises nothing (cold start, broken subprocess),
      return the static catalog enriched with windows.
    - When the backend advertises something, merge advertised + registry
      and dedupe by normalized key so we never show two rows for the
      same model.
    - The ``auto`` sentinel is always present and always first.
    - ``configured_default`` (typically ``config.agent.model``) is
      inserted if missing so the user's stored selection never silently
      vanishes when the live subprocess returns a partial set.
    """
    # Lazy import to avoid a module-load cycle (this module owns the
    # canonical parser; the runtime module owns the subprocess function).
    import kiro_crew.dashboard.handlers.pi_models_runtime as _rt_module
    # Capture the function reference (not the result!) so we can await it
    # below — advertised_pi_models is a coroutine function.
    _advertised_fn = _rt_module.advertised_pi_models
    advertised = await _advertised_fn()

    def _enrich(rows: list[dict]) -> list[dict]:
        """Strip parser-internal fields and set context_window.

        The parser uses underscore-prefixed fields (``_context_tokens``)
        for hints; the merge layer always resolves ``context_window``
        via the registry first, then REFERENCE fallback.
        """
        out: list[dict] = []
        for row in rows:
            clean = {k: v for k, v in row.items() if not k.startswith("_")}
            name = clean.get("model_name", "")
            clean["context_window"] = (
                model_registry.model_window(name)
                or model_registry.REFERENCE_WINDOW_TOKENS
            )
            out.append(clean)
        return out

    registry_rows = model_registry.display_list("acp")
    enriched_registry = _enrich(registry_rows)

    if not advertised:
        return _insert_auto_and_default(enriched_registry, configured_default)

    enriched_advertised = _enrich(advertised)

    # Dedup by normalized key, registry preferred (richer display metadata).
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
