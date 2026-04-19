/**
 * `kj skills` — manage the local OpenSkills cache.
 *
 * Subcommands:
 *   - list         : print cached skills with their age and freshness.
 *   - clear-cache  : delete all cached metadata (forces re-install on next session).
 */

import { listCached, clearCache, getCacheRoot, DEFAULT_TTL_MS } from "../skills/skills-cache.js";

function humanAge(cachedAt) {
  const ms = Date.now() - Date.parse(cachedAt);
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const days = ms / (24 * 60 * 60 * 1000);
  if (days < 1) return `${Math.max(1, Math.round(ms / (60 * 60 * 1000)))}h ago`;
  return `${days.toFixed(1)}d ago`;
}

export async function skillsCommand({ action = "list" } = {}) {
  switch (action) {
    case "list":
      return listAction();
    case "clear-cache":
      return clearAction();
    default:
      console.error(`Unknown action: ${action}. Use: list | clear-cache`);
      return 1;
  }
}

async function listAction() {
  const cache = await listCached();
  if (cache.length === 0) {
    console.log(`No cached skills at ${getCacheRoot()}`);
    return 0;
  }
  console.log(`Cached skills (TTL ${Math.round(DEFAULT_TTL_MS / 86400000)}d) at ${getCacheRoot()}:\n`);
  for (const entry of cache) {
    const flag = entry.fresh ? "FRESH" : "STALE";
    console.log(`  ${flag}  ${entry.name}  (${humanAge(entry.cachedAt)})`);
  }
  return 0;
}

async function clearAction() {
  const { removed } = await clearCache();
  console.log(`Cleared ${removed} cached skill${removed === 1 ? "" : "s"} from ${getCacheRoot()}`);
  return 0;
}
