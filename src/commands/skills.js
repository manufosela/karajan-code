/**
 * `kj skills` — manage the local OpenSkills cache and the addyosmani catalog.
 *
 * Subcommands:
 *   - list                  : print cached OpenSkills with their age and freshness.
 *   - clear-cache           : delete all cached metadata (forces re-install on next session).
 *   - sync-addyosmani       : force a git pull of addyosmani/agent-skills.
 *   - list-addyosmani       : enumerate slugs available in the cached catalog.
 */

import { listCached, clearCache, getCacheRoot, DEFAULT_TTL_MS } from "../skills/skills-cache.js";
import { refreshIfStale, listAvailableSlugs, getCatalogRoot, loadSkillBySlug } from "../skills/addyosmani-catalog.js";

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
    case "sync-addyosmani":
      return syncAddyosmaniAction();
    case "list-addyosmani":
      return listAddyosmaniAction();
    default:
      console.error(`Unknown action: ${action}. Use: list | clear-cache | sync-addyosmani | list-addyosmani`);
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

async function syncAddyosmaniAction() {
  console.log("Syncing addyosmani/agent-skills catalog...");
  const logger = { warn: (m) => console.warn(`  warn: ${m}`), info: (m) => console.log(`  ${m}`) };
  const result = await refreshIfStale({ force: true, logger });
  if (!result.ok) {
    console.error(`Sync failed: ${result.error || result.action}`);
    return 1;
  }
  const slugs = await listAvailableSlugs();
  console.log(`${result.action === "cloned" ? "Cloned" : "Pulled"} at ${getCatalogRoot()}`);
  console.log(`Available slugs: ${slugs.length}`);
  return 0;
}

async function listAddyosmaniAction() {
  const slugs = await listAvailableSlugs();
  if (slugs.length === 0) {
    console.log(`No addyosmani catalog found at ${getCatalogRoot()}`);
    console.log("Run `kj skills sync-addyosmani` to bootstrap it.");
    return 0;
  }
  console.log(`addyosmani/agent-skills catalog at ${getCatalogRoot()}\n${slugs.length} slug(s):\n`);
  for (const slug of slugs) {
    const skill = await loadSkillBySlug(slug);
    const desc = skill?.description ? ` — ${skill.description.slice(0, 100)}${skill.description.length > 100 ? "..." : ""}` : "";
    console.log(`  ${slug}${desc}`);
  }
  return 0;
}
