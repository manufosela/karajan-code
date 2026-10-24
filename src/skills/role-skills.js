/**
 * KJC-TSK-1065: the skills kj picks for a role and a task reach the prompt.
 * Before, the addyosmani catalog was resolved and only written to the journal.
 * Order: the project's own skills (.agent/skills and friends), then the local
 * catalog by TASK (a UI task gets frontend-ui-engineering) and by ROLE, up to
 * MAX_SKILLS; the rest are named, never silently lost. The maintainer's
 * choices (2026-10-17): local catalog + project skills, 3 per role.
 * KJC-TSK-1188 (ADR 0021, step 15a): a project with an atril store under
 * .karajan gets its block from atril instead; this path stays until the
 * catalog lives in atril (step 11) and src/skills goes (step 16).
 */
import { loadAvailableSkills, filterSkillsForRole } from "./skill-loader.js";
import { listAvailableSlugs, loadSkillsBySlugs } from "./addyosmani-catalog.js";
import { resolveAddyosmaniSlugs } from "./addyosmani-role-map.js";
import { atrilRoleSkills, hasAtrilStore } from "./atril-skills.js";
import { loadConfig } from "../config/loader.js";

export const MAX_SKILLS = 3;

const defaultDeps = {
  loadLocal: async (projectDir, role) => {
    const all = projectDir ? await loadAvailableSkills(projectDir) : [];
    return role === "coder" ? all : filterSkillsForRole(all, role);
  },
  listCatalog: () => listAvailableSlugs(),
  loadCatalog: (slugs) => loadSkillsBySlugs(slugs),
  hasAtril: (projectDir) => Boolean(projectDir) && hasAtrilStore(projectDir),
  atril: (opts) => atrilRoleSkills(opts),
  maxPerRole: async (projectDir) => (await loadConfig(projectDir)).config.skills?.max_per_role,
};

const noted = new Set();
const noteOnce = (logger, key, msg) => { if (!noted.has(key)) { noted.add(key); logger.info?.(msg); } };

/** @returns {Promise<{skills: Array<{name: string, content: string, path?: string, catalog?: true}>, dropped: string[], limit: number, source: "atril" | "legacy"}>} */
export async function roleSkills({ role, task, projectDir, max, deps = defaultDeps, logger = console }) {
  if (deps.hasAtril?.(projectDir)) {
    const limit = max ?? (await deps.maxPerRole?.(projectDir)) ?? MAX_SKILLS;
    noteOnce(logger, projectDir, `[skills] resolved from the atril store under ${projectDir}/.karajan (up to ${limit} per role)`);
    return { ...deps.atril({ role, task, projectDir, max: limit }), limit, source: "atril" };
  }
  const limit = max ?? MAX_SKILLS;
  return { ...(await legacyRoleSkills({ role, task, projectDir, max: limit, deps })), limit, source: "legacy" };
}

async function legacyRoleSkills({ role, task, projectDir, max, deps }) {
  const local = await deps.loadLocal(projectDir, role);
  const available = new Set(await deps.listCatalog());
  const ordered = [...new Set([...resolveAddyosmaniSlugs({ task }), ...resolveAddyosmaniSlugs({ role })])].filter((s) => available.has(s));
  const room = Math.max(0, max - local.length);
  const catalog = (await deps.loadCatalog(ordered.slice(0, room))).map((s) => ({ name: s.name, content: s.content, path: s.path, catalog: true }));
  const dropped = [...local.slice(max).map((s) => s.name), ...ordered.slice(room)];
  return { skills: [...local.slice(0, max), ...catalog], dropped };
}

/**
 * The prompt section. For claude, the project's skills are native to its
 * runtime, but a catalog skill is not: it is named with the path to read.
 * Other providers get the content inline.
 */
export function buildRoleSkillSection({ skills, dropped, limit = MAX_SKILLS }, { provider } = {}) {
  if (skills.length === 0) return "";
  const lines = ["## Domain Skills", ""];
  if (["claude", "anthropic"].includes(String(provider).toLowerCase())) {
    const native = skills.filter((s) => !s.catalog).map((s) => s.name);
    if (native.length) lines.push(`Skills available natively via your Agent Skills capability: ${native.join(", ")}.`);
    const toRead = skills.filter((s) => s.catalog);
    if (toRead.length) lines.push("Read these skills before you start, and follow them:", ...toRead.map((s) => `- ${s.name}: read ${s.path}`));
  } else {
    lines.push("The following domain-specific knowledge is available for this task:", ...skills.map((s) => `### ${s.name}\n${s.content}`));
  }
  if (dropped.length) lines.push("", `Left out (limit ${limit}): ${dropped.join(", ")}`);
  return lines.join("\n");
}
