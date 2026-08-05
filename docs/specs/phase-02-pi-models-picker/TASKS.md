# TASKS — phase-02-pi-models-picker

## Dependency table

```
T01 (parser) ──┐
               ├──► T02 (_pi_models merge + window enrichment) ──► T03 (api_models dispatcher) ──► T04 (handler tests)
T05 (503 paths)┘
                                                                                                  ▲
                                                                                                  │
                                                                  T06 (live verification) ────────┘
```

## Parallel workgroups

| Gate | Tasks | Gate is satisfied when… | Files touched (disjoint) |
|---|---|---|---|
| **G1** | T01, T05 | parser works on fixtures + 503 paths return correctly | T01: `src/kiro_crew/dashboard/handlers/pi_models.py` (new), `test/test_parse_pi_models_markdown.py` (new) · T05: `src/kiro_crew/dashboard/handlers/pi_models.py` (continues), `test/test_pi_models_handler.py` (new) |
| **G2** | T02 | merge function passes unit tests + enriches context_window | T02: extends `src/kiro_crew/dashboard/handlers/pi_models.py`, `test/test_pi_models_handler.py` (continues) |
| **G3** | T03 | `api_models()` dispatches on env var, kiro-cli path unchanged | T03: `src/kiro_crew/dashboard/handlers/agents.py` (only) |
| **G4** | T06 | live verification with `KIROCREW_ACP_BACKEND=pi` set | no source changes — verification only |

Critical path: G1 → G2 → G3 → G4.

---

## Tasks

### T01 — Markdown parser for `pi list-models`

