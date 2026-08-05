// Permission gate — bridges KiroCrew's `session/request_permission` round-trip
// to pi's `on("tool_call")` async hook (verified in Q1 of the feature spec).
//
// The hook is async-awaitable, so `createRequest` returns an awaitable that
// resolves only when KiroCrew replies. The reply is normalized to one of three
// shapes (allow / deny / cancelled) and translated to pi's hook return value
// via `mapReplyToHookResult` — `{block:true,reason}` to deny (turn continues
// as an error `tool_result`), or undefined to allow.
//
// Sharp edge #3 from the build spec: NEVER throw. A malformed reply yields
// `{block:true, reason:"Malformed permission reply"}` rather than an exception,
// because `ExtensionRunner.emitToolCall` does not wrap handler calls in a
// try/catch — a throw would propagate to pi's agent loop.
import type { IdAllocator } from "./id-allocator.js";

export type PermissionReply =
  | { kind: "allow"; optionId: string }
  | { kind: "deny"; optionId: string; reason: string }
  | { kind: "cancelled"; reason: string };

export type HookResult = { block: true; reason: string } | undefined;

export interface ToolCall {
  toolCallId: string;
  title: string;
  input: Record<string, unknown>;
}

export type PermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface PermissionOption {
  optionId: string;
  kind: PermissionOptionKind;
  name: string;
}

export interface PermissionOptions {
  sessionId: string;
  toolCall: ToolCall;
  options: PermissionOption[];
}

export interface PendingPermission {
  requestId: number;
  awaitable: Promise<PermissionReply>;
}

export function mapReplyToHookResult(reply: PermissionReply | unknown): HookResult {
  if (!reply || typeof reply !== "object") {
    return { block: true, reason: "Malformed permission reply" };
  }
  const r = reply as { kind?: string; reason?: string };
  if (r.kind === "allow") return undefined;
  if (r.kind === "deny") {
    return { block: true, reason: r.reason || "Denied by host" };
  }
  if (r.kind === "cancelled") {
    return { block: true, reason: "Denied by host" };
  }
  return { block: true, reason: "Malformed permission reply" };
}

export class PermissionGate {
  private pending = new Map<number, { resolve: (r: PermissionReply) => void }>();

  constructor(private ids: IdAllocator) {}

  createRequest(_options: PermissionOptions): PendingPermission {
    const requestId = this.ids.nextPermission();
    const awaitable = new Promise<PermissionReply>((resolve) => {
      this.pending.set(requestId, { resolve });
    });
    return { requestId, awaitable };
  }

  resolveReply(requestId: number, reply: PermissionReply): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    this.pending.delete(requestId);
    p.resolve(reply);
    return true;
  }

  size(): number {
    return this.pending.size;
  }
}
