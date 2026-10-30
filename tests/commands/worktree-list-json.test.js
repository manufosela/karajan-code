// KJC-TSK-1313: `kj worktree list --json` is what the HU Board paints on each card: every lane
// with its commits ahead of the base and the cards its branch names (by id or by reference).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { worktreeCommand } from "../../src/commands/worktree.js";
import { plansDir } from "../../src/plan/plan-store.js";

let dir, savedPlans, logSpy;
const g = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args]).toString().trim();
const run = (action, slug, flags = {}) => worktreeCommand({ config: { projectDir: dir }, action, args: slug ? [slug] : [], flags });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-wt-json-")));
  savedPlans = process.env.KJ_PLANS_DIR;
  process.env.KJ_PLANS_DIR = path.join(dir, ".plans");
  g(dir, "init", "-q", "-b", "main");
  g(dir, "config", "user.email", "t@t"); g(dir, "config", "user.name", "t");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".plans/\n.kj/\n");
  g(dir, "add", ".gitignore"); g(dir, "commit", "-qm", "base");
  g(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  fs.mkdirSync(plansDir(dir), { recursive: true });
  const hus = [
    { id: "HU-27", title: "by id" },
    { id: "HU-30", title: "by ref", external_ref: "KJC-TSK-1313 · owner/repo#30" },
    { id: "HU-31", title: "no lane" },
  ];
  fs.writeFileSync(path.join(plansDir(dir), "plan-x.json"), JSON.stringify({ version: 2, planId: "plan-x", projectDir: dir, hus }));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  if (savedPlans === undefined) delete process.env.KJ_PLANS_DIR; else process.env.KJ_PLANS_DIR = savedPlans;
  logSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("kj worktree list --json", () => {
  it("prints each lane with its commits ahead of origin/main and the cards its branch names", async () => {
    const a = await run("start", "HU-27-fix");
    await run("start", "KJC-TSK-1313-board");
    fs.writeFileSync(path.join(a.path, "x.js"), "x\n");
    g(a.path, "add", "x.js"); g(a.path, "commit", "-qm", "x");

    const rows = await run("list", null, { json: true });
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug["HU-27-fix"]).toMatchObject({ branch: "feat/HU-27-fix", ahead: 1, cards: ["HU-27"] });
    expect(bySlug["KJC-TSK-1313-board"]).toMatchObject({ ahead: 0, cards: ["HU-30"] });
    expect(JSON.parse(logSpy.mock.calls.at(-1)[0])).toEqual(rows);
  });

  it("prints an empty array when there are no lanes", async () => {
    expect(await run("list", null, { json: true })).toEqual([]);
    expect(logSpy.mock.calls.at(-1)[0]).toBe("[]");
  });
});
