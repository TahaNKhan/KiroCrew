import { describe, it, expect } from "vitest";
import { handleCancel } from "../../src/handlers/cancel.js";
import type { TransportLike } from "../../src/transport-like.js";
import type { PiSessionLike } from "../../src/handlers/session-prompt.js";

function makeFakeTransport(): {
  transport: TransportLike;
  written: unknown[];
} {
  const written: unknown[] = [];
  const transport: TransportLike = {
    write: (msg) => written.push(msg),
    onMessage: () => {},
  };
  return { transport, written };
}

describe("handleCancel", () => {
  it("calls piSession.abort()", () => {
    const { transport } = makeFakeTransport();
    let aborted = false;
    const piSession: PiSessionLike = {
      prompt: async () => ({ stopReason: "end_turn" }),
      abort: () => {
        aborted = true;
      },
    };
    handleCancel(transport, { piSession, cancelInFlight: () => {} });
    expect(aborted).toBe(true);
  });

  it("calls cancelInFlight to settle any in-flight prompt", () => {
    const { transport } = makeFakeTransport();
    const piSession: PiSessionLike = {
      prompt: async () => ({ stopReason: "end_turn" }),
      abort: () => {},
    };
    let cancelled = false;
    handleCancel(transport, {
      piSession,
      cancelInFlight: () => {
        cancelled = true;
      },
    });
    expect(cancelled).toBe(true);
  });

  it("does not write anything (cancel is a notification, no id)", () => {
    const { transport, written } = makeFakeTransport();
    const piSession: PiSessionLike = {
      prompt: async () => ({ stopReason: "end_turn" }),
      abort: () => {},
    };
    handleCancel(transport, { piSession, cancelInFlight: () => {} });
    expect(written).toHaveLength(0);
  });
});
