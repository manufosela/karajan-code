/**
 * Provider-aware role template resolver.
 *
 * Extends the legacy `resolveRoleMdPath()` contract from base-role.js to
 * support per-provider variants without breaking existing consumers.
 *
 * Lookup order (first match wins):
 *
 *   1. <projectDir>/.karajan/roles/{role}/{provider}.md   project override, per provider
 *   2. <projectDir>/.karajan/roles/{role}/default.md      project override, default
 *   3. <projectDir>/.karajan/roles/{role}.md              project override, legacy flat
 *   4. <karajanHome>/roles/{role}/{provider}.md           user home, per provider
 *   5. <karajanHome>/roles/{role}/default.md              user home, default
 *   6. <karajanHome>/roles/{role}.md                      user home, legacy flat
 *   7. <built-in>/templates/roles/{role}/{provider}.md    built-in, per provider
 *   8. <built-in>/templates/roles/{role}/default.md       built-in, default
 *   9. <built-in>/templates/roles/{role}.md               built-in, legacy flat (back-compat)
 *
 * When `provider` is undefined/null the per-provider entries are skipped and
 * only the default + legacy tiers are tried.
 *
 * If a provider is supplied but no per-provider file exists, we emit a
 * one-time `prompt-resolver:fallback` event/log entry so the user knows their
 * config asked for a variant that isn't present.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { getTemplatesRoot } from "../utils/templates-root.js";
import { normalizeProvider } from "../utils/provider-env.js";

/**
 * Compute the full list of candidate file paths for a role template.
 *
 * @param {string} role                - role slug (e.g. "coder")
 * @param {string|null|undefined} provider - provider slug or CLI name;
 *                                           normalized internally
 * @param {string|null|undefined} projectDir
 * @returns {{ perProvider: string[], default: string[], legacy: string[], all: string[], provider: string|null }}
 */
export function resolveRolePromptPaths(role, provider, projectDir) {
  if (!role || typeof role !== "string") {
    throw new Error("resolveRolePromptPaths: role name is required");
  }
  const normalized = provider ? normalizeProvider(provider) : null;
  const canonical = normalized && normalized.length > 0 ? normalized : null;

  const homes = [];
  if (projectDir) homes.push(path.join(projectDir, ".karajan", "roles"));
  homes.push(path.join(getKarajanHome(), "roles"));

  homes.push(path.join(getTemplatesRoot(), "roles"));

  const perProvider = [];
  const defaults = [];
  const legacy = [];

  for (const home of homes) {
    if (canonical) {
      perProvider.push(path.join(home, role, `${canonical}.md`));
    }
    defaults.push(path.join(home, role, "default.md"));
    legacy.push(path.join(home, `${role}.md`));
  }

  // Interleave: for each home, try per-provider first, then default, then
  // legacy. This gives the user's project override precedence over the
  // built-in default even when they only supplied a legacy flat file.
  const all = [];
  for (const home of homes) {
    if (canonical) all.push(path.join(home, role, `${canonical}.md`));
    all.push(path.join(home, role, "default.md"));
    all.push(path.join(home, `${role}.md`));
  }

  return { perProvider, default: defaults, legacy, all, provider: canonical };
}

/**
 * Return the contents of the first existing candidate path. Returns null if
 * no template is found.
 *
 * @param {string[]} paths
 * @returns {Promise<{content: string, path: string}|null>}
 */
export async function readFirstExisting(paths) {
  for (const p of paths) {
    try {
      const content = await fs.readFile(p, "utf8");
      return { content, path: p };
    } catch { /* file not found, keep trying */ }
  }
  return null;
}

/**
 * Load role instructions resolved for a specific provider.
 *
 * @param {Object} args
 * @param {string} args.role
 * @param {string|null|undefined} args.provider
 * @param {string|null|undefined} args.projectDir
 * @param {{ warn?: Function, debug?: Function }} [args.logger]
 * @returns {Promise<{ instructions: string|null, path: string|null, resolvedProvider: string|null, fellBack: boolean }>}
 */
export async function loadRoleInstructions({ role, provider, projectDir, logger } = {}) {
  const { all, provider: canonical } = resolveRolePromptPaths(role, provider, projectDir);
  const hit = await readFirstExisting(all);
  if (!hit) {
    return { instructions: null, path: null, resolvedProvider: canonical, fellBack: !!canonical };
  }
  // Detect fallback: if the user asked for a provider but we matched a path
  // that is NOT a per-provider file, we consider it a fallback and warn.
  const fellBack = !!canonical && !hit.path.endsWith(`${canonical}.md`);
  if (fellBack && logger?.debug) {
    logger.debug(`prompt-resolver: role "${role}" has no "${canonical}" variant, using ${path.basename(hit.path)}`);
  }
  return { instructions: hit.content, path: hit.path, resolvedProvider: canonical, fellBack };
}
