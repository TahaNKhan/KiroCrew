# pi-acp-server — Build Spec (assumption-free)

> **Purpose:** a single reference with every wire shape pinned to source, so
> building `pi-acp-server` is pure transcription. No design decisions remain.
> Pair with [`pi-acp-server.md`](./pi-acp-server.md) for phasing/effort.
>
> All shapes verified against KiroCrew `src/kiro_crew/acp/client.py` +
> `_dispatch.py` (commit at HEAD) and pi's compiled dist.

## 1. Transport

**Newline-delimited JSON-RPC 2.0, one object per `\n`, symmetric.**

- **Read** stdin line-by-line; each line is one JSON-RPC object. Parse with
  `JSON.parse(line.trim())`. Non-JSON lines must be ignored silently (the client
  does the same, `_dispatch.py` / `client.py:2606`).
- **Write** stdout: `JSON.stringify(msg) + "\n"` per message. Flush.
- **stderr** is captured for diagnostics only (`client.py:1954` `stderr.readline()`,
  redacted, shown on crash). Route ALL pi/adapter logging to stderr. **Never
  write non-JSON to stdout** — it's tolerated but pollutes the stream.

## 2. Inbound methods the server MUST handle

All from `client.py` constants. The server receives these as JSON-RPC **requests**
(with `id`) or **notifications** (no `id`).

### 2.1 `initialize` (request) → respond with result

KiroCrew sends (`client.py:2272`):
```jsonc
{
  "jsonrpc": "2.0", "id": <n>,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,                          // INTEGER — pi uses 1, not "2025-08-22"
    "clientInfo": {"name": "kirocrew", "version": "0.1.2"},
    "clientCapabilities": {
      "fs": {"readTextFile": false, "writeTextFile": false},
      "terminal": false,
      "elicitation": {"form": {}, "url": {}}
    }
  }
}
```

Server responds:
```jsonc
{
  "jsonrpc": "2.0", "id": <n>,
  "result": {
    "protocolVersion": 1,
    "agentCapabilities": {
      "loadSession": false                        // CRITICAL: makes client skip session/load (client.py:2282)
    },
    "modes": [{"modeId": "pi", "name": "Pi"}],    // only feeds dashboard dropdown
    "configOptions": [                            // advertised selectors
      {"id": "model", "options": [/* model ids pi supports, {value, label} */]}
    ]
  }
}
```

### 2.2 `session/new` (request) → respond with result

KiroCrew sends `params`: `{cwd: <path>, mcpServers: [...]}` (Phase 1: ignore
`mcpServers`). Server creates a pi `AgentSession` (via `createAgentSession` +
`ModelRuntime.create()`) and responds:
```jsonc
{"jsonrpc":"2.0","id":<n>,"result":{
  "sessionId": "<uuid>",
  "modes": [{"modeId":"pi","name":"Pi"}]
}}
```
**If `sessionId` is missing, the client raises** (`client.py:2386`). Always
return one.

### 2.3 `session/set_mode` (request) → respond with empty result

**No-op for pi.** Client skips this on the claude path (`client.py:2400`); pi
does the same conceptually, but the client *will* send it on the pi path unless
you also skip — so accept it and respond `{result: {}}`. Do NOT error.

### 2.4 `session/set_model` (request) AND `session/set_config_option` (request)

Either may arrive. Both → set pi's model, respond `{result: {}}`.
`set_config_option` params: `{sessionId, configId: "model", option: <value>}`.

### 2.5 `session/prompt` (request) → stream notifications, THEN respond

**The core.** Params (`client.py` METHOD_PROMPT):
```jsonc
{"sessionId":"<sid>","messages":[{"role":"user","content":[{"type":"text","text":"..."}]}]}
```
Server must:
1. Feed the user text to the pi `AgentSession.prompt()`.
2. Stream `session/update` **notifications** (see §3) as pi emits events.
3. When the pi turn ends, **respond to the original request** (matching `id`) with:
```jsonc
{"jsonrpc":"2.0","id":<promptReqId>,"result":{"stopReason":"end_turn"}}
```
**`stopReason` values the client honors** (`client.py:3137`, `3260`): `"end_turn"`,
`"tool_use"`, `"cancelled"`, `"max_tokens"`, `"stop_sequence"`. Use `"end_turn"`
for normal completion. The response **only needs `stopReason`** — usage comes
from `usage_update` notifications.

### 2.6 `cancel` (notification, no `id`) → abort the pi turn

On cancel: call `session.abort()`. Resolve the in-flight prompt request (§2.5)
with `stopReason: "cancelled"`. `signal.aborted` fires inside pi's permission
hook automatically (verified `agent-loop.js:414`) — no special handling.

### 2.7 Unknown requests → respond with `-32601`

Any other server→client... wait, these are *client→server* requests the server
might not recognize. Respond:
```jsonc
{"jsonrpc":"2.0","id":<n>,"error":{"code":-32601,"message":"Method not found"}}
```
Never drop a request with an `id` (the client would hang waiting).

