// Claude Code PreToolUse hook (KJC-TSK-0390 commit 2). Reads the JSON
// payload from stdin, classifies the Bash command, snapshots target
// paths, prints the decision JSON on stdout. Fail-closed: if snapshot
// throws, deny the op so Claude never destroys without a recovery copy.

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import { classifyCommand } from "./destructive-parser.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { snapshotFile } from "./snapshot.js";
import { snapshotGitBundle } from "./git-snapshot.js";
import { ensureSecureDir, assertOwnedByCurrentUser } from "./permissions.js";
import { appendLogEntry } from "./logger.js";

function reply(decision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

async function readJsonStdin(stdin) {
  let raw = "";
  for await (const chunk of stdin) raw += chunk;
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

async function snapshotExistingPaths(root, paths, cwd, command) {
  const snapshots = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(cwd ?? process.cwd(), p);
    try {
      const stat = await fs.lstat(abs);
      if (stat.isDirectory()) continue;
      const entry = await snapshotFile(root, abs, { command, origin: "claude-code" });
      snapshots.push(entry);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
  }
  return snapshots;
}

// KJC-BUG-0240 (#1886): the dirty files a whole-tree discard would drop, kept as
// files (a bundle keeps commits only). `which`: "tracked" changes, "untracked"
// files, or "untracked+ignored" (git clean -x/-X removes ignored files too).
async function snapshotDirtyFiles(root, cwd, command, which) {
  if (!cwd) return [];
  const top = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) return [];
  const withIgnored = which === "untracked+ignored";
  // traditional + all: every file inside an ignored directory is listed one by one.
  const st = spawnSync("git", ["-C", cwd, "status", "--porcelain", "-z", "--untracked-files=all", ...(withIgnored ? ["--ignored=traditional"] : [])], { encoding: "utf8" });
  if (st.status !== 0) throw new Error(`git status failed: ${st.stderr.trim()}`);
  const wanted = (rec) => (which === "tracked" ? !rec.startsWith("??") && !rec.startsWith("!!") : rec.startsWith("??") || (withIgnored && rec.startsWith("!!")));
  const files = [];
  let renameSource = false; // a rename or copy record is followed by its source path
  for (const rec of st.stdout.split("\0")) {
    if (renameSource) { renameSource = false; continue; }
    if (rec.length < 4) continue;
    if (wanted(rec)) files.push(rec.slice(3));
    renameSource = "RC".includes(rec[0]);
  }
  return snapshotExistingPaths(root, files, top.stdout.trim(), command);
}

async function snapshotGitRepo(root, cwd, command, kind) {
  if (!cwd) return { snapshots: [], skipped: "no cwd" };
  try {
    const entry = await snapshotGitBundle(root, cwd, {
      command,
      origin: "claude-code",
      label: kind,
    });
    return { snapshots: [entry], skipped: null };
  } catch (err) {
    if (/not a git repo/.test(err.message)) {
      return { snapshots: [], skipped: "cwd is not a git repo" };
    }
    throw err;
  }
}

export async function handleHookPayload(payload, { root, stdin }) {
  const data = payload ?? (await readJsonStdin(stdin));
  if (!data) return reply("allow", "ai-trash: empty payload, deferring");
  if (data.hook_event_name !== "PreToolUse") {
    return reply("allow", `ai-trash: not PreToolUse (${data.hook_event_name})`);
  }
  if (data.tool_name !== "Bash")
    return reply("allow", `ai-trash: tool '${data.tool_name}' not handled`);

  const command = data.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) {
    return reply("allow", "ai-trash: empty Bash command");
  }

  const verdict = classifyCommand(command);
  if (!verdict.destructive) return reply("allow", `ai-trash: ${verdict.kind} (${verdict.reason})`);

  try {
    await ensureSecureDir(root);
    await assertOwnedByCurrentUser(root);
    let snapshots = [];
    let skipped = null;
    if (verdict.bundle) ({ snapshots, skipped } = await snapshotGitRepo(root, data.cwd, command, verdict.kind));
    snapshots.push(...(await snapshotExistingPaths(root, verdict.paths, data.cwd, command)));
    if (verdict.worktree) snapshots.push(...(await snapshotDirtyFiles(root, data.cwd, command, verdict.worktree)));
    if (snapshots.length) {
      const m = await loadManifest(root);
      for (const s of snapshots) m.entries.push(s);
      await saveManifest(root, m);
    }
    await appendLogEntry(root, "hook.allow", {
      kind: verdict.kind,
      command,
      cwd: data.cwd ?? null,
      snapshotCount: snapshots.length,
      sessionId: data.session_id ?? null,
    });
    if (snapshots.length) {
      return reply(
        "allow",
        `ai-trash: snapshotted ${snapshots.length} ${snapshots.some((s) => s.type === "git-bundle") ? "item(s), git bundle included," : "path(s)"} before ${verdict.kind}`
      );
    }
    return reply(
      "allow",
      skipped
        ? `ai-trash: ${verdict.kind} (${skipped})`
        : `ai-trash: ${verdict.kind} (no existing paths to snapshot)`
    );
  } catch (err) {
    try {
      await appendLogEntry(root, "hook.deny", {
        kind: verdict.kind,
        command,
        error: err.message,
        sessionId: data.session_id ?? null,
      });
    } catch {
      /* root unwritable; deny is still the right answer */
    }
    return reply("deny", `ai-trash: snapshot failed (${err.message}); blocking ${verdict.kind}`);
  }
}

export async function runHook({ root, stdin = process.stdin, stdout = process.stdout }) {
  const response = await handleHookPayload(null, { root, stdin, stdout });
  stdout.write(JSON.stringify(response) + "\n");
  return 0;
}
