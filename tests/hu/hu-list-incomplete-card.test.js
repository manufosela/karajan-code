// HU-4769: kj hu list prints every card; one that lacks its short id or status gets a placeholder
// and a warning, never a throw (the old padEnd on undefined killed the whole listing).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { savePlan } from "../../src/plan/plan-store.js";

let dir, prevHome, logs, warns;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-incomplete-"));
  prevHome = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = path.join(dir, ".karajan-home");
  fs.mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
  logs = []; warns = [];
  vi.spyOn(console, "log").mockImplementation((m) => logs.push(String(m)));
  vi.spyOn(console, "warn").mockImplementation((m) => warns.push(String(m)));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
});

const list = (deps = {}) => huCommand({ config: { projectDir: dir }, action: "list", flags: {}, deps });

describe("kj hu list with an incomplete card", () => {
  it("shared board: prints all three cards and warns about the incomplete ones", async () => {
    const hus = [
      { short_id: "HU-1", title: "Complete", status: "pending" },
      { short_id: "HU-2", title: "No status", status: undefined },
      { id: "gh-3", title: "No short id", status: "running" },
    ];
    const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus: async () => hus, who: "me" };
    await list(deps);
    const cards = logs.filter((l) => /Complete|No status|No short id/.test(l));
    expect(cards).toHaveLength(3);
    expect(cards[1]).toMatch(/HU-2\s+\?\s+No status/);
    expect(cards[2]).toMatch(/gh-3\s+running\s+No short id/);
    expect(warns.some((w) => /came without status: HU-2/.test(w))).toBe(true);
    expect(warns.filter((w) => w.startsWith("⚠ a card of the shared board"))).toHaveLength(1);
  });

  it("shared board: a card with neither id nor short id is named by its title", async () => {
    const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus: async () => [{ title: "Nameless", status: "pending" }], who: "me" };
    await list(deps);
    expect(logs.some((l) => /\?\s+pending\s+Nameless/.test(l))).toBe(true);
    expect(warns.some((w) => /came without short_id: Nameless/.test(w))).toBe(true);
  });

  it("local board: a card without status is printed with a placeholder and a warning", async () => {
    await savePlan(dir, { planId: "plan-x", version: 2, task: "t", hus: [
      { id: "HU-10", short_id: "HU-10", title: "Fine", status: "pending" },
      { id: "HU-11", short_id: "HU-11", title: "Broken" },
    ] });
    await list({ boardConfig: async () => ({ backend: "local" }) });
    expect(logs.some((l) => /HU-11\s+\?\s+Broken/.test(l))).toBe(true);
    expect(logs.some((l) => /HU-10\s+pending\s+Fine/.test(l))).toBe(true);
    expect(warns.some((w) => /came without status: HU-11/.test(w))).toBe(true);
  });
});
