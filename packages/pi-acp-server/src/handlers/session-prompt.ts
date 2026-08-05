// session-prompt handler — the core of the server. Receives a user prompt,
// forwards it to pi, awaits the turn, responds with stopReason.
//
// The PiSessionLike interface lets tests inject a fake; no real pi dependency.
import type { TransportLike } from "../transport-like.js";

export interface PiSessionLike {
  prompt(text: string): Promise<{ stopReason: "end_turn" | "cancelled" }>;
  abort(): void;
}

export interface SessionPromptContext {
  sessionId: string;
  piSession: PiSessionLike;
}

export async function handleSessionPrompt(
  transport: TransportLike,
  ctx: SessionPromptContext,
  requestId: number,
  params: {
    sessionId: string;
    messages: Array<{ role: string; content: unknown }>;
  },
): Promise<void> {
  const text = extractUserText(params.messages);
  const result = await ctx.piSession.prompt(text);
  transport.write({
    jsonrpc: "2.0",
    id: requestId,
    result: { stopReason: result.stopReason },
  });
}

/** Extract plain text from the user's messages block. Skips images. */
function extractUserText(
  messages: Array<{ role: string; content: unknown }>,
): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "text"
        ) {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") parts.push(text);
        }
      }
    }
  }
  return parts.join("\n");
}
