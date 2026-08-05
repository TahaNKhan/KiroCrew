import { describe, it, expect } from "vitest";
import { IdAllocator } from "../src/id-allocator.js";

describe("IdAllocator", () => {
  it("nextOutbound returns 1, 2, 3, ...", () => {
    const a = new IdAllocator();
    expect(a.nextOutbound()).toBe(1);
    expect(a.nextOutbound()).toBe(2);
    expect(a.nextOutbound()).toBe(3);
  });

  it("nextPermission returns 1000000, 1000001, ...", () => {
    const a = new IdAllocator();
    expect(a.nextPermission()).toBe(1_000_000);
    expect(a.nextPermission()).toBe(1_000_001);
    expect(a.nextPermission()).toBe(1_000_002);
  });

  it("1000 calls each: zero overlap", () => {
    const a = new IdAllocator();
    const ids = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      ids.add(a.nextOutbound());
      ids.add(a.nextPermission());
    }
    expect(ids.size).toBe(2000);
  });
});
