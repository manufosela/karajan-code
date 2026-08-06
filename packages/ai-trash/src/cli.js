import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  loadManifest,
  saveManifest,
  removeEntry,
  expireBefore,
  enforceLruQuota,
} from "./manifest.js";
import { restoreSnapshot, purgeSnapshot } from "./snapshot.js";
import { restoreGitBundle } from "./git-snapshot.js";
import { ensureSecureDir, assertOwnedByCurrentUser } from "./permissions.js";
import { runHook } from "./hook.js";
import { installClaudeCodeHook, DEFAULT_SETTINGS_PATH } from "./install.js";

export const DEFAULT_ROOT = process.env.AI_TRASH_ROOT || join(homedir(), ".ai-trash");

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq > -1) flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[tok.slice(2)] = argv[++i];
      else flags[tok.slice(2)] = true;
    } else positional.push(tok);
  }
  return { positional, flags };
}

function shortAge(ms) {
  const sec = Math.max(1, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

async function ensureRoot(root) {
  await ensureSecureDir(root);
  await assertOwnedByCurrentUser(root);
}

async function cmdList(root, out) {
  await ensureRoot(root);
  const m = await loadManifest(root);
  if (!m.entries.length) {
    out.write("kj-trash: (empty)\n");
    return 0;
  }
  const now = Date.now();
  out.write("ID                          AGE   BYTES  SOURCE\n");
  for (const e of m.entries) {
    out.write(
      `${e.id}  ${shortAge(now - e.createdAt).padStart(4)}  ${String(e.sizeBytes).padStart(5)}  ${e.sourcePath}\n`
    );
  }
  return 0;
}

async function cmdInspect(root, id, out, err) {
  await ensureRoot(root);
  const m = await loadManifest(root);
  const entry = m.entries.find((e) => e.id === id);
  if (!entry) {
    err.write(`kj-trash: no entry with id ${id}\n`);
    return 1;
  }
  out.write(`${JSON.stringify(entry, null, 2)}\n`);
  return 0;
}

async function cmdRestore(root, id, target, out, err) {
  await ensureRoot(root);
  const m = await loadManifest(root);
  const entry = m.entries.find((e) => e.id === id);
  if (!entry) {
    err.write(`kj-trash: no entry with id ${id}\n`);
    return 1;
  }
  if (entry.type === "git-bundle") {
    const res = await restoreGitBundle(root, entry, target);
    out.write(
      `kj-trash: fetched bundle ${id} -> ${res.repo} (${res.refCount} ref(s) at refs/remotes/restore/*)\n`
    );
    return 0;
  }
  const written = await restoreSnapshot(root, entry, target);
  removeEntry(m, id);
  await saveManifest(root, m);
  out.write(`kj-trash: restored ${id} -> ${written}\n`);
  return 0;
}

async function cmdPurge(root, id, out, err) {
  await ensureRoot(root);
  const m = await loadManifest(root);
  const entry = m.entries.find((e) => e.id === id);
  if (!entry) {
    err.write(`kj-trash: no entry with id ${id}\n`);
    return 1;
  }
  await purgeSnapshot(root, entry);
  removeEntry(m, id);
  await saveManifest(root, m);
  out.write(`kj-trash: purged ${id}\n`);
  return 0;
}

async function cmdEmpty(root, flags, out) {
  await ensureRoot(root);
  const m = await loadManifest(root);
  // Assigned in every branch below (the trailing else covers the default),
  // so an initializer would never be read (no-useless-assignment).
  let dropped;
  if (flags["older-than-days"]) {
    const days = Number(flags["older-than-days"]);
    if (!Number.isFinite(days) || days < 0) throw new Error("--older-than-days must be >= 0");
    dropped = expireBefore(m, Date.now() - days * 86400 * 1000);
  } else if (flags["max-bytes"]) {
    const max = Number(flags["max-bytes"]);
    if (!Number.isFinite(max) || max < 0) throw new Error("--max-bytes must be >= 0");
    dropped = enforceLruQuota(m, max);
  } else {
    dropped = m.entries.slice();
    m.entries = [];
  }
  for (const e of dropped) await purgeSnapshot(root, e);
  await saveManifest(root, m);
  out.write(`kj-trash: emptied ${dropped.length} snapshot(s)\n`);
  return 0;
}

const HELP =
  "usage: kj-trash <command> [args]\n" +
  "  list                       list snapshots oldest-first\n" +
  "  inspect <id>               print snapshot metadata as JSON\n" +
  "  restore <id> [--to PATH]   restore a snapshot (default: original path)\n" +
  "  purge <id>                 delete a single snapshot\n" +
  "  empty [--older-than-days N | --max-bytes N]\n" +
  "                             drop all (or filtered) snapshots\n" +
  "  hook                       Claude Code PreToolUse handler (reads JSON\n" +
  "                             on stdin, writes decision JSON on stdout)\n" +
  "  install --claude-code      patch ~/.claude/settings.json (idempotent)\n" +
  "env: AI_TRASH_ROOT (default ~/.ai-trash)\n";

export async function runCli(argv, io = {}) {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  const root = io.root ?? DEFAULT_ROOT;
  const { positional, flags } = parseFlags(argv);
  const [cmd, arg1] = positional;
  switch (cmd) {
    case "list":
      return cmdList(root, out);
    case "inspect":
      if (!arg1) {
        err.write("kj-trash: inspect requires <id>\n");
        return 2;
      }
      return cmdInspect(root, arg1, out, err);
    case "restore":
      if (!arg1) {
        err.write("kj-trash: restore requires <id>\n");
        return 2;
      }
      return cmdRestore(root, arg1, typeof flags.to === "string" ? flags.to : undefined, out, err);
    case "purge":
      if (!arg1) {
        err.write("kj-trash: purge requires <id>\n");
        return 2;
      }
      return cmdPurge(root, arg1, out, err);
    case "empty":
      return cmdEmpty(root, flags, out);
    case "hook":
      return runHook({ root, stdin: io.stdin ?? process.stdin, stdout: out });
    case "install": {
      if (!flags["claude-code"]) {
        err.write("kj-trash: install requires --claude-code\n");
        return 2;
      }
      const path = typeof flags.settings === "string" ? flags.settings : DEFAULT_SETTINGS_PATH;
      const res = await installClaudeCodeHook({ path });
      out.write(`kj-trash: ${res.mutated ? "installed" : "already installed"} -> ${res.path}\n`);
      return 0;
    }
    case "help":
    case "--help":
    case undefined:
      out.write(HELP);
      return cmd ? 0 : 2;
    default:
      err.write(`kj-trash: unknown command '${cmd}'\n${HELP}`);
      return 2;
  }
}
