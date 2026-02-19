import { describe, expect, it, beforeEach } from "vitest";
import { resolveBin, clearBinCache } from "../src/agents/resolve-bin.js";

describe("resolveBin", () => {
  beforeEach(() => {
    clearBinCache();
  });

  it("resolves a known binary (node) to an absolute path", () => {
    const resolved = resolveBin("node");
    expect(resolved).toMatch(/^\//);
    expect(resolved).toContain("node");
  });

  it("resolves npm to an absolute path", () => {
    const resolved = resolveBin("npm");
    expect(resolved).toMatch(/^\//);
  });

  it("returns the original name for a non-existent binary", () => {
    const resolved = resolveBin("__nonexistent_binary_xyz__");
    expect(resolved).toBe("__nonexistent_binary_xyz__");
  });

  it("caches results across calls", () => {
    const first = resolveBin("node");
    const second = resolveBin("node");
    expect(first).toBe(second);
  });

  it("clearBinCache resets the cache", () => {
    resolveBin("node");
    clearBinCache();
    const resolved = resolveBin("node");
    expect(resolved).toMatch(/^\//);
  });
});
