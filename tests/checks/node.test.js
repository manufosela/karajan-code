import { describe, expect, it } from "vitest";
import { createNodeVersionCheck, parseNodeVersion, MIN_NODE_MAJOR } from "../../src/checks/node.js";

describe("checks/node-version", () => {
  it("parseNodeVersion accepts v-prefixed and bare versions", () => {
    expect(parseNodeVersion("v20.12.1")).toEqual({ major: 20, minor: 12, patch: 1 });
    expect(parseNodeVersion("22.0.0")).toEqual({ major: 22, minor: 0, patch: 0 });
    expect(parseNodeVersion("invalid")).toBeNull();
    expect(parseNodeVersion("")).toBeNull();
  });

  it("passes for current supported major", async () => {
    const check = createNodeVersionCheck({ version: `v${MIN_NODE_MAJOR}.0.0` });
    const result = await check.detect({ config: {} });
    expect(result.ok).toBe(true);
  });

  it("passes for Node 22 (the current minimum baseline since v3.0.0)", async () => {
    const check = createNodeVersionCheck({ version: "v22.22.1" });
    const result = await check.detect({ config: {} });
    expect(result.ok).toBe(true);
  });

  it("fails for Node older than the required major", async () => {
    const check = createNodeVersionCheck({ version: "v20.18.0" });
    const result = await check.detect({ config: {} });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("fail");
    expect(result.fix).toContain("nvm install");
    expect(result.extra.detected.major).toBe(20);
  });

  it("fails cleanly for an unparseable version", async () => {
    const check = createNodeVersionCheck({ version: "garbage" });
    const result = await check.detect({ config: {} });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Unrecognized");
  });

  it("is marked manual (cannot auto-fix runtime)", () => {
    expect(createNodeVersionCheck().strategy).toBe("manual");
  });
});
