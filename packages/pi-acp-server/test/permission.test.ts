import { describe, it, expect } from "vitest";
import {
  PermissionGate,
  mapReplyToHookResult,
  type PermissionOptions,
  type PermissionReply,
} from "../src/permission.js";
import { IdAllocator } from "../src/id-allocator.js";

function makeOpts(): PermissionOptions {
  return {
    sessionId: "test-session",
    toolCall: { toolCallId: "tc-1", title: "bash: ls", input: { command: "ls" } },
    options: [
      { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
      { optionId: "allow_always", kind: "allow_always", name: "Allow always" },
      { optionId: "reject_once", kind: "reject_once", name: "Deny" },
    ],
  };
}

describe("PermissionGate", () => {
  it("createRequest returns disjoint permission id (>=1000000)", () => {
    const gate = new PermissionGate(new IdAllocator());
    const req = gate.createRequest(makeOpts());
    expect(req.requestId).toBeGreaterThanOrEqual(1000000);
    expect(typeof req.awaitable.then).toBe("function");
  });

  it("resolveReply(allow) resolves the awaitable", async () => {
    const gate = new PermissionGate(new IdAllocator());
    const req = gate.createRequest(makeOpts());
    const reply: PermissionReply = { kind: "allow", optionId: "allow_once" };
    const resolved = req.awaitable;
    expect(gate.resolveReply(req.requestId, reply)).toBe(true);
    expect(await resolved).toEqual(reply);
    expect(gate.size()).toBe(0);
  });

  it("resolveReply(deny) resolves the awaitable", async () => {
    const gate = new PermissionGate(new IdAllocator());
    const req = gate.createRequest(makeOpts());
    const reply: PermissionReply = {
      kind: "deny",
      optionId: "reject_once",
      reason: "user said no",
    };
    const resolved = req.awaitable;
    expect(gate.resolveReply(req.requestId, reply)).toBe(true);
    expect(await resolved).toEqual(reply);
    expect(gate.size()).toBe(0);
  });

  it("resolveReply(cancelled) resolves the awaitable", async () => {
    const gate = new PermissionGate(new IdAllocator());
    const req = gate.createRequest(makeOpts());
    const reply: PermissionReply = { kind: "cancelled", reason: "host cancelled" };
    const resolved = req.awaitable;
    expect(gate.resolveReply(req.requestId, reply)).toBe(true);
    expect(await resolved).toEqual(reply);
    expect(gate.size()).toBe(0);
  });

  it("resolveReply with unknown id returns false (no throw)", () => {
    const gate = new PermissionGate(new IdAllocator());
    const reply: PermissionReply = { kind: "allow", optionId: "allow_once" };
    expect(gate.resolveReply(99999, reply)).toBe(false);
    expect(gate.size()).toBe(0);
  });

  it("100 createRequest+resolveReply cycles: distinct ids, all >= 1e6, size 0", async () => {
    const gate = new PermissionGate(new IdAllocator());
    const ids: number[] = [];
    for (let i = 0; i < 100; i++) {
      const req = gate.createRequest(makeOpts());
      ids.push(req.requestId);
      expect(req.requestId).toBeGreaterThanOrEqual(1000000);
      const reply: PermissionReply = { kind: "allow", optionId: "allow_once" };
      gate.resolveReply(req.requestId, reply);
      await req.awaitable;
    }
    const distinct = new Set(ids);
    expect(distinct.size).toBe(100);
    expect(gate.size()).toBe(0);
  });
});

describe("mapReplyToHookResult", () => {
  it("allow → undefined (pi runs the tool)", () => {
    expect(
      mapReplyToHookResult({ kind: "allow", optionId: "allow_once" }),
    ).toBeUndefined();
  });

  it("deny with reason → {block:true, reason}", () => {
    expect(
      mapReplyToHookResult({
        kind: "deny",
        optionId: "reject_once",
        reason: "user said no",
      }),
    ).toEqual({ block: true, reason: "user said no" });
  });

  it("deny with empty reason → {block:true, reason: 'Denied by host'}", () => {
    expect(
      mapReplyToHookResult({
        kind: "deny",
        optionId: "reject_once",
        reason: "",
      }),
    ).toEqual({ block: true, reason: "Denied by host" });
  });

  it("cancelled → {block:true, reason: 'Denied by host'}", () => {
    expect(
      mapReplyToHookResult({ kind: "cancelled", reason: "host cancelled" }),
    ).toEqual({ block: true, reason: "Denied by host" });
  });

  it("malformed (null) → {block:true, reason: 'Malformed permission reply'}", () => {
    expect(mapReplyToHookResult(null)).toEqual({
      block: true,
      reason: "Malformed permission reply",
    });
  });

  it("malformed (unknown kind) → {block:true, reason: 'Malformed permission reply'}", () => {
    expect(mapReplyToHookResult({ kind: "wat" })).toEqual({
      block: true,
      reason: "Malformed permission reply",
    });
  });

  it("malformed (no kind) → {block:true, reason: 'Malformed permission reply'}", () => {
    expect(mapReplyToHookResult({ reason: "x" })).toEqual({
      block: true,
      reason: "Malformed permission reply",
    });
  });

  it("malformed (string) → {block:true, reason: 'Malformed permission reply'}", () => {
    expect(mapReplyToHookResult("not an object")).toEqual({
      block: true,
      reason: "Malformed permission reply",
    });
  });
});
