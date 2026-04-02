/**
 * Automatic cleanup of expired sessions.
 *
 * Policy (by status):
 * - failed / stopped: removed after 1 day
 * - approved: removed after 7 days
 * - running (stale): marked failed + removed after 1 day (crash without cleanup)
 * - paused: kept (user may want to resume)
 *
 * Runs automatically at the start of every kj_run (best-effort, non-blocking).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getSessionRoot } from "./utils/paths.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_APPROVED_EXPIRY_DAYS = 7;

function buildPolicy(expiryDays) {
  const approvedMs = (expiryDays ?? DEFAULT_APPROVED_EXPIRY_DAYS) * ONE_DAY_MS;
  return {
    failed:   { expiryMs: ONE_DAY_MS },
    stopped:  { expiryMs: ONE_DAY_MS },
    running:  { expiryMs: ONE_DAY_MS },   // stale — crashed without marking failed
    approved: { expiryMs: approvedMs },
    paused:   null                          // never auto-delete
  };
}

const POLICY = buildPolicy();

function shouldRemove(session, policy = POLICY) {
  const status = session.status || "unknown";
  const entry = policy[status];
  if (!entry) return false;

  const updatedAt = new Date(session.updated_at || session.created_at).getTime();
  return Date.now() - updatedAt > entry.expiryMs;
}

async function tryCleanupSession({ sessionDir, dirName, removed, errors, logger, policy }) {
  const sessionFile = path.join(sessionDir, "session.json");
  let session;
  try {
    const raw = await fs.readFile(sessionFile, "utf8");
    session = JSON.parse(raw);
  } catch {
    // Orphan dir without valid session.json — remove if older than 1 day
    const stat = await fs.stat(sessionDir).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > ONE_DAY_MS) {
      try {
        await fs.rm(sessionDir, { recursive: true, force: true });
        removed.push(dirName);
        logger?.debug?.(`Orphan session dir removed: ${dirName}`);
      } catch (err) {
        errors.push({ session: dirName, error: err.message });
      }
    }
    return;
  }

  if (!shouldRemove(session, policy)) return;

  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
    removed.push(dirName);
    logger?.debug?.(`Session cleaned up: ${dirName} (status: ${session.status})`);
  } catch (err) {
    errors.push({ session: dirName, error: err.message });
  }
}

export async function cleanupExpiredSessions({ logger, config } = {}) {
  const expiryDays = config?.session?.expiry_days;
  const policy = expiryDays ? buildPolicy(expiryDays) : POLICY;
  const sessionRoot = getSessionRoot();

  let entries;
  try {
    entries = await fs.readdir(sessionRoot, { withFileTypes: true });
  } catch { /* session root does not exist */
    return { removed: 0, errors: [] };
  }

  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("s_"));
  const removed = [];
  const errors = [];

  for (const dir of dirs) {
    const sessionDir = path.join(sessionRoot, dir.name);
    await tryCleanupSession({ sessionDir, dirName: dir.name, removed, errors, logger, policy });
  }

  if (removed.length > 0) {
    logger?.info?.(`Cleaned up ${removed.length} expired session(s)`);
  }

  // Truncate oversized project run logs
  const maxLogSizeMb = config?.output?.max_log_size_mb ?? 50;
  await truncateOversizedLog(path.join(process.cwd(), ".kj", "run.log"), maxLogSizeMb, logger);

  return { removed: removed.length, errors };
}

async function truncateOversizedLog(logPath, maxSizeMb, logger) {
  if (maxSizeMb <= 0) return;
  try {
    const stat = await fs.stat(logPath);
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (stat.size > maxBytes) {
      await fs.truncate(logPath, 0);
      logger?.info?.(`Truncated oversized log ${logPath} (was ${(stat.size / 1024 / 1024).toFixed(1)}MB, limit ${maxSizeMb}MB)`);
    }
  } catch { /* file doesn't exist or can't be read */ }
}
