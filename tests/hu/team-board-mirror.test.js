// KJC-TSK-1166 (TEAM-GH-E, ADR 0025): what kj reads from the shared board is mirrored into a
// read-only plan, so kj board shows the team's HUs next to the local ones.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";
import { loadPlan } from "../../src/plan/plan-store.js";

let dir, prevHome;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mirror-"));
  prevHome = process.env.KARAJAN_HOME;
  process.env.KARAJAN_HOME = path.join(dir, ".karajan-home");
  fs.mkdirSync(process.env.KARAJAN_HOME, { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.KARAJAN_HOME; else process.env.KARAJAN_HOME = prevHome;
});

const HUS = [{ short_id: "HU-7", number: 7, title: "A", status: "running", claimed_by: "jorgecasar" }, { short_id: "HU-8", number: 8, title: "B", status: "pending", claimed_by: null }];
const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus: async () => HUS, who: "manufosela" };

describe("the shared board mirrored for kj board", () => {
  it("kj hu list writes the read-only plan the web board shows", async () => {
    await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
    const plan = await loadPlan(dir, "github");
    expect(plan).toMatchObject({ readonly: "github", task: expect.stringContaining("acme/app") });
    expect(plan.hus.map((h) => [h.id, h.status, h.claimed_by, h.external_ref])).toEqual([["HU-7", "running", "jorgecasar", "acme/app#7"], ["HU-8", "pending", null, "acme/app#8"]]);
  });

  it("lands in the plans root the board reads when KJ_PLANS_DIR overrides it", async () => {
    const override = path.join(dir, "board-plans");
    process.env.KJ_PLANS_DIR = override;
    try {
      await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
      const slugDir = fs.readdirSync(override)[0];
      expect(fs.existsSync(path.join(override, slugDir, "plan_github-board.json"))).toBe(true);
    } finally {
      delete process.env.KJ_PLANS_DIR;
    }
  });

  it("the mirror is not listed as local work, and is rewritten on the next read", async () => {
    await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
    const fewer = { ...deps, listTeamHus: async () => HUS.slice(0, 1) };
    const rows = await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps: fewer });
    expect(rows).toHaveLength(1);
    expect((await loadPlan(dir, "github")).hus).toHaveLength(1);
  });
});
