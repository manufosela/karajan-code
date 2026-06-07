// Claude Code PreToolUse hook (KJC-TSK-0390 commit 2). Reads the JSON
// payload from stdin, classifies the Bash command, snapshots target
// paths, prints the decision JSON on stdout. Fail-closed: if snapshot
// throws, deny the op so Claude never destroys without a recovery copy.

import { promises as fs } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { classifyCommand } from "./destructive-parser.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { snapshotFile } from "./snapshot.js";
import { ensureSecureDir, assertOwnedByCurrentUser } from "./permissions.js";
import { appendLogEntry } from "./logger.js";

function reply(decision, reason) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } };
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

export async function handleHookPayload(payload, { root, stdin, stdout }) {
  const data = payload ?? (await readJsonStdin(stdin));
  if (!data) return reply("allow", "ai-trash: empty payload, deferring");
  if (data.hook_event_name !== "PreToolUse") {
    return reply("allow", `ai-trash: not PreToolUse (${data.hook_event_name})`);
  }
  if (data.tool_name !== "Bash") return reply("allow", `ai-trash: tool '${data.tool_name}' not handled`);

  const command = data.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) {
    return reply("allow", "ai-trash: empty Bash command");
  }

  const verdict = classifyCommand(command);
  if (!verdict.destructive) return reply("allow", `ai-trash: ${verdict.kind} (${verdict.reason})`);

  try {
    await ensureSecureDir(root);
    await assertOwnedByCurrentUser(root);
    const snapshots = await snapshotExistingPaths(root, verdict.paths, data.cwd, command);
    if (snapshots.length) {
      const m = await loadManifest(root);
      for (const s of snapshots) m.entries.push(s);
      await saveManifest(root, m);
    }
    await appendLogEntry(root, "hook.allow", { kind: verdict.kind, command, cwd: data.cwd ?? null, snapshotCount: snapshots.length, sessionId: data.session_id ?? null });
    return reply("allow", snapshots.length
      ? `ai-trash: snapshotted ${snapshots.length} path(s) before ${verdict.kind}`
      : `ai-trash: ${verdict.kind} (no existing paths to snapshot)`);
  } catch (err) {
    try { await appendLogEntry(root, "hook.deny", { kind: verdict.kind, command, error: err.message, sessionId: data.session_id ?? null }); }
    catch { /* root unwritable; deny is still the right answer */ }
    return reply("deny", `ai-trash: snapshot failed (${err.message}); blocking ${verdict.kind}`);
  }
}

export async function runHook({ root, stdin = process.stdin, stdout = process.stdout }) {
  const response = await handleHookPayload(null, { root, stdin, stdout });
  stdout.write(JSON.stringify(response) + "\n");
  return 0;
}
