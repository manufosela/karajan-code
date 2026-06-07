// PreToolUse hook handler tests (KJC-TSK-0390 commit 2). Drives
// handleHookPayload with synthetic payloads and asserts the response
// shape, snapshot side-effects, audit entries, and fail-closed behaviour.

import { mkdtemp, readFile, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { handleHookPayload } from "../src/hook.js";
import { loadManifest } from "../src/manifest.js";
import { readLog } from "../src/logger.js";

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
    const res = await handleHookPayload(payload("rm a", { hook_event_name: "PostToolUse" }), { root });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("allows non-Bash tools untouched", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload({
      hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "x" },
    }, { root });
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

  it("allows the op even when the destructive command has no paths to snapshot (git reset --hard)", async () => {
    const root = await makeRoot();
    const res = await handleHookPayload(payload("git reset --hard HEAD~3"), { root });
    expect(res.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/no existing paths/);
    const log = await readLog(root);
    expect(log.at(-1).event).toBe("hook.allow");
    expect(log.at(-1).kind).toBe("git-reset-hard");
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
    // Point root at a path that ensureSecureDir cannot create (parent does not exist
    // and the file segment in the middle of the path makes mkdir -p fail).
    const bogusRoot = join(file, "nested", "root");
    const res = await handleHookPayload(payload(`rm ${file}`), { root: bogusRoot });
    expect(res.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(res.hookSpecificOutput.permissionDecisionReason).toMatch(/snapshot failed/);
    await expect(lstat(file)).resolves.toBeDefined();
  });
});
