import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { ulid } from "./ulid.js";
import { ensureSecureDir, lockdownFile } from "./permissions.js";
import { appendLogEntry } from "./logger.js";

async function statOrNull(path) {
  try {
    return await fs.lstat(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function snapshotFile(rootDir, sourcePath, options = {}) {
  const stat = await statOrNull(sourcePath);
  if (!stat) throw new Error(`ai-trash: source not found: ${sourcePath}`);
  if (stat.isDirectory()) {
    throw new Error("ai-trash: directory snapshots not implemented in MVP");
  }
  const id = ulid();
  const storeDir = join(rootDir, "store", id);
  await ensureSecureDir(storeDir);
  const snapshotPath = join(storeDir, basename(sourcePath));
  await fs.copyFile(sourcePath, snapshotPath);
  await lockdownFile(snapshotPath);
  const entry = {
    id,
    createdAt: Date.now(),
    sourcePath,
    snapshotPath,
    sizeBytes: stat.size,
    command: options.command ?? null,
    origin: options.origin ?? "unknown",
  };
  await appendLogEntry(rootDir, "snapshot.create", {
    id,
    sourcePath,
    snapshotPath,
    sizeBytes: stat.size,
  });
  return entry;
}

export async function restoreSnapshot(rootDir, entry, targetPath) {
  const target = targetPath ?? entry.sourcePath;
  const exists = await statOrNull(target);
  if (exists) throw new Error(`ai-trash: refusing to overwrite ${target}`);
  await fs.mkdir(join(target, ".."), { recursive: true });
  await fs.copyFile(entry.snapshotPath, target);
  await appendLogEntry(rootDir, "snapshot.restore", {
    id: entry.id,
    snapshotPath: entry.snapshotPath,
    targetPath: target,
  });
  return target;
}

export async function purgeSnapshot(rootDir, entry) {
  await fs.rm(join(rootDir, "store", entry.id), { recursive: true, force: true });
  await appendLogEntry(rootDir, "snapshot.purge", {
    id: entry.id,
    sizeBytes: entry.sizeBytes,
  });
}
