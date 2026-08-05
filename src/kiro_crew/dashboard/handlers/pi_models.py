r"""Parse ``pi list-models`` markdown output into API row records.

Pi's ``list-models`` command emits a markdown table of providers and
their model ids, plus a trailing footer (markdown code fence or
"Use ``Ctrl+P``" prose). The shape is stable across pi versions — we
parse it with line-by-line regex matching.

The dispatcher at ``/api/models`` reads this when ``KIROCREW_ACP_BACKEND=pi``
is set. The resulting rows are merged with the static registry and
returned to the dashboard picker.

Field rules (see ``docs/specs/phase-02-pi-models-picker/design.md``
§"Markdown parser"):

- ``model_name``: bare id from backticks.
- ``display_name``: same as ``model_name`` — the picker uses one column.
- ``description``: ``" · "``-joined tokens:
  - ``"Active model"`` if ``(current)`` appears in the line suffix.
  - ``"Thinking"`` if ``thinking`` appears in the line suffix — the model
    id itself may contain ``-thinking`` (e.g. ``claude-opus-4-5-thinking``)
    and that does NOT count.
  - ``"via <Provider>"`` using the most recent ``**Provider**`` header.

Markdown grammar (with named captures):
- Provider header: ``^\*\*(?P<p>[^*]+)\*\*$``
- Model line: ``^- `(?P<id>[^`]+)`(?:\s*(?P<suf>.*))?$``

Footer handling: stop parsing at any line starting with three backticks
(```` ``` ```) — the trailing ```` ```bash ... ``` ``` block is a usage
hint, not a model line. Whitespace-only lines are skipped.
"""

from __future__ import annotations

import re

# Provider header: a line that is exactly `**Foo**` (no other text).
# Names like `Bifrost`, `Claude CLI`, `opencode-go` all match.
_PROVIDER_RE = re.compile(r"^\*\*(?P<p>[^*]+)\*\*$")

# Model line: `- `id`` (with optional trailing suffix tokens).
# Group "id" captures everything inside the backticks; group "suf"
# captures everything after the closing backtick (whitespace + tokens).
_MODEL_RE = re.compile(r"^- `(?P<id>[^`]+)`(?:\s*(?P<suf>.*))?$")


def parse_pi_list_models(text: str) -> list[dict]:
    """Parse ``pi list-models`` markdown output into API row records.

    Returns one record per model:
    ``{"model_name": <id>, "display_name": <id>, "description": <tokens>}``.

    Robust to extra whitespace, blank lines, and trailing footer text
    (markdown code fences or "Use Ctrl+P ..." prose). Returns ``[]`` on
    empty input.
    """
    if not text or not text.strip():
        return []

    rows: list[dict] = []
    provider: str | None = None
    for raw_line in text.splitlines():
        line = raw_line.strip()

        # Blank lines: ignore.
        if not line:
            continue

        # Trailing footer gate: a markdown code fence ends model emission.
        # The trailing usage hint uses ```bash ... ``` which would otherwise
        # dump a row through the model regex (the backtick-id regex requires
        # only `id` inside backticks — `bash` would not match, but a
        # forward-compat footer that did is best rejected here).
        if line.startswith("```"):
            break

        # Provider header?
        m_provider = _PROVIDER_RE.match(line)
        if m_provider:
            provider = m_provider.group("p").strip()
            continue

        # Model line?
        m_model = _MODEL_RE.match(line)
        if not m_model:
            continue

        model_id = m_model.group("id")
        suffix = m_model.group("suf") or ""

        description_parts: list[str] = []
        if "current" in suffix:
            description_parts.append("Active model")
        # The model's own name may contain the substring "thinking"
        # (e.g. `claude-opus-4-5-thinking`); only the suffix `*(thinking)*`
        # marks it as a thinking-capable model in pi's output.
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
