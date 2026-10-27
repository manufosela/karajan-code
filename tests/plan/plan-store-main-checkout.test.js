// #2566 PR 2: plans hang from the main checkout. Field case: from a lane, `kj review`
// found no live card because the lane read its own plans folder.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { plansDir, projectSlug, savePlan, loadPlan } from "../../src/plan/plan-store.js";
import { migrateLanePlans } from "../../src/plan/lane-plans.js";
import { huCommand } from "../../src/commands/hu.js";

let dir, main, lane, prevPlans;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-plans-")));
  main = path.join(dir, "repo");
  fs.mkdirSync(main);
  const git = (...a) => execFileSync("git", ["-C", main, ...a]);
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
  lane = path.join(main, ".kj", "worktrees", "lane");
  git("worktree", "add", "-q", "-b", "feat/lane", lane);
  prevPlans = process.env.KJ_PLANS_DIR;
  process.env.KJ_PLANS_DIR = path.join(dir, "plans");
});
afterEach(() => {
  if (prevPlans === undefined) delete process.env.KJ_PLANS_DIR; else process.env.KJ_PLANS_DIR = prevPlans;
  fs.rmSync(dir, { recursive: true, force: true });
});

const v2 = (planId) => ({ planId, version: 2, hus: [{ id: "HU-1", title: "t", status: "pending" }] });
// A plans folder as a lane wrote it before #2566, under its own slug.
const oldFolder = (name, file, body) => {
  const d = path.join(dir, "plans", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), body);
  return d;
};

describe("plans hang from the main checkout", () => {
  it("plansDir is the same from the root, a lane and a subfolder", () => {
    fs.mkdirSync(path.join(lane, "src"));
    expect(plansDir(lane)).toBe(plansDir(main));
    expect(plansDir(path.join(lane, "src"))).toBe(plansDir(main));
  });

  it("a plan saved from a lane is read from the root, stamped with the main checkout", async () => {
    await savePlan(lane, v2("p1"));
    const plan = await loadPlan(main, "p1");
    expect(plan.projectDir).toBe(main); // the GC must not see it as orphan once the lane is gone
  });
});

describe("migrateLanePlans", () => {
  it("moves a lane's old plans folder into the main checkout's, once", async () => {
    const old = oldFolder(`${projectSlug(main)}_.kj_worktrees_lane`, "p2.json", JSON.stringify({ ...v2("p2"), projectDir: lane }));
    expect((await migrateLanePlans(main)).moved).toEqual(["p2.json"]);
    expect((await loadPlan(main, "p2")).projectDir).toBe(main); // re-stamped: the GC keeps it
    expect(fs.existsSync(old)).toBe(false);
    expect((await migrateLanePlans(main)).moved).toEqual([]);
  });

  it("keeps a colliding plan in place and reports it, never overwrites", async () => {
    await savePlan(main, v2("p3"));
    const old = oldFolder(`${projectSlug(main)}_.claude_worktrees_x`, "p3.json", "{\"stale\":true}");
    const r = await migrateLanePlans(main);
    expect(r.kept).toEqual([path.join(old, "p3.json")]);
    expect((await loadPlan(main, "p3")).stale).toBeUndefined();
  });

  it("kj hu list migrates first and says so in one line", async () => {
    oldFolder(`${projectSlug(main)}_.kj_worktrees_lane`, "p4.json", JSON.stringify(v2("p4")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const rows = await huCommand({ config: { projectDir: lane }, action: "list", deps: { boardConfig: async () => ({ backend: "local" }), who: null } });
    expect(rows.map((r) => r.id)).toEqual(["HU-1"]);
    expect(warn).toHaveBeenCalledWith("plans from lanes: 1 moved to the main checkout");
    vi.restoreAllMocks();
  });

  it("leaves other projects' folders alone", async () => {
    const other = oldFolder("otro_repo_.kj_worktrees_lane", "q.json", "{}");
    await migrateLanePlans(main);
    expect(fs.existsSync(path.join(other, "q.json"))).toBe(true);
  });
});
