import { describe, it, expect } from "vitest";
import {
  handleSessionPrompt,
  type PiSessionLike,
} from "../../src/handlers/session-prompt.js";
import type { TransportLike } from "../../src/transport-like.js";

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

function makeFakePiSession(
  behavior: "end_turn" | "cancelled" = "end_turn",
): { piSession: PiSessionLike; promptCalls: string[] } {
  const promptCalls: string[] = [];
  const piSession: PiSessionLike = {
    prompt: async (text) => {
      promptCalls.push(text);
      return { stopReason: behavior };
    },
    abort: () => {},
  };
  return { piSession, promptCalls };
}

describe("handleSessionPrompt", () => {
  it("extracts user text from messages and sends prompt to pi", async () => {
    const { transport } = makeFakeTransport();
    const { piSession, promptCalls } = makeFakePiSession();
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      42,
      {
        sessionId: "s1",
        messages: [
          { role: "user", content: [{ type: "text", text: "hello world" }] },
        ],
      },
    );
    expect(promptCalls).toEqual(["hello world"]);
  });

  it("joins multi-block user content with newlines", async () => {
    const { transport } = makeFakeTransport();
    const { piSession, promptCalls } = makeFakePiSession();
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      1,
      {
        sessionId: "s1",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "block1" },
              { type: "text", text: "block2" },
            ],
          },
        ],
      },
    );
    expect(promptCalls).toEqual(["block1\nblock2"]);
  });

  it("skips non-user roles", async () => {
    const { transport } = makeFakeTransport();
    const { piSession, promptCalls } = makeFakePiSession();
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      1,
      {
        sessionId: "s1",
        messages: [
          { role: "system", content: "ignored" },
          { role: "user", content: [{ type: "text", text: "kept" }] },
        ],
      },
    );
    expect(promptCalls).toEqual(["kept"]);
  });

  it("skips non-text blocks (e.g. images)", async () => {
    const { transport } = makeFakeTransport();
    const { piSession, promptCalls } = makeFakePiSession();
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      1,
      {
        sessionId: "s1",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe this:" },
              { type: "image", data: "fake" },
            ],
          },
        ],
      },
    );
    expect(promptCalls).toEqual(["describe this:"]);
  });

  it("handles string content directly", async () => {
    const { transport } = makeFakeTransport();
    const { piSession, promptCalls } = makeFakePiSession();
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      1,
      {
        sessionId: "s1",
        messages: [{ role: "user", content: "plain string" }],
      },
    );
    expect(promptCalls).toEqual(["plain string"]);
  });

  it("resolves response with stopReason='end_turn' on normal completion", async () => {
    const { transport, written } = makeFakeTransport();
    const { piSession } = makeFakePiSession("end_turn");
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      99,
      { sessionId: "s1", messages: [{ role: "user", content: "x" }] },
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      jsonrpc: "2.0",
      id: 99,
      result: { stopReason: "end_turn" },
    });
  });

  it("resolves response with stopReason='cancelled' on cancel", async () => {
    const { transport, written } = makeFakeTransport();
    const { piSession } = makeFakePiSession("cancelled");
    await handleSessionPrompt(
      transport,
      { sessionId: "s1", piSession },
      100,
      { sessionId: "s1", messages: [{ role: "user", content: "x" }] },
    );
    expect((written[0] as { result: unknown }).result).toEqual({
      stopReason: "cancelled",
    });
  });
});
