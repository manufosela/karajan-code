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

const HUS = [{ short_id: "HU-7", number: 7, title: "A", status: "running", claimed_by: "jorgecasar", ref: "KJC-TSK-0042" }, { short_id: "HU-8", number: 8, title: "B", status: "pending", claimed_by: null }];
const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus: async () => HUS, who: "manufosela" };

describe("the shared board mirrored for kj board", () => {
  it("kj hu list writes the read-only plan the web board shows", async () => {
    await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
    const plan = await loadPlan(dir, "github");
    // KJC-TSK-1197: the repo travels on its own so the board can link to its issues.
    expect(plan).toMatchObject({ readonly: "github", repo: "acme/app", task: expect.stringContaining("acme/app") });
    // KJC-BUG-0443: the tracker reference travels with the issue, so card-first finds the HU by it.
    expect(plan.hus.map((h) => [h.id, h.status, h.claimed_by, h.external_ref])).toEqual([["HU-7", "running", "jorgecasar", "acme/app#7 · KJC-TSK-0042"], ["HU-8", "pending", null, "acme/app#8"]]);
  });

  it("lands in the plans root the board reads when KJ_PLANS_DIR overrides it", async () => {
    const override = path.join(dir, "board-plans");
    process.env.KJ_PLANS_DIR = override;
    try {
      await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
      const slugDir = fs.readdirSync(override)[0];
      // KJC-BUG-0397: the board reads plan-*.json only; the mirror was plan_github-board.json.
      expect(fs.readdirSync(path.join(override, slugDir))).toEqual(["plan-github-board.json"]);
    } finally {
      delete process.env.KJ_PLANS_DIR;
    }
  });

  it("KJC-BUG-0397: replaces the misnamed mirror an older kj left behind", async () => {
    const plans = path.join(dir, "board-plans");
    process.env.KJ_PLANS_DIR = plans;
    try {
      await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
      const slugDir = path.join(plans, fs.readdirSync(plans)[0]);
      fs.writeFileSync(path.join(slugDir, "plan_github-board.json"), "{}");
      await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
      expect(fs.readdirSync(slugDir)).toEqual(["plan-github-board.json"]);
    } finally {
      delete process.env.KJ_PLANS_DIR;
    }
  });

  it("KJC-BUG-0397, end to end: kj board loads the mirror under its project, with each HU's status", async () => {
    const plans = path.join(dir, "board-plans");
    Object.assign(process.env, { KJ_PLANS_DIR: plans, KJ_HOME: path.join(dir, "board-home") });
    try {
      await huCommand({ config: { projectDir: dir }, action: "list", flags: { json: true }, deps });
      const db = await import("../../packages/hu-board/src/db.js");
      const sync = await import("../../packages/hu-board/src/sync.js");
      db.initDb();
      sync.fullScan();
      const project = sync.deriveProjectIdFromDir(sync.canonicalProjectDir(dir));
      expect(db.getStoriesByProject(project).map((s) => [s.title, s.status]).sort()).toEqual([["A", "running"], ["B", "pending"]]);
    } finally {
      delete process.env.KJ_PLANS_DIR;
      delete process.env.KJ_HOME;
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
