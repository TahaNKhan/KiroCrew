# Phase 02 — pi Models + Picker

**Status:** planning
**Branch:** TBD (proposed: `feature/pi-models-picker`)
**Push policy:** after each gate

## One-line summary

Make KiroCrew's `/api/models` endpoint dispatch on `KIROCREW_ACP_BACKEND` so
the dashboard's model picker works when pi is the active backend, and pi
models appear alongside the registry-curated rows.

## Background

- `/api/models` (in `src/kiro_crew/dashboard/handlers/agents.py:774`) currently
  shells out to `kiro-cli chat --list-models --format json --no-interactive`.
- That command does not exist on pi. pi provides `pi list-models`, which
  emits a **markdown table**, not JSON.
- The picker UI (`website/src/components/ChatInput.tsx`) already reads
  `/api/models` and renders the result — **no UI changes needed**.
- The merge logic (`_cc_models` at `agents.py:678`) takes a list of
  "advertised" models from a live session and intersects with the static
  registry. For pi we need a parallel `_advertised_pi_models()` that
  shells `pi list-models` and parses the markdown.

## Pi list-models output shape (verified)

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
- ...
```

Format: `**Provider**` headers followed by `- \`model-id\` [(current) | *(thinking)*]` lines.
No context window info; needs registry lookup or fallback.

## Goals

1. `GET /api/models` returns pi's advertised model list when `KIROCREW_ACP_BACKEND=pi`.
2. Picker dropdown works end-to-end: user selects a pi model → it persists to slot config → `set_config_option("model", X)` is sent on next prompt.
3. `context_window` field populated for every row (registry lookup or `REFERENCE_WINDOW_TOKENS` fallback).
4. Existing kiro-cli path unchanged; pi is additive.

## Out of scope

- Adding new models to `model_registry.json` (the static catalog). Out of scope
  because pi's catalog is large and dynamic; advertise-and-display is the
  pragmatic path. Registry enrichment is a separate concern.
- A `GET /api/pi/models` debug-only endpoint. The unified `/api/models`
  is enough.
- Per-model capability flagging (`image: true`, `thinking` from pi's
  `*(thinking)*` suffix). Forward-compat — pass through as raw text.
- Authentication/credential flows. `pi list-models` only requires a
  configured provider key, which is already handled by pi's auth.

## Phase files
- `requirements.md` — exact wire shape + acceptance criteria
- `design.md` — markdown parser, merge strategy, fallback policy
- `TASKS.md` — workgroup table for parallel dispatch
