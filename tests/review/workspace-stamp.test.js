// KJC-TSK-0680 — the isolation claim becomes auditable: the verdict stamps
// WHERE the review ran (root vs worktree:<name>). If the agent says
// "isolated" and the verdict says workspace: root, the trail talks.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { detectWorkspace } from "../../src/review/workspace.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-ws-"));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.writeFileSync(path.join(dir, "a.js"), "x\n");
  git("add", "a.js"); git("commit", "-qm", "base");
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("detectWorkspace", () => {
  it("reports root from the main working tree", async () => {
    expect(await detectWorkspace(dir)).toBe("root");
  });

  it("reports worktree:<name> from a linked worktree", async () => {
    const wt = path.join(dir, ".kj", "worktrees", "mi-carril");
    execFileSync("git", ["-C", dir, "worktree", "add", "-b", "feat/mi-carril", wt]);
    expect(await detectWorkspace(wt)).toBe("worktree:mi-carril");
  });

  it("returns null outside a git repo", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "kj-ws-plain-"));
    try {
      expect(await detectWorkspace(plain)).toBeNull();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
