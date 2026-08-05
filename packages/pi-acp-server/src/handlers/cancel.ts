// cancel handler — aborts the pi turn. Cancel is a JSON-RPC notification (no
// id) per the build spec §2.6; nothing to write back. The session-prompt
// handler's awaited turn resolves with stopReason:"cancelled" because
// pi's session.abort() triggers the signal inside the in-flight await.
import type { TransportLike } from "../transport-like.js";
import type { PiSessionLike } from "./session-prompt.js";

export interface CancelContext {
  piSession: PiSessionLike;
  cancelInFlight(): void;
}

export function handleCancel(
  transport: TransportLike,
  ctx: CancelContext,
): void {
  // transport arg accepted for symmetry with other handlers + future hook
  // (e.g. emit a session/update cancel notification).
  void transport;
  ctx.piSession.abort();
  ctx.cancelInFlight();
}