- **Description:** Implement `src/kiro_crew/dashboard/handlers/pi_models.py`
  with `_parse_pi_list_models(text: str) -> list[dict]`. Per the design
  doc, parse `**Provider**` headers and `- \`id\` [suffix]` lines into the
  API row shape. Strip trailing footer (markdown code fences, "Use
  Ctrl+P" prose). Surface `(current)` and `*(thinking)*` as description
  tokens prefixed with the provider name.
- **Maps to:** FR-03, FR-04.
- **Maps to design:** §"Markdown parser".
- **Acceptance criteria:**
  - [ ] Parses the live `pi list-models` output captured in the design doc
    (16+ models, 2 providers) into a list of `{model_name, display_name,
    description}` records.
  - [ ] Trailing `\`\`\`bash ... \`\`\`` footer is NOT parsed as a model line.
  - [ ] Empty / whitespace-only input returns `[]`.
  - [ ] Malformed lines (e.g. random prose between providers) are skipped,
    not raised.
  - [ ] All 5 parser unit tests in `test_parse_pi_models_markdown.py` pass.
- **Dependencies:** none.
- **Estimate:** ~1 hr.
- **Status:** todo

### T05 — `_advertised_pi_models()` with 503 paths

- **Description:** In the same new module, implement the subprocess shell +
  parser invocation. All five failure modes return `[]` (not raise):
  binary missing, subprocess timeout (10s), exit nonzero, empty stdout,
  parse failure. Mirror the existing kiro-cli subprocess sandbox posture
  (wrap_argv, cgroup_scope_argv, augmented PATH, SSH_AUTH_SOCK). Append
  rows with `context_window` from registry or `REFERENCE_WINDOW_TOKENS`.
- **Maps to:** FR-01, FR-03, FR-04, FR-06, NFR-01, NFR-02.
- **Maps to design:** §"Module: `_advertised_pi_models()`" + §"`context_window` enrichment".
- **Acceptance criteria:**
  - [ ] Calls `pi list-models` with the documented sandbox.
  - [ ] On any failure returns `[]`, never raises (the caller handles `[]`
    as "use the static catalog").
  - [ ] On success, returns rows with `context_window` set to a positive
    integer for every row.
  - [ ] Six 503-path unit tests (binary missing, timeout, exit nonzero,
    empty stdout, malformed output, parse exception) all pass.
- **Dependencies:** T01 (uses the parser).
- **Estimate:** ~1 hr.
- **Status:** todo

### T02 — `_pi_models()` merge + configured-default + enrichment

- **Description:** Build the public `_pi_models(configured_default: str)`
  function in the same module. Merges advertised + registry rows,
  dedupes by normalized key, inserts `auto` sentinel first, inserts the
  configured default if not already present (same logic as `_cc_models`),
  enriches every row with `context_window` via the central authority.
- **Maps to:** FR-01, FR-04, FR-07.
- **Maps to design:** §"Module: `_pi_models()` and dispatch".
- **Acceptance criteria:**
  - [ ] When advertised is empty, returns the static catalog enriched with
    windows (no filtering — matches the kiro-cli "cold start" branch).
  - [ ] When advertised is non-empty, merges advertised + registry rows,
    dedupes by normalized key.
  - [ ] The configured default is inserted if not present in either set
    and is non-empty.
  - [ ] `auto` is the first row when present.
  - [ ] Every row has a positive integer `context_window`.
- **Dependencies:** T01, T05.
- **Estimate:** ~1.5 hr.
- **Status:** todo

### T03 — Dispatch `api_models()` on `KIROCREW_ACP_BACKEND`

- **Description:** Modify `api_models()` in `agents.py` to dispatch on
  `os.environ.get("KIROCREW_ACP_BACKEND", "").lower().strip()`:
  - `"pi"` → run `_pi_models()` in the executor, return rows.
  - `"claude"` → existing `_cc_models(request, ...)` path.
  - `""` or anything else → existing kiro-cli subprocess path (extracted
    verbatim into `_api_models_kiro_subprocess()` so the new dispatcher is
    the only diff to the existing handler body).
- **Maps to:** FR-01, FR-02, FR-05, FR-06.
- **Acceptance criteria:**
  - [ ] With `KIROCREW_ACP_BACKEND=pi`, `GET /api/models` returns pi's list.
  - [ ] With `KIROCREW_ACP_BACKEND=claude`, `GET /api/models` returns claude's
    advertised + merged list (existing behavior).
  - [ ] With unset env var, returns kiro-cli's list (existing behavior).
  - [ ] The `reject_if_kiro_unverified(request)` guard still runs first
    (defense-in-depth).
  - [ ] Existing test suite (`make test`) still passes — zero regressions.
- **Dependencies:** T02.
- **Estimate:** ~1 hr.
- **Status:** todo

### T06 — Live verification

- **Description:** Boot the gateway with `KIROCREW_ACP_BACKEND=pi`,
  call `GET /api/models` via the actual token, confirm rows are returned
  with `context_window` populated. Switch back to default and confirm
  kiro-cli behavior unchanged.
- **Maps to:** All FRs (acceptance evidence).
- **Acceptance criteria:**
  - [ ] `KIROCREW_ACP_BACKEND=pi kirocrew gateway` → `/api/models` returns ≥ 1
    pi model with a non-null `context_window`.
  - [ ] Unset env var → same endpoint returns kiro-cli's list.
  - [ ] No errors in `kiro_crew.dashboard.handlers.agents.api_models`
    logging at WARN level or above.
- **Dependencies:** T03 merged.
- **Estimate:** ~30 min.
- **Status:** todo

## Out-of-scope tasks (deferred)

- **T-deferred-A**: Add pi models to `model_registry.json` (canonical names,
  context windows, display strings). Today we rely on `REFERENCE_WINDOW_TOKENS`
  fallback. Worth doing once we know which pi models are actually used.
- **T-deferred-B**: Per-model capability flags (image / thinking) surfaced
  to the picker UI. Pi emits `*(thinking)*` suffixes today; we capture them
  in `description` prose but don't expose structured fields. The frontend
  picker doesn't use them yet.
- **T-deferred-C**: A separate `GET /api/pi/models` debug endpoint. Useful
  for poking at pi's catalog, but the unified `/api/models` already serves
  it when the env var is set.
