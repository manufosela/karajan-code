// Manifest backing the AI-proof trash bin.
//
// Each entry records a snapshot: a path that was about to be destroyed by
// the AI shell, the snapshot location, its size, the originating command,
// plus a ULID for ordering and a `createdAt` for TTL.
//
// File system layout (resolved by the caller):
//   <root>/manifest.json    — this file's JSON (atomic write via tmp + rename)
//   <root>/store/<ulid>/    — snapshot payloads (commit 4 will write here)
//
// Real file/directory snapshotting lands in commit 4 (KJC-TSK-0388).
// This module deals only with the manifest record-keeping: append, list,
// remove, TTL expiry, and LRU eviction against a byte quota.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { ulid } from "./ulid.js";

const SCHEMA_VERSION = 1;

function emptyManifest() {
  return { schemaVersion: SCHEMA_VERSION, entries: [] };
}

export async function loadManifest(rootDir) {
  const file = join(rootDir, "manifest.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `ai-trash: unsupported manifest schemaVersion ${parsed?.schemaVersion}`
      );
    }
    if (!Array.isArray(parsed.entries)) parsed.entries = [];
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") return emptyManifest();
    throw err;
  }
}

export async function saveManifest(rootDir, manifest) {
  const file = join(rootDir, "manifest.json");
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tmp, file);
}

export function addEntry(manifest, partial) {
  if (!partial?.sourcePath) throw new Error("ai-trash: sourcePath required");
  if (typeof partial.sizeBytes !== "number" || partial.sizeBytes < 0) {
    throw new Error("ai-trash: sizeBytes must be a non-negative number");
  }
  const now = Date.now();
  const entry = {
    id: ulid(now),
    createdAt: now,
    sourcePath: partial.sourcePath,
    snapshotPath: partial.snapshotPath ?? null,
    sizeBytes: partial.sizeBytes,
    command: partial.command ?? null,
    origin: partial.origin ?? "unknown",
  };
  manifest.entries.push(entry);
  return entry;
}

export function listEntries(manifest) {
  return [...manifest.entries].sort((a, b) => a.id.localeCompare(b.id));
}

export function removeEntry(manifest, id) {
  const idx = manifest.entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  return manifest.entries.splice(idx, 1)[0];
}

export function expireBefore(manifest, cutoffMs) {
  const expired = [];
  manifest.entries = manifest.entries.filter((e) => {
    if (e.createdAt < cutoffMs) {
      expired.push(e);
      return false;
    }
    return true;
  });
  return expired;
}

export function enforceLruQuota(manifest, maxBytes) {
  if (typeof maxBytes !== "number" || maxBytes < 0) {
    throw new Error("ai-trash: maxBytes must be a non-negative number");
  }
  const sorted = listEntries(manifest);
  const total = sorted.reduce((sum, e) => sum + e.sizeBytes, 0);
  const evicted = [];
  let running = total;
  for (const entry of sorted) {
    if (running <= maxBytes) break;
    evicted.push(entry);
    running -= entry.sizeBytes;
  }
  const evictedIds = new Set(evicted.map((e) => e.id));
  manifest.entries = manifest.entries.filter((e) => !evictedIds.has(e.id));
  return evicted;
}

export { SCHEMA_VERSION };
