"""Tests for the ``pi --list-models`` output parser.

Pi's CLI emits a fixed-column table (the markdown ``**Provider**`` bullet list
documented in the original design is gone). The shape we parse (verified
against the running binary):

```
provider       model                           context  max-out  thinking  images
bifrost        GLM/glm-4.5                     131.1K   8.2K     no        no
...
```

Columns are separated by 2+ spaces; we split on that.
"""

from __future__ import annotations

import pytest

from kiro_crew.dashboard.handlers.pi_models import (
    _looks_like_data_row,
    _parse_size,
    parse_pi_list_models,
)

SAMPLE = """\
Available models:

provider       model                           context  max-out  thinking  images
bifrost        GLM/glm-4.5                     131.1K   8.2K     no        no
bifrost        GLM/glm-4.5-air                 131.1K   8.2K     no        no
bifrost        MinimaX/Minimax-M3              1.0M     32.8K    no        no
opencode-go    opencode-go/deepseek-v4-pro     1.0M     65.5K    yes       no
pi-claude-cli  claude-opus-4-8                 1.0M     128K     yes       yes
pi-claude-cli  claude-haiku-4-5                1.0M     64K      no        no

Use Ctrl+P to cycle configured models, or launch with: pi --model foo
"""


def test_parses_all_data_rows():
    names = {r["model_name"] for r in parse_pi_list_models(SAMPLE)}
    assert names == {
        "GLM/glm-4.5",
        "GLM/glm-4.5-air",
        "MinimaX/Minimax-M3",
        "opencode-go/deepseek-v4-pro",
        "claude-opus-4-8",
        "claude-haiku-4-5",
    }


def test_provider_carried_via_description():
    rows = {r["model_name"]: r for r in parse_pi_list_models(SAMPLE)}
    assert rows["GLM/glm-4.5"]["description"] == "via bifrost"
    assert rows["opencode-go/deepseek-v4-pro"]["description"] == "via opencode-go · Thinking"
    assert rows["claude-opus-4-8"]["description"] == "via pi-claude-cli · Thinking"
    assert rows["claude-haiku-4-5"]["description"] == "via pi-claude-cli"


def test_thinking_flag_sets_description_token():
    rows = {r["model_name"]: r for r in parse_pi_list_models(SAMPLE)}
    assert "Thinking" in rows["opencode-go/deepseek-v4-pro"]["description"]
    assert "Thinking" not in rows["GLM/glm-4.5"]["description"]
    assert "Thinking" not in rows["claude-haiku-4-5"]["description"]


def test_banner_and_footer_skipped():
    rows = parse_pi_list_models(SAMPLE)
    for r in rows:
        assert r["model_name"] not in {"provider", "model", "context",
                                         "max-out", "thinking", "images"}
    assert len(rows) == 6


def test_handles_empty():
    assert parse_pi_list_models("") == []


def test_handles_whitespace_only():
    assert parse_pi_list_models("   \n  \n") == []


def test_handles_malformed_no_crash():
    text = (
        "provider       model          context  max-out  thinking  images\n"
        "this is just prose with no size tokens\n"
        "bifrost        GLM/glm-4.5    131.1K   8.2K     no        no\n"
    )
    rows = parse_pi_list_models(text)
    assert len(rows) == 1
    assert rows[0]["model_name"] == "GLM/glm-4.5"


def test_handles_short_text():
    assert parse_pi_list_models("just one line") == []


# Size parser
def test_parse_size_units():
    assert _parse_size("131.1K") == int(131.1 * 1024)
    assert _parse_size("1M") == 1024 * 1024
    assert _parse_size("128K") == 128 * 1024
    assert _parse_size("") == 0
    assert _parse_size("abc") == 0


# Heuristic
def test_looks_like_data_row_rejects_header():
    """Header row has column names, NOT sizes. Must be rejected so the
    parser doesn't emit a fake 'model=model, provider=provider' row."""
    header_tokens = ["provider", "model", "context", "max-out", "thinking", "images"]
    assert _looks_like_data_row(header_tokens) is False


def test_looks_like_data_row_recognizes_data():
    assert _looks_like_data_row(
        ["bifrost", "GLM/glm-4.5", "131.1K", "8.2K", "no", "no"]
    ) is True


def test_looks_like_data_row_rejects_short():
    assert _looks_like_data_row(["model"]) is False
    assert _looks_like_data_row([]) is False


def test_looks_like_data_row_rejects_two_columns():
    """Data rows always have provider + model + size (≥3 cols)."""
    assert _looks_like_data_row(["bifrost", "GLM/glm-4.5"]) is False
