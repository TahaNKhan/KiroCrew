# Requirements — pi Models + Picker

## Functional

- **FR-01** `GET /api/models` returns a JSON array of `{model_name, display_name,
  description, context_window, provider?}` records when the active backend is
  pi (`KIROCREW_ACP_BACKEND=pi`).
- **FR-02** The default backend (kiro-cli) path is unchanged. Existing tests /
  behavior for kiro-cli picker remain green.
- **FR-03** The pi-path shells `pi list-models`, parses its markdown output into
  the same shape the kiro-cli path produces, and filters out the same set of
  deprecated models the kiro-cli path filters.
- **FR-04** Each row's `context_window` is set to either:
  (a) a value from `model_registry.json` if a matching canonical key exists, or
  (b) `model_registry.REFERENCE_WINDOW_TOKENS` (1M) as the safe default.
  Never `None`, never silent 200k.
- **FR-05** The dispatch on `KIROCREW_ACP_BACKEND` is read at request time, not
  cached. Operators can flip the env var, restart the gateway, and the picker
  reflects the new backend on the next poll (8s).
- **FR-06** All four `_kiro_*` failure paths (binary not resolved, subprocess
  timeout, non-zero exit, invalid JSON/parse output) return 503 with the same
  "degraded, retry" semantics the kiro-cli path uses. The dashboard polls every
  8s; never cache an empty list.
- **FR-07** Pi's model id format is preserved as-is (e.g.
  `Minimax/MiniMax-M3`, `claude-opus-4-8`). The wire-format guards in
  `api_chat_slot_model` already accept any string.

## Non-functional

- **NFR-01** `pi list-models` invocation mirrors the sandbox posture of the
  existing kiro-cli path: `wrap_argv`, `cgroup_scope_argv`, augmented PATH,
  SSH_AUTH_SOCK resolution, 10s subprocess timeout.
- **NFR-02** Parsing is local (no network). The subprocess timeout (10s)
  bounds total latency to a known ceiling.
- **NFR-03** Existing kiro-cli behavior is preserved byte-for-byte. This phase
  is purely additive — adding pi backend support to `/api/models`.

## Test harness

- **Existing:** `pytest` (Makefile target `make test`). New tests live in
  `test/test_pi_models_handler.py`.
- **Parser tests:** `test/test_parse_pi_models_markdown.py` — pure unit tests
  for the markdown parser with fixtures of the real `pi list-models` output.

## Verification command

```bash
cd /home/taha/projects/KiroCrew
make test                 # full pytest suite
# Or targeted:
pytest -q test/test_parse_pi_models_markdown.py
pytest -q test/test_pi_models_handler.py
```

## Acceptance criteria (phase-level)

1. With `KIROCREW_ACP_BACKEND=pi`:
   - `GET /api/models` returns a list with at least one pi model (e.g. `claude-opus-4-8`, `Minimax/MiniMax-M3`).
   - Each row has a non-null `context_window`.
   - Selecting a model in the dashboard persists it to the slot; subsequent
     `POST /api/chat` sends `set_config_option("model", X)` via the existing
     path.
2. With default backend (unset env var):
   - `GET /api/models` returns kiro-cli's list (no behavior change).
3. Both paths return 503 (not 200 with []) on any failure, so the picker
   self-heals via the existing 8s poll.

## Mapping

| Feature | FR/NFR |
|---|---|
| Parse `pi list-models` markdown | FR-03, NFR-01 |
| Dispatch `/api/models` on env var | FR-01, FR-02, FR-05 |
| `context_window` fallback | FR-04 |
| Failure modes return 503 | FR-06, NFR-02 |
| Existing tests stay green | NFR-03 |
