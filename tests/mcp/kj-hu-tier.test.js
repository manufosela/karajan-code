// HU-3533 (KJC-TSK-1445): an agent that plans over MCP gives each card its tier, as kj hu add --tier.
import { describe, it, expect, vi } from "vitest";

const calls = [];
vi.mock("../../src/mcp/run-kj.js", () => ({
  runKjCommand: async ({ commandArgs }) => {
    calls.push(commandArgs);
    return { ok: true, stdout: JSON.stringify({ short_id: "HU-1", status: "pending" }) };
  },
}));
const { handleHu } = await import("../../src/mcp/handlers/hu-handlers.js");

describe("kj_hu create with a tier", () => {
  it("passes the tier and its reason to kj hu add", async () => {
    await handleHu({ action: "create", title: "Fix the footer", tier: "trivial", tierReason: "one line", projectDir: "/p" });
    expect(calls.at(-1)).toEqual(["add", "Fix the footer", "--tier", "trivial", "--tier-reason", "one line", "--json"]);
  });

  it("passes no tier when none is given", async () => {
    await handleHu({ action: "create", title: "Add a page", projectDir: "/p" });
    expect(calls.at(-1)).toEqual(["add", "Add a page", "--json"]);
  });
});
