import { describe, it, expect } from "vitest";
import {
  textChunk,
  thinkingChunk,
  toolCall,
  toolResult,
  usageUpdate,
  type NotificationEnvelope,
} from "../src/notifications.js";
import {
  subscribeToAgentSession,
  mapToolKind,
  type PiEventSource,
  type TransportSink,
} from "../src/pi-bridge.js";

describe("notification builders", () => {
  it("textChunk: sessionUpdate='agent_message_chunk' with content.text", () => {
    const n = textChunk("s1", "hello");
    expect(n.method).toBe("session/update");
    expect(n.params.sessionId).toBe("s1");
    expect(n.params.update.sessionUpdate).toBe("agent_message_chunk");
    expect(n.params.update.content).toEqual({ type: "text", text: "hello" });
  });

  it("thinkingChunk: sessionUpdate='agent_thought_chunk'", () => {
    const n = thinkingChunk("s1", "reasoning...");
    expect(n.params.update.sessionUpdate).toBe("agent_thought_chunk");
    expect(n.params.update.content).toEqual({
      type: "thinking",
      text: "reasoning...",
    });
  });

  it("toolCall: includes toolCallId/title/kind/rawInput/content:[]", () => {
    const n = toolCall("s1", {
      toolCallId: "tc-1",
      title: "bash: ls",
      kind: "execute",
      input: { command: "ls" },
    });
    expect(n.params.update.sessionUpdate).toBe("tool_call");
    expect(n.params.update.toolCallId).toBe("tc-1");
    expect(n.params.update.title).toBe("bash: ls");
    expect(n.params.update.kind).toBe("execute");
    expect(n.params.update.rawInput).toEqual({ command: "ls" });
    expect(n.params.update.content).toEqual([]);
  });

  it("toolResult: sessionUpdate='tool_call_update' (NOT tool_result)", () => {
    const n = toolResult("s1", {
      toolCallId: "tc-1",
      output: "out.txt",
      final: true,
    });
    expect(n.params.update.sessionUpdate).toBe("tool_call_update");
    expect(n.params.update.toolCallId).toBe("tc-1");
    expect(n.params.update.status).toBe("completed");
    expect(n.params.update.rawOutput).toEqual({
      items: [{ Text: "out.txt" }],
    });
  });

  it("toolResult with final=false: status='in_progress'", () => {
    const n = toolResult("s1", {
      toolCallId: "tc-1",
      output: "partial",
      final: false,
    });
    expect(n.params.update.status).toBe("in_progress");
  });

  it("usageUpdate: required size, optional tokens", () => {
    const n1 = usageUpdate("s1", { size: 1_000_000 });
    expect(n1.params.update.sessionUpdate).toBe("usage_update");
    expect(n1.params.update.size).toBe(1_000_000);
    expect(n1.params.update.inputTokens).toBeUndefined();

    const n2 = usageUpdate("s1", {
      size: 200000,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(n2.params.update.size).toBe(200000);
    expect(n2.params.update.inputTokens).toBe(100);
    expect(n2.params.update.outputTokens).toBe(50);
  });
});

describe("mapToolKind", () => {
  it("bash → 'execute'", () => expect(mapToolKind("bash")).toBe("execute"));
  it("read → 'read'", () => expect(mapToolKind("read")).toBe("read"));
  it("edit → 'edit'", () => expect(mapToolKind("edit")).toBe("edit"));
  it("write → 'write'", () => expect(mapToolKind("write")).toBe("write"));
  it("grep/glob/ls → tool name", () => {
    expect(mapToolKind("grep")).toBe("grep");
    expect(mapToolKind("glob")).toBe("glob");
    expect(mapToolKind("ls")).toBe("ls");
  });
  it("unknown → ''", () => expect(mapToolKind("custom")).toBe(""));
});

describe("subscribeToAgentSession", () => {
  function makeFakeSource(): {
    source: PiEventSource;
    handlers: Record<string, (...args: unknown[]) => void>;
  } {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const source: PiEventSource = {
      on(event, handler) {
        handlers[event] = handler as (...args: unknown[]) => void;
      },
    };
    return { source, handlers };
  }

  function makeFakeSink(): {
    sink: TransportSink;
    written: NotificationEnvelope[];
  } {
    const written: NotificationEnvelope[] = [];
    const sink: TransportSink = {
      write: (msg) => written.push(msg),
    };
    return { sink, written };
  }

  it("text_delta → textChunk notification", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["text_delta"]({ delta: "hello" });
    expect(written).toHaveLength(1);
    expect(written[0].params.update.sessionUpdate).toBe("agent_message_chunk");
    expect((written[0].params.update.content as { text: string }).text).toBe("hello");
  });

  it("thinking_delta → thinkingChunk notification", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["thinking_delta"]({ delta: "thinking..." });
    expect(written[0].params.update.sessionUpdate).toBe("agent_thought_chunk");
  });

  it("tool_call_start → toolCall with mapped kind + title", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["tool_call_start"]({
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "ls -la" },
    });
    expect(written[0].params.update.sessionUpdate).toBe("tool_call");
    expect(written[0].params.update.kind).toBe("execute");
    expect(written[0].params.update.toolCallId).toBe("tc-1");
    expect(written[0].params.update.title).toContain("bash");
  });

  it("tool_call_start with non-object args → empty input object", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["tool_call_start"]({
      toolCallId: "tc-1",
      toolName: "read",
      args: null,
    });
    expect(written[0].params.update.rawInput).toEqual({});
  });

  it("tool_result → tool_call_update notification", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["tool_result"]({ toolCallId: "tc-1", output: "ok", final: true });
    expect(written[0].params.update.sessionUpdate).toBe("tool_call_update");
    expect(written[0].params.update.status).toBe("completed");
  });

  it("turn_complete without contextSize → no notification", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["turn_complete"]({ inputTokens: 100, outputTokens: 50 });
    expect(written).toHaveLength(0);
  });

  it("turn_complete with contextSize → usage_update notification", () => {
    const { source, handlers } = makeFakeSource();
    const { sink, written } = makeFakeSink();
    subscribeToAgentSession(source, sink, "s1");
    handlers["turn_complete"]({
      inputTokens: 100,
      outputTokens: 50,
      contextSize: 200000,
    });
    expect(written).toHaveLength(1);
    expect(written[0].params.update.sessionUpdate).toBe("usage_update");
    expect(written[0].params.update.size).toBe(200000);
    expect(written[0].params.update.inputTokens).toBe(100);
    expect(written[0].params.update.outputTokens).toBe(50);
  });
});
