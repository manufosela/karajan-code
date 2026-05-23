// One-shot ~/.kj/ → ~/.karajan/ home consolidation (PR 2 of KJC-PCS-0047).
// Idempotent via `<target>/.kj-migrated.json`. Tarball backup under
// `<target>/backup/`. `plans/`, `standby/`, `worktrees/` are moved
// wholesale; `runs/` is merged with `.karajan/` winning on conflict.
// Cross-device safe. Non-fatal: CLI bootstrap wraps in try/catch.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";

const MARKER = ".kj-migrated.json";
const MOVE_DIRS = ["plans", "standby", "worktrees"];

async function readdirOrNull(dir) {
  try { return await fs.readdir(dir); } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function moveChildren(src, dst, { mergeMode = false } = {}) {
  const children = await readdirOrNull(src);
  if (!children?.length) return 0;
  await fs.mkdir(dst, { recursive: true });
  let n = 0;
  for (const c of children) {
    const dstChild = path.join(dst, c);
    if (mergeMode) {
      try { await fs.access(dstChild); continue; } catch { /* no conflict */ }
    }
    const srcChild = path.join(src, c);
    try { await fs.rename(srcChild, dstChild); } catch (err) {
      if (err.code !== "EXDEV") throw err;
      await fs.cp(srcChild, dstChild, { recursive: true });
      await fs.rm(srcChild, { recursive: true, force: true });
    }
    n += 1;
  }
  await fs.rm(src, { recursive: true, force: true }).catch(() => {});
  return n;
}

export async function migrateKjToKarajan({ dryRun = false, force = false } = {}) {
  // VITEST guard — tests setting KJ_HOME would otherwise migrate against
  // the developer's real HOME. Migrator's own tests pass `force: true`.
  if (process.env.VITEST && !force) return { migrated: false, reason: "vitest-skip" };

  const sourceDir = process.env.KJ_HOME || path.join(os.homedir(), ".kj");
  const targetDir = process.env.KARAJAN_HOME || path.join(os.homedir(), ".karajan");

  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return { migrated: false, reason: "same-path" };
  }
  const entries = await readdirOrNull(sourceDir);
  if (!entries) return { migrated: false, reason: "source-missing" };
  if (entries.length === 0) return { migrated: false, reason: "source-empty" };

  await fs.mkdir(targetDir, { recursive: true });
  const markerPath = path.join(targetDir, MARKER);
  try { await fs.access(markerPath); return { migrated: false, reason: "already-migrated" }; }
  catch { /* not present — proceed */ }

  if (dryRun) return { migrated: false, reason: "dry-run", sourceDir, targetDir };

  const backupDir = path.join(targetDir, "backup");
  await fs.mkdir(backupDir, { recursive: true });
  const ts = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `kj-pre-migration-${ts}.tar.gz`);
  await execa("tar", ["-czf", backupPath, "-C", path.dirname(sourceDir), path.basename(sourceDir)]);

  const counts = {};
  for (const sub of MOVE_DIRS) {
    counts[sub] = await moveChildren(path.join(sourceDir, sub), path.join(targetDir, sub));
  }
  counts.runs = await moveChildren(path.join(sourceDir, "runs"), path.join(targetDir, "runs"), { mergeMode: true });

  const marker = { version: 1, migrated_at: new Date().toISOString(), items_moved: counts, backup_path: backupPath, source_dir: sourceDir, target_dir: targetDir };
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2));

  const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(" + ");
  if (summary) {
    // eslint-disable-next-line no-console
    console.warn(`\x1b[33m[warn]\x1b[0m Migrated ${summary} from ${sourceDir} to ${targetDir} (backup: ${backupPath})`);
  }
  return { migrated: true, counts, backupPath, marker };
}
