// Notification builders — emit the five session/update kinds KiroCrew's
// AcpClient parses via _dispatch.py. Sharp edge #1 from the build spec:
// the `tool_call_update` discriminator is for TOOL RESULTS too (not
// "tool_result"). Getting this wrong → silent no-op in the client.
export interface NotificationEnvelope {
  method: "session/update";
  params: {
    sessionId: string;
    update: Record<string, unknown>;
  };
}

export function textChunk(sessionId: string, text: string): NotificationEnvelope {
  return {
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  };
}

export function thinkingChunk(
  sessionId: string,
  text: string,
): NotificationEnvelope {
  return {
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "thinking", text },
      },
    },
  };
}

export function toolCall(
  sessionId: string,
  args: {
    toolCallId: string;
    title: string;
    kind: string;
    input: Record<string, unknown>;
  },
): NotificationEnvelope {
  return {
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: args.toolCallId,
        title: args.title,
        kind: args.kind,
        rawInput: args.input,
        content: [],
      },
    },
  };
}

export function toolResult(
  sessionId: string,
  args: { toolCallId: string; output: string; final: boolean },
): NotificationEnvelope {
  return {
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: args.toolCallId,
        status: args.final ? "completed" : "in_progress",
        rawOutput: { items: [{ Text: args.output }] },
      },
    },
  };
}

export function usageUpdate(
  sessionId: string,
  args: { size: number; inputTokens?: number; outputTokens?: number },
): NotificationEnvelope {
  const update: Record<string, unknown> = {
    sessionUpdate: "usage_update",
    size: args.size,
  };
  if (args.inputTokens !== undefined) update.inputTokens = args.inputTokens;
  if (args.outputTokens !== undefined) update.outputTokens = args.outputTokens;
  return { method: "session/update", params: { sessionId, update } };
}