## 3. Outbound `session/update` notifications (server → client)

**Method:** `"session/update"`. **No `id`** (it's a notification). Discriminator
field is `params.update.sessionUpdate` (verified `_dispatch.py:262`).

### 3.1 Text chunk — from pi `text_delta`

```jsonc
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"<sid>",
  "update":{
    "sessionUpdate":"agent_message_chunk",        // EXACT string (_dispatch.py:47,267)
    "content":{"type":"text","text":"<delta text>"}   // nested under content (kiro 2.10 shape)
  }
}}
```
Parsed by `_dispatch.py:253 parse_text_chunk`. Accepts `content.text` OR top-level
`text` as fallback — use the nested `content` form.

### 3.2 Thinking chunk — from pi `thinking_delta`

Identical but `"sessionUpdate":"agent_thought_chunk"` and `content.type` may be
`"thinking"`/`"reasoning"` (`_dispatch.py:271`).

### 3.3 Tool call — when pi requests a tool (BEFORE permission)

Emitted by pi's `beforeToolCall` hook. Shape parsed by `_dispatch.py:_build_tool_call_event`:
```jsonc
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"<sid>",
  "update":{
    "sessionUpdate":"tool_call",                  // _dispatch.py:52
    "toolCallId":"<id>",
    "title":"<human-readable>",                   // tool name + short args
    "kind":"execute",                             // "execute" for bash/shell; "read"/"edit"/"write"/... otherwise
    "rawInput":{/* structured args dict */},      // ALSO used for governance; prefer over title
    "content":[]                                  // optional; diff blocks for edit tools: {"type":"diff","oldText":"","newText":"","path":""}
  }
}}
```
`rawInput` (aka `input`/`params`) is the **structured** args — cache it by
`toolCallId`; the permission request that follows carries only a truncated title.

### 3.4 Tool result — when the tool completes

Parsed by `_dispatch.py:610 _build_tool_result_event`. Two accepted shapes; emit
the `rawOutput` form on completion:
```jsonc
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"<sid>",
  "update":{
    "sessionUpdate":"tool_call_update",           // NOTE: tool_call_UPDATE, not tool_result
    "toolCallId":"<id>",
    "status":"completed",                         // marks tool_final
    "rawOutput":{"items":[{"Text":"<output>"}]}   // OR {"Json":{"stdout":"..."}}
  }
}}
```
> ⚠️ **Gotcha:** the `sessionUpdate` discriminator for tool *results* is
> `"tool_call_update"`, not a separate `tool_result` value. Mid-stream output
> uses the same discriminator with `content:[{content:{type:"text",text:"..."}}]`.

### 3.5 Usage (optional) — `usage_update`

```jsonc
{"jsonrpc":"2.0","method":"session/update","params":{
  "sessionId":"<sid>",
  "update":{
    "sessionUpdate":"usage_update",
    "size":1000000,                               // context window the backend is billing against — WINS over registry
    "inputTokens":1234,"outputTokens":567         // optional
  }
}}
```
If pi exposes token counts per turn, emit this. `size` is the **served context
window** — `model_window()` treats it as the highest-priority source. If pi
doesn't expose counts, omit; client falls back to the registry.

## 4. Outbound `session/request_permission` (server → client REQUEST, with `id`)

**The permission gate.** Emitted from pi's `on("tool_call")` async hook. This is
a JSON-RPC **request** (has `id`); the client will reply with a **response**
matching that `id`.

```jsonc
{"jsonrpc":"2.0","id":<permReqId>,                // OWN id counter, never reuse a prompt's id
 "method":"session/request_permission",
 "params":{
   "sessionId":"<sid>",
   "toolCall":{
     "toolCallId":"<id>",
     "title":"<human-readable>",
     "kind":"execute",                            // matches the tool_call update's kind
     "input":{/* structured args */}
   },
   "options":[                                    // optionId vocabulary (claude-agent-acp form)
     {"optionId":"allow_once","name":"Allow once","kind":"allow_once"},
     {"optionId":"allow_always","name":"Allow always","kind":"allow_always"},
     {"optionId":"reject_once","name":"Deny","kind":"reject_once"}
   ]
 }}
```
Parsed by `_dispatch.py:325 _build_permission_event`. The client reads `optionId`
+ `kind`; the `kind` lets it route approve vs reject cleanly.

**The client replies** (`client.py:approve_tool` / `reject_tool`):
```jsonc
// approve:
{"jsonrpc":"2.0","id":<permReqId>,"result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}
// reject (clean):
{"jsonrpc":"2.0","id":<permReqId>,"result":{"outcome":{"outcome":"selected","optionId":"reject_once"}}}
// reject (fallback when no reject option advertised):
{"jsonrpc":"2.0","id":<permReqId>,"result":{"outcome":{"outcome":"cancelled"}}}
```
**Server action on reply:**
- `optionId` matches an `allow_*` → **allow**: resolve the pi hook with
  `undefined`/nothing (pi executes the tool).
- `optionId` matches a `reject_*` OR `outcome:"cancelled"` → **deny**: resolve
  the pi hook with `{block: true, reason: "Denied by host"}`. Pi turns this into
  an error `tool_result` returned to the model (turn continues). **Do NOT throw.**

**Use a dedicated id counter** for permission requests. Never let a permission
`id` equal the in-flight `session/prompt` request's `id` — the client matches
responses by `id` AND `method is None`, and a collision misclassifies the
permission reply as prompt completion (ending the turn early; `acp-client.md`
"Request-id namespaces are independent").

## 5. The pi-side permission hook (exact code shape)

```typescript
let permId = 1000;  // dedicated counter, never 0..N where prompt ids live
const pending = new Map<number, {resolve: (v: any) => void}>();

// register on the AgentSession's extension surface:
session.on("tool_call", async (event) => {
  const id = permId++;
  const toolCallId = event.toolCallId;  // from the ToolCallEvent
  // emit §4 request
  send(JSON.stringify({
    jsonrpc: "2.0", id,
    method: "session/request_permission",
    params: { sessionId, toolCall: {toolCallId, title: event.toolName, kind: mapKind(event.toolName), input: event.input},
              options: [/* allow_once, allow_always, reject_once */] }
  }) + "\n");
  // BLOCK the pi turn until the client replies (verified Q1: hook is async-awaitable)
  const reply = await new Promise<any>((resolve) => pending.set(id, {resolve}));
  if (reply.outcome?.optionId?.startsWith("allow")) return;            // allow
  return { block: true, reason: "Denied by host" };                    // deny → error tool_result, turn continues
});

// on the client→server response with matching id:
function handlePermissionReply(id, result) {
  pending.get(id)?.resolve(result.outcome ?? result);
  pending.delete(id);
}
```

`mapKind`: pi tool name → ACP kind. `bash`→`"execute"`, `read`→`"read"`,
`edit`→`"edit"`, `write`→`"write"`, `grep`/`glob`/`ls`→those literals, custom→`""`.
Only `"execute"` gets the shell signal (`_dispatch.py:280`); the rest are
display-only.

## 6. Event mapping table (pi event → ACP notification)

| pi SDK event | ACP action | Notes |
|---|---|---|
| `assistantMessageEvent.type === "text_delta"` | §3.1 text chunk | `content.text = event.delta` |
| `assistantMessageEvent.type === "thinking_delta"` | §3.2 thinking chunk | |
| tool call starts (pi `beforeToolCall` hook fires) | §3.3 tool_call update + §4 permission request | hook MUST await permission reply |
| tool executes, returns result | §3.4 tool_call_update with `rawOutput` | `status:"completed"` for final |
| turn ends | respond to §2.5 prompt request with `stopReason:"end_turn"` | |
| `session.abort()` / cancel | respond to prompt with `stopReason:"cancelled"` | hook auto-resolves via signal |

## 7. Checklist before writing code

- [ ] §1 transport: stdin readline + stdout `JSON+"\n"`, logs to stderr only.
- [ ] §2.1 initialize: `protocolVersion: 1` (int), `loadSession: false`.
- [ ] §2.2 session/new: always return a `sessionId`.
- [ ] §2.3 set_mode: no-op accept, respond `{result:{}}`.
- [ ] §2.5 prompt: stream §3 notifications, resolve with `{stopReason:"end_turn"}`.
- [ ] §2.6 cancel: `abort()`, resolve prompt with `"cancelled"`.
- [ ] §2.7 unknown: `-32601`.
- [ ] §4 permission: **dedicated id counter**, never collide with prompt id.
- [ ] §5 hook: `{block:true,reason}` to deny, never throw.
- [ ] §3.4 gotcha: tool result discriminator is `tool_call_update`, not `tool_result`.

## 8. Known sharp edges (do not get these wrong)

1. **`tool_call_update` vs `tool_result`** — the `sessionUpdate` discriminator
   for tool *results* is `"tool_call_update"` (§3.4). There is no `"tool_result"`
   discriminator. Getting this wrong = silent no-op (the parser returns None).
2. **Permission id namespace** — dedicated counter, never reuse the prompt's id
   (§4). Collision = the permission reply ends the prompt early.
3. **`block`, don't throw** — `emitToolCall` does not catch handler errors
   (`runner.js:698`). Return `{block:true,reason}` to deny.
4. **`loadSession: false`** — without this, the client sends `session/load` and
   you must handle it. Declare false, skip resume entirely.
5. **`protocolVersion` is the integer `1`** — not a date string. Wrong type =
   handshake fails.
6. **stdout cleanliness** — only `JSON+"\n"` lines. Pi's own logging MUST go to
   stderr or be intercepted, never inherited on stdout.
