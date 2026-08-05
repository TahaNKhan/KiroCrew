"""Unit tests for ``parse_pi_list_models``.

Phase-02 T01. Covers the live ``pi list-models`` output shape (captured
during scoping) plus the corner cases that the design doc called out
(empty input, trailing code-fence footer, random prose between
providers, a model id that already contains ``-thinking``).
"""

from __future__ import annotations

import pytest

from kiro_crew.dashboard.handlers.pi_models import parse_pi_list_models

SAMPLE = """\
Available models:

**Bifrost**
- `GLM/glm-4.5`
- `Minimax/MiniMax-M3` **(current)**
- `opencode-go/deepseek-v4-pro` *(thinking)*

**Claude CLI**
- `claude-fable-5`
- `claude-opus-4-8`

Use `Ctrl+P` to cycle configured models, or launch with:

```bash
pi --model foo
```
"""


def test_parses_all_models():
    rows = parse_pi_list_models(SAMPLE)
    ids = [r["model_name"] for r in rows]
    assert ids == [
        "GLM/glm-4.5",
        "Minimax/MiniMax-M3",
        "opencode-go/deepseek-v4-pro",
        "claude-fable-5",
        "claude-opus-4-8",
    ]
    assert len(rows) == 5


def test_current_token():
    rows = parse_pi_list_models(SAMPLE)
    m3 = next(r for r in rows if r["model_name"] == "Minimax/MiniMax-M3")
    # Active model + via Bifrost, joined by " · "
    assert m3["description"] == "Active model · via Bifrost"
    assert m3["display_name"] == "Minimax/MiniMax-M3"


def test_thinking_token():
    rows = parse_pi_list_models(SAMPLE)
    deepseek = next(r for r in rows if r["model_name"] == "opencode-go/deepseek-v4-pro")
    # Suffix is "*(thinking)*" — must produce the Thinking token.
    assert "Thinking" in deepseek["description"]
    assert "via Bifrost" in deepseek["description"]


def test_provider_change():
    rows = parse_pi_list_models(SAMPLE)
    fable = next(r for r in rows if r["model_name"] == "claude-fable-5")
    # Provider context switches at the **Claude CLI** header.
    assert fable["description"] == "via Claude CLI"
    opus = next(r for r in rows if r["model_name"] == "claude-opus-4-8")
    assert opus["description"] == "via Claude CLI"


def test_strips_trailing_footer():
    """The trailing ```bash ... ``` block is footer, not a model line."""
    rows = parse_pi_list_models(SAMPLE)
    # Last row must be the last ACTUAL model, not anything from the code
    # fence (e.g. a stray backtick-stripped "bash" or "foo").
    assert rows[-1]["model_name"] == "claude-opus-4-8"
    # No row should contain "bash" or "foo" — those are footer text.
    for row in rows:
        assert "bash" not in row["model_name"]
        assert "foo" not in row["model_name"]


def test_handles_empty():
    assert parse_pi_list_models("") == []


def test_handles_whitespace_only():
    assert parse_pi_list_models("Available models:\n") == []


def test_handles_malformed():
    """Random prose between provider blocks is skipped, not raised."""
    text = (
        "**Bifrost**\n"
        "- `model-a`\n"
        "blah blah random prose\n"
        "**Claude**\n"
        "- `model-b`\n"
    )
    rows = parse_pi_list_models(text)
    assert [r["model_name"] for r in rows] == ["model-a", "model-b"]
    assert rows[0]["description"] == "via Bifrost"
    assert rows[1]["description"] == "via Claude"


def test_model_id_with_thinking_substring_is_not_marked_thinking():
    """A model id like `claude-opus-4-5-thinking` does NOT trigger the
    Thinking token — only the line suffix `*(thinking)*` does."""
    text = "**P**\n- `claude-opus-4-5-thinking`\n"
    rows = parse_pi_list_models(text)
    assert rows[0]["description"] == "via P"
    assert "Thinking" not in rows[0]["description"]


def test_combined_current_and_thinking_suffix():
    """If pi emits BOTH `(current)` and `*(thinking)*` on the same line,
    both tokens appear, in that order, joined by ' · '."""
    text = "**P**\n- `model-x` **(current)** *(thinking)*\n"
    rows = parse_pi_list_models(text)
    assert rows[0]["description"] == "Active model · Thinking · via P"


def test_provider_with_special_chars_in_name():
    """Provider names may contain spaces, slashes, hyphens, etc."""
    text = (
        "**Pi-Claude-CLI (v0.80.4)**\n"
        "- `claude-opus-4-8`\n"
        "**OpenCode-Go/Pro**\n"
        "- `model-z`\n"
    )
    rows = parse_pi_list_models(text)
    assert rows[0]["description"] == "via Pi-Claude-CLI (v0.80.4)"
    assert rows[1]["description"] == "via OpenCode-Go/Pro"


def test_no_provider_means_empty_provider_token():
    """If a model line appears before any `**Provider**` header, the
    'via X' token is omitted (provider is None). No crash."""
    text = "- `orphan-model`\n"
    rows = parse_pi_list_models(text)
    assert rows == [
        {"model_name": "orphan-model", "display_name": "orphan-model", "description": ""}
    ]
