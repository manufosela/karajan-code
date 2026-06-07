// PreToolUse hook handler tests (KJC-TSK-0390 commit 2).
import { mkdtemp, readFile, writeFile, lstat, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { describe, it, expect } from "vitest";

import { handleHookPayload } from "../src/hook.js";
import { loadManifest } from "../src/manifest.js";
import { readLog } from "../src/logger.js";

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), "ai-trash-hook-repo-"));
  git(["init", "-q", "-b", "main"], dir);
  git(["config", "user.email", "test@example.invalid"], dir);
  git(["config", "user.name", "Test"], dir);
  await writeFile(join(dir, "README"), "v1");
  git(["add", "README"], dir);
  git(["commit", "-q", "-m", "initial"], dir);
  return dir;
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), "ai-trash-hook-"));
}

function payload(command, extras = {}) {
  return {
    session_id: "sess_test",
    cwd: extras.cwd ?? process.cwd(),
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    ...extras,
  };
}

describe("PreToolUse hook — pass-through cases", () => {
  it("allows non-PreToolUse events untouched", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload(payload("rm a", { hook_event_name: "PostToolUse" }), {
      root,
    });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows non-Bash tools untouched", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "x" },
      },
      { root }
    );
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/not handled/);
  });

  it("allows safe Bash commands (ls, npm install)", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload(payload("ls -la"), { root });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
  });
});

describe("PreToolUse hook — destructive snapshotting", () => {
  it("snapshots an existing file before rm and registers it in the manifest", async () => {
    const root = await makeRoot();
    const dir = await mkdtemp(join(tmpdir(), "ai-trash-hook-src-"));
    const file = join(dir, "doomed.txt");
    await writeFile(file, "irreplaceable");

    const res = await handleHookPayload(payload(`rm ${file}`, { cwd: dir }), { root });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/snapshotted 1 path/);

    const m = await loadManifest(root);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].sourcePath).toBe(file);
    expect(await readFile(m.entries[0].snapshotPath, "utf8")).toBe("irreplaceable");
  });

  it("allows git destructive ops when cwd is not a git repo (no bundle taken)", async () => {
    const root = await makeRoot();
    const notRepo = await mkdtemp(join(tmpdir(), "ai-trash-hook-notrepo-"));
    const res = await handleHookPayload(payload("git reset --hard HEAD~3", { cwd: notRepo }), {
      root,
    });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/not a git repo/);
    const log = await readLog(root);
    expect(log.at(-1).event).toBe("hook.allow");
    expect(log.at(-1).kind).toBe("git-reset-hard");
    expect(log.at(-1).snapshotCount).toBe(0);
  });

  it("snapshots a git bundle before git reset --hard when cwd is a repo", async () => {
    const root = await makeRoot();
    const repo = await makeGitRepo();
    const res = await handleHookPayload(payload("git reset --hard HEAD~1", { cwd: repo }), {
      root,
    });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/git bundle/);
    const m = await loadManifest(root);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].type).toBe("git-bundle");
    const info = await stat(m.entries[0].snapshotPath);
    expect(info.size).toBeGreaterThan(0);
    const log = await readLog(root);
    expect(log.some((e) => e.event === "snapshot.git-bundle")).toBe(true);
  });

  it("skips non-existent paths without failing the hook", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload(payload("rm -f /tmp/does/not/exist.txt"), { root });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    const m = await loadManifest(root);
    expect(m.entries).toHaveLength(0);
  });
});

describe("PreToolUse hook — fail-closed", () => {
  it("denies the op when snapshotting throws (e.g. root not writable)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ai-trash-hook-src-"));
    const file = join(dir, "x.txt");
    await writeFile(file, "data");
    const bogusRoot = join(file, "nested", "root"); // file-as-dir → mkdir -p fails
    const res = await handleHookPayload(payload(`rm ${file}`), { root: bogusRoot });
    expect(res.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/snapshot failed/);
    await expect(lstat(file)).resolves.toBeDefined();
  });
});
