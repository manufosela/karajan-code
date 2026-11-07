// HU-3533 (KJC-TSK-1445): kj hu tier <id> says the tier a card was planned with, whatever board
// keeps it, so the Sentinel and the agent read it without knowing where cards live.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { tierOfHu } from "../../src/hu/hu-tier.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-tier-cmd-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const local = { boardConfig: async () => ({ backend: "local" }) };
const hu = (action, args, deps = local) => huCommand({ config: { projectDir: dir }, action, args, flags: { json: true }, deps });

describe("tierOfHu", () => {
  it("reads the tier as the local board keeps it, as a manager gives it, or none", () => {
    expect(tierOfHu({ complexity: { tier: "deep" } })).toBe("deep");
    expect(tierOfHu({ tier: { level: "trivial", reason: "x" } })).toBe("trivial");
    expect(tierOfHu({ title: "no tier" })).toBeNull();
    expect(tierOfHu(null)).toBeNull();
  });
});

describe("kj hu tier", () => {
  it("says the tier of a local card, and null for one planned without it", async () => {
    const tiered = await hu("add", ["Fix the footer"], local).then(() => null);
    expect(tiered).toBeNull();
    await huCommand({ config: { projectDir: dir }, action: "add", args: ["Add a page"], flags: { json: true, tier: "standard" }, deps: local });
    expect(await hu("tier", ["HU-0002"])).toMatchObject({ id: "HU-0002", tier: "standard" });
    expect(await hu("tier", ["HU-0001"])).toMatchObject({ id: "HU-0001", tier: null });
  });

  it("fails loud on a card that is not on the board", async () => {
    await expect(hu("tier", ["HU-0099"])).rejects.toThrow(/HU-0099 is not on the HU Board/);
    await expect(hu("tier", [])).rejects.toThrow(/usage: kj hu tier <id>/);
  });
});
