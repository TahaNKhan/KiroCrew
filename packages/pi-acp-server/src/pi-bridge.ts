// pi-bridge — wires pi's AgentSession events to the notification builders.
// The bridge takes a PiEventSource interface (for testability with a fake),
// NOT a real pi dependency. Keeps the package runnable without the SDK.
import {
  textChunk,
  thinkingChunk,
  toolCall,
  toolResult,
  usageUpdate,
  type NotificationEnvelope,
} from "./notifications.js";

export interface PiEventSource {
  on(event: "text_delta", handler: (e: { delta: string }) => void): void;
  on(event: "thinking_delta", handler: (e: { delta: string }) => void): void;
  on(
    event: "tool_call_start",
    handler: (e: {
      toolCallId: string;
      toolName: string;
      args: unknown;
    }) => void,
  ): void;
  on(
    event: "tool_result",
    handler: (e: {
      toolCallId: string;
      output: string;
      final: boolean;
    }) => void,
  ): void;
  on(
    event: "turn_complete",
    handler: (e: {
      inputTokens?: number;
      outputTokens?: number;
      contextSize?: number;
    }) => void,
  ): void;
}

export interface TransportSink {
  write(msg: NotificationEnvelope): void;
}

/** Map pi tool name → ACP kind (only "execute" is shell-significant for _dispatch). */
export function mapToolKind(toolName: string): string {
  if (toolName === "bash") return "execute";
  if (toolName === "read") return "read";
  if (toolName === "edit") return "edit";
  if (toolName === "write") return "write";
  if (toolName === "grep" || toolName === "glob" || toolName === "ls")
    return toolName;
  return "";
}

export function subscribeToAgentSession(
  source: PiEventSource,
  sink: TransportSink,
  sessionId: string,
): void {
  source.on("text_delta", (e) => sink.write(textChunk(sessionId, e.delta)));
  source.on("thinking_delta", (e) =>
    sink.write(thinkingChunk(sessionId, e.delta)),
  );
  source.on("tool_call_start", (e) => {
    const input =
      e.args && typeof e.args === "object"
        ? (e.args as Record<string, unknown>)
        : {};
    sink.write(
      toolCall(sessionId, {
        toolCallId: e.toolCallId,
        title: `${e.toolName}: ${JSON.stringify(input).slice(0, 60)}`,
        kind: mapToolKind(e.toolName),
        input,
      }),
    );
  });
  source.on("tool_result", (e) =>
    sink.write(
      toolResult(sessionId, {
        toolCallId: e.toolCallId,
        output: e.output,
        final: e.final,
      }),
    ),
  );
  source.on("turn_complete", (e) => {
    if (typeof e.contextSize !== "number") return;
    sink.write(
      usageUpdate(sessionId, {
        size: e.contextSize,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
      }),
    );
  });
}
