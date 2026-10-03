// KJC-TSK-0917 (SNT-C, ADR 0014): the method's reminders, delivered at the
// moment of the action instead of trusting the agent to recall its md files.
// Always AFTER an action (PostToolUse) that precedes the one the rule is about:
// a PreToolUse reminder would need permissionDecision "allow", which skips the
// user's permission prompt.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execSync } from "node:child_process";
import { remindersFor } from "../../src/harden/sentinel/sentinel-reminders.mjs";
import { installSentinelHooks } from "../../src/harden/sentinel-hooks.js";

const ids = (cmd, opts) => remindersFor(cmd, opts).map((r) => r.id);

describe("remindersFor", () => {
  it("after staging, before the commit: message limits, no attribution, commitlint, stage by name", () => {
    const [r] = remindersFor("git add src/a.js tests/a.test.js");
    expect(r.id).toBe("commit");
    for (const word of ["100", "commitlint", "git add -A"]) expect(r.say).toContain(word);
  });

  it("after a gh without an explicit account switch, and not with one", () => {
    expect(ids("gh pr list")).toEqual(["gh-account"]);
    expect(ids("gh auth switch --user someone && gh pr list")).toEqual([]);
  });

  it("after opening a PR, before any merge: split the card if it is unfinished", () => {
    expect(ids("gh auth switch --user someone && gh pr create --base main --title x --body-file /tmp/b.md")).toEqual(["merge"]);
  });

  it("after syncing main: create the next branch now", () => {
    expect(ids("git checkout -B main origin/main")).toEqual(["sync-main"]);
    expect(ids("git switch main && git pull")).toEqual(["sync-main"]);
  });

  it("stays quiet for everything else", () => {
    for (const cmd of ["ls", "git status", "echo commit", "npm test", "git log --grep=add", "git checkout -b feat/x"]) expect(ids(cmd), cmd).toEqual([]);
  });

  it("does not repeat a reminder within `every` actions, and repeats it after", () => {
    const seen = { commit: 10 };
    expect(ids("git add a.js", { seen, step: 20, every: 25 })).toEqual([]);
    expect(ids("git add a.js", { seen, step: 36, every: 25 })).toEqual(["commit"]);
  });
});

describe("delivered by the PostToolUse hook", () => {
  it("injects the reminder as additionalContext after git add, once, and never blocks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-reminders-"));
    try {
      execSync("git init -q -b main", { cwd: dir });
      installSentinelHooks({ projectDir: dir });
      const post = path.join(dir, ".karajan", "harness", "posttooluse.mjs");
      const run = () => spawnSync("node", [post], { input: JSON.stringify({ session_id: "s1", tool_name: "Bash", tool_input: { command: "git add a.js" }, tool_response: { stdout: "" } }), encoding: "utf8", cwd: dir });
      const first = run();
      expect(first.status).toBe(0);
      expect(JSON.parse(first.stdout).hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse", additionalContext: expect.stringContaining("commitlint") });
      expect(run().stdout).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
