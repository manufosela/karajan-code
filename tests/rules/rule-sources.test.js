// KJC-TSK-0942 (MDR-A2, ADR 0016): which MD files govern a session, and the
// rules they hold.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ruleSources, listRules } from "../../src/rules/inventory.js";

describe("ruleSources / listRules", () => {
  let project, home;
  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), "kj_rules.proj-"));
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-rules-home-"));
  });
  afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("reads the project's CLAUDE.md and AGENTS.md, the global CLAUDE.md and the project's feedback memories", () => {
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "- NUNCA hagas push a main.\n");
    fs.writeFileSync(path.join(project, "AGENTS.md"), "- Always run the tests.\n");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "CLAUDE.md"), "- PROHIBIDO usar alert().\n");
    // Claude Code's folder name for the project: every non-alphanumeric char as "-" ("_" and "." included).
    const memory = path.join(home, ".claude", "projects", project.replaceAll(/[^A-Za-z0-9]/g, "-"), "memory");
    fs.mkdirSync(memory, { recursive: true });
    fs.writeFileSync(path.join(memory, "feedback_x.md"), "Nunca escribir hashes de memoria.\n");
    fs.writeFileSync(path.join(memory, "project_y.md"), "Never mind this one.\n");
    const files = ruleSources(project, { home });
    expect(files.map((f) => path.basename(f))).toEqual(["CLAUDE.md", "AGENTS.md", "CLAUDE.md", "feedback_x.md"]);
    const rules = listRules(project, { home });
    expect(rules).toHaveLength(4);
    expect(rules.every((r) => path.isAbsolute(r.file))).toBe(true);
  });

  // HU-4558 (ADR 0063): the repo's CONTRIBUTING.md governs too, the one GitHub shows.
  it("reads the repo's CONTRIBUTING.md, the first of .github/, the root and docs/", () => {
    fs.mkdirSync(path.join(project, "docs"));
    fs.writeFileSync(path.join(project, "docs", "CONTRIBUTING.md"), "- Always sign off every commit.\n");
    expect(ruleSources(project, { home }).map((f) => path.relative(project, f))).toEqual([path.join("docs", "CONTRIBUTING.md")]);
    fs.writeFileSync(path.join(project, "CONTRIBUTING.md"), "- Always squash before merging.\n");
    fs.mkdirSync(path.join(project, ".github"));
    fs.writeFileSync(path.join(project, ".github", "CONTRIBUTING.md"), "- Never mix two changes in one PR.\n");
    expect(ruleSources(project, { home }).map((f) => path.relative(project, f))).toEqual([path.join(".github", "CONTRIBUTING.md")]);
    expect(listRules(project, { home }).map((r) => r.text)).toEqual(["Never mix two changes in one PR."]);
  });

  it("a project with no governing MD file has no rules", () => {
    expect(ruleSources(project, { home })).toEqual([]);
    expect(listRules(project, { home })).toEqual([]);
  });

  // KJC-BUG-0649 (#4703): Claude Code keeps a project's memories under its main checkout's path;
  // a lane has its own path, so reading only the lane's folder made every memory rule stale.
  it("in a lane, reads the main checkout's memories and the lane's own, each file once", () => {
    const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
    git(project, "init", "-q", "-b", "main");
    git(project, "commit", "-q", "--allow-empty", "-m", "base");
    const lane = path.join(project, ".kj", "worktrees", "lane");
    git(project, "worktree", "add", "-q", "-b", "feat/lane", lane);
    const memoryOf = (dir) => path.join(home, ".claude", "projects", fs.realpathSync(dir).replaceAll(/[^A-Za-z0-9]/g, "-"), "memory");
    fs.mkdirSync(memoryOf(project), { recursive: true });
    fs.writeFileSync(path.join(memoryOf(project), "feedback_main.md"), "Nunca commitear en main.\n");
    fs.mkdirSync(memoryOf(lane), { recursive: true });
    fs.writeFileSync(path.join(memoryOf(lane), "feedback_lane.md"), "Never leave a lane dirty.\n");
    expect(ruleSources(lane, { home }).map((f) => path.basename(f))).toEqual(["feedback_main.md", "feedback_lane.md"]);
    expect(ruleSources(project, { home }).map((f) => path.basename(f))).toEqual(["feedback_main.md"]);
  });
});
