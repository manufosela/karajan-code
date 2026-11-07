// HU-3533 (KJC-TSK-1445): the agent that plans judges each HU's tier as it creates it, as kj plan's
// decomposition did; kj crosses it with its own signal (the higher wins, a sensitive zone is deep)
// and the HU keeps it, so kj code later writes it with the model of its tier.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";

let dir;
let warnings;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-tier-"));
  warnings = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation((m) => warnings.push(String(m)));
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const team = ({ keepsTier = true } = {}) => {
  const created = [];
  const manager = {
    capabilities: { acceptanceCriteria: "body", dependencies: "partial", assignee: true, verdicts: "pr", offline: true, ...(keepsTier ? { tier: true } : {}) },
    list: async () => [],
    create: async (args) => { created.push(args); return { short_id: "HU-42", status: "pending", title: args.title }; },
    move: async () => ({}),
    claim: async () => ({}),
  };
  return { created, deps: { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), manager, writeMirror: async () => {} } };
};
const add = (title, flags, deps) => huCommand({ config: { projectDir: dir }, action: "add", args: [title], flags: { json: true, ...flags }, deps });

describe("kj hu add --tier", () => {
  it("stores the judged tier with its reason on the shared board", async () => {
    const { created, deps } = team();
    const r = await add("Fix the typo in the footer", { tier: "trivial", tierReason: "one line of copy" }, deps);
    expect(created[0].tier).toEqual({ level: "trivial", reason: expect.stringContaining("one line of copy") });
    expect(r.tier.level).toBe("trivial");
  });

  it("keeps the higher of the judged tier and kj's signal: a sensitive zone is always deep", async () => {
    const { created, deps } = team();
    await add("Rotate the auth tokens", { tier: "trivial", tierReason: "small" }, deps);
    expect(created[0].tier.level).toBe("deep");
    expect(created[0].tier.reason).toMatch(/sensitive zone: auth/);
  });

  it("refuses a tier that is not one of trivial, standard or deep", async () => {
    await expect(add("Something", { tier: "huge" }, team().deps)).rejects.toThrow(/--tier.*trivial, standard, deep/);
  });

  it("without --tier stores none and says how to give one", async () => {
    const { created, deps } = team();
    await add("Add a page", {}, deps);
    expect(created[0].tier ?? null).toBeNull();
    expect(warnings.join("\n")).toMatch(/--tier/);
  });

  it("says so when the board cannot keep the tier, and still creates the HU", async () => {
    const { created, deps } = team({ keepsTier: false });
    await add("Add a page", { tier: "standard" }, deps);
    expect(created[0].tier ?? null).toBeNull();
    expect(warnings.join("\n")).toMatch(/does not keep.*tier/);
  });

  it("keeps the tier on a local HU", async () => {
    const r = await add("Add a page", { tier: "standard", tierReason: "a new view" }, { boardConfig: async () => ({ backend: "local" }) });
    expect(r.tier).toMatchObject({ level: "standard" });
  });
});
