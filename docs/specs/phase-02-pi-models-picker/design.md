# Design — pi Models + Picker

## Package layout

No new package — this is an additive change to one file:

```
src/kiro_crew/dashboard/handlers/
  agents.py           # add _advertised_pi_models() + dispatcher in api_models()

test/
  test_parse_pi_models_markdown.py    # new: pure unit tests for the markdown parser
  test_pi_models_handler.py            # new: subprocess + 503 path coverage
```

## Frontend

**No changes.** `website/src/components/ChatInput.tsx` already renders
whatever `/api/models` returns. The merge/filter logic in `api_models` already
normalizes rows to `{model_name, display_name, description, context_window}`.
pi rows just need to fit that shape.

## Module: `_advertised_pi_models()`

A new helper, parallel to `_advertised_cc_models()`:

```python
def _advertised_pi_models() -> list[dict]:
    """Shell `pi list-models`, parse markdown, return rows in API shape.

    Runs in the asyncio executor because the subprocess can take up to 10s
    (matching the kiro-cli timeout). Returns [] on any failure so the
    caller treats pi as 'no advertised set', which triggers the
    full-registry fallback in _pi_models().
    """
```

### Subprocess sandbox (mirror `api_models` kiro-cli path)

```python
argv = ["pi", "list-models"]
argv, cleanup = wrap_argv(argv)
argv = cgroup_scope_argv(argv)
env = {**os.environ}
env["PATH"] = augmented_path(env.get("PATH", ""))
proc = await create_subprocess_limited(
    *argv, stdout=asyncio.subprocess.PIPE,
    stderr=asyncio.subprocess.PIPE, env=env,
)
try:
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
except asyncio.TimeoutError:
    proc.kill(); ...
```

Failure modes (binary missing, exit nonzero, empty stdout, timeout) all
return `[]` — same degradation contract as `_advertised_cc_models`.

### Markdown parser

`pi list-models` output structure (verified):

```
Available models:

**Bifrost**
- `GLM/glm-4.5`
- `GLM/glm-4.5-air`
- ...
- `Minimax/MiniMax-M3` **(current)**
- `opencode-go/deepseek-v4-pro` *(thinking)*

**Claude CLI**
- `claude-fable-5`
- `claude-opus-4-8`
```

Grammar (regex is fine — these lines are stable across pi versions):

- Provider header: `^\*\*(?P<provider>[^*]+)\*\*$`
- Model line: `^- ` (?P<model_id> `[A-Za-z0-9_./-]+` `)(?P<suffix>.*)?$`

Suffix tokens observed:
- `**(current)**` — the active model. Surface as `description` `"Active model"`.
- `*(thinking)*` — the model supports extended thinking. Surface as
  `description` `"Thinking"`.

```python
def _parse_pi_list_models(text: str) -> list[dict]:
    """Parse `pi list-models` markdown into the API row shape.

    Robust to extra whitespace, blank lines, and trailing footer text
    (the 'Use Ctrl+P ...' or 'launch with ...' block). Returns rows in
    the order pi listed them; the merge layer sorts by canonical key.
    """
    provider = None
    rows: list[dict] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        m_header = re.match(r"^\*\*(?P<p>[^*]+)\*\*$", line)
        if m_header:
            provider = m_header.group("p").strip()
            continue
        # Stop at the trailing footer block (markdown code fence or
        # "Use `Ctrl+P`" prose — neither is a provider header, but a
        # `bash`-fenced code block would otherwise dump into a row).
        if line.startswith("```"):
            break
        m_row = re.match(r"^- `(?P<id>[^`]+)`(?:\s*(?P<suf>.*))?$", line)
        if not m_row:
            continue
        model_id = m_row.group("id")
        suffix = (m_row.group("suf") or "").strip()
        description_parts = []
        if "current" in suffix:
            description_parts.append("Active model")
        if "thinking" in suffix:
            description_parts.append("Thinking")
        if provider:
            description_parts.append(f"via {provider}")
        rows.append({
            "model_name": model_id,
            "display_name": model_id,
            "description": " · ".join(description_parts),
        })
    return rows
```

### `context_window` enrichment

`pi list-models` doesn't emit context window sizes (unlike kiro-cli's JSON).
We have two sources:

1. **`model_registry.model_window(model_id)`** — returns the central authority's
   number. Already wired into the existing merge logic.
2. **A new mapping for pi-specific models** (GLM, MiniMax, Qwen, etc.) —
   could be added to `model_registry.json` under a new provider section, but
   that's a bigger surface change. For Phase 02, default to
   `REFERENCE_WINDOW_TOKENS` (1M) for any model not in the registry.

```python
# inside _pi_models() after parsing
for row in rows:
    if "context_window" not in row:
        row["context_window"] = (
            model_registry.model_window(row["model_name"])
            or model_registry.REFERENCE_WINDOW_TOKENS
        )
```

## Module: `_pi_models()` and dispatch in `api_models()`

```python
def _pi_models(configured_default: str = "") -> list[dict]:
    """Assemble the pi model dropdown.

    Same shape as _cc_models(): advertised rows (live subprocess) merged
    with registry rows (filtered to advertised names when present). Pi has
    no per-account entitlement — `pi list-models` returns the FULL
    configured catalog regardless of subscription — so the merge does
    not filter the registry by advertised. It still de-dupes by name.
    """
    advertised = _advertised_pi_models()
    # Registry rows: include the 'acp' provider's kiro-cli rows because
    # the picker used to ship them, and they're still selectable when
    # pi has no opinion on a model (e.g. a kiro-cli model name that's
    # also a valid pi model id).
    registry_rows = model_registry.display_list("acp")

    if not advertised:
        # Cold start: show the static catalog unfiltered (matches
        # the kiro-cli "no advertised yet" behavior).
        return _enrich_with_windows(registry_rows, configured_default)

    merged = []
    seen: set[str] = set()
    for entry in (*registry_rows, *advertised):
        name = entry.get("model_name", "")
        key = _normalize_model_key(name)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(entry)
    # "auto" sentinel at the top, same as _cc_models.
    merged = sorted(merged, key=lambda e: (
        _normalize_model_key(e.get("model_name", "")) != "auto",
        _normalize_model_key(e.get("model_name", "")).lower(),
    ))
    # configured-default insertion (same logic as _cc_models)
    ...
    return _enrich_with_windows(merged, configured_default)
```

Then `api_models()` dispatches:

```python
async def api_models(request):
    blocked = await reject_if_kiro_unverified(request)
    if blocked is not None:
        return blocked
    backend = os.environ.get("KIROCREW_ACP_BACKEND", "").lower().strip()
    configured_default = ""
    # Resolve configured default the same way the existing handler does
    # (read from config.agent.model — see the existing api_models body).
    if backend == "pi":
        configured_default = ...  # read from config.agent.model
        rows = await asyncio.get_running_loop().run_in_executor(
            maintenance_executor(),
            _pi_models,
            configured_default,
        )
        return web.json_response(rows)
    elif backend == "claude":
        return web.json_response(_cc_models(request, configured_default))
    else:
        # Default: kiro-cli subprocess path (existing code, untouched).
        return await _api_models_kiro_subprocess(...)
```

The existing kiro-cli subprocess body is **extracted unchanged** into
`_api_models_kiro_subprocess()` so the new dispatch is the only diff.
Tests for that path stay green.

## Test design

`test/test_parse_pi_models_markdown.py` — pure unit tests:

```python
SAMPLE = """\
Available models:

**Bifrost**
- `GLM/glm-4.5`
- `Minimax/MiniMax-M3` **(current)**
- `opencode-go/deepseek-v4-pro` *(thinking)*

**Claude CLI**
- `claude-opus-4-8`

Use `Ctrl+P` to cycle configured models, or launch with:

```bash
pi --model foo
```
"""

def test_parses_all_models():
    rows = _parse_pi_list_models(SAMPLE)
    assert len(rows) == 4
    assert rows[0]["model_name"] == "GLM/glm-4.5"
    assert "via Bifrost" in rows[0]["description"]
    assert "Active model" in rows[1]["description"]
    assert "via Bifrost" in rows[1]["description"] and "Thinking" in rows[1]["description"]
    assert rows[3]["model_name"] == "claude-opus-4-8"
    # trailing code fence is NOT a model line

def test_handles_empty():
    assert _parse_pi_list_models("") == []
    assert _parse_pi_list_models("Available models:\n") == []

def test_handles_malformed():
    # random prose between provider blocks
    text = "**Bifrost**\n- `model-a`\nblah blah\n**Claude**\n- `model-b`"
    rows = _parse_pi_list_models(text)
    assert [r["model_name"] for r in rows] == ["model-a", "model-b"]

def test_strips_trailing_footer():
    text = "**P**\n- `m1`\n```bash\necho hi\n```\n"
    assert _parse_pi_list_models(text) == [{"model_name": "m1", "display_name": "m1", "description": "via P"}]
```

`test/test_pi_models_handler.py` — uses an injected fake `subprocess_runner`
to assert:
- Success path returns rows with `context_window` set
- Binary missing → 503
- Subprocess timeout → 503
- Empty stdout → 503
- Nonzero exit → 503
- Markdown parse failure → 503
- Env var toggle: `KIROCREW_ACP_BACKEND=pi` → `_pi_models`; unset → kiro-cli path

## Mapping to existing code

| New code | Existing pattern |
|---|---|
| `_advertised_pi_models()` | `_advertised_cc_models()` (`agents.py:627`) — same shape, different subprocess |
| `_pi_models()` | `_cc_models()` (`agents.py:678`) — same merge/filter/enrich |
| Markdown parser (`_parse_pi_list_models`) | new, but follows `_normalize_model_key` / `is_deprecated_model` style |
| Dispatch in `api_models()` | the existing handler body is the `else` branch (kiro-cli), kept verbatim |

## Acceptance evidence

Run after gate-merge:

```bash
# Confirm kiro-cli path still works:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5476/api/models | jq 'length'

# Switch to pi:
KIROCREW_ACP_BACKEND=pi kirocrew gateway &
sleep 4
TOKEN=$(kirocrew token | tail -1 | sed 's|http://localhost:5476?token=||')
curl -s -b "mc_token_5476=$TOKEN" http://localhost:5476/api/models | jq '.[0]'
# -> { "model_name": "claude-opus-4-8", "display_name": "claude-opus-4-8", "description": "via Claude CLI", "context_window": 1000000 }
```
