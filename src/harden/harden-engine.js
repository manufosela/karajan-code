/**
 * harden-engine — installs kj-managed git hooks idempotently (KJC-TSK-0555).
 *
 * Hooks live under `.karajan/hooks/` and are activated via `core.hooksPath`,
 * so harden never fights husky/simple-git-hooks nor touches `.git/hooks/`.
 * Each hook is a shebang + a kj:managed block; re-running is a no-op and any
 * content outside the block is preserved.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { upsertManagedBlock } from "../utils/managed-markers.js";
import { runCommand } from "../utils/process.js";
import { hookBody, PROFILE_HOOKS, SHEBANG } from "./hook-templates.js";

const BLOCK_VERSION = 1;
const HOOKS_DIR = join(".karajan", "hooks");
const HOOK_PREAMBLE = `${SHEBANG}\nset -e\n`;

export function isGitRepo(projectDir) {
  return existsSync(join(projectDir, ".git"));
}

/**
 * KJC-BUG-0161 / ADR 0009: el contenido CANÓNICO de un hook para una
 * generación dada — exactamente lo que installHooks escribiría partiendo
 * de cero. La verificación estructural del supervisor recomputa esto y
 * compara por hash: un fichero con una sola coma manual ya no coincide.
 */
export function renderCanonicalHook(hook, generation = {}) {
  const { cmds = {}, baseBranch = null, globalHooksDir = null } = generation;
  const { content } = upsertManagedBlock({
    source: HOOK_PREAMBLE,
    blockId: `hook:${hook}`,
    version: BLOCK_VERSION,
    body: hookBody(hook, cmds, { globalHooksDir, baseBranch }),
    style: "hash",
  });
  return content;
}

/**
 * Install (or refresh) the profile's hooks under `.karajan/hooks/` and point
 * `core.hooksPath` there. Idempotent. `dryRun` computes actions without
 * touching disk or git config. `cmds` supplies stack-aware lint/format/test
 * commands (npm-script defaults). Returns a per-hook action report.
 */
export async function installHooks({
  projectDir = process.cwd(),
  profile = "standard",
  cmds = {},
  dryRun = false,
  baseBranch = null,
} = {}) {
  if (!isGitRepo(projectDir)) throw new Error(`Not a git repository: ${projectDir}`);
  const hooks = PROFILE_HOOKS[profile];
  if (!hooks) throw new Error(`Unknown harden profile: ${profile}`);

  // KJC-TSK-0645: setting a repo-local hooksPath ECLIPSES the machine's
  // global hooks dir — personal guards (AI-attribution commit-msg, protected
  // branch pre-push) would silently stop applying here. Detect the previous
  // global dir and have every generated hook chain to it. `~` is emitted as
  // `$HOME` so the committed hook stays portable across machines (the -x
  // guard silences it where the dir doesn't exist).
  let globalHooksDir = null;
  const globalCfg = await runCommand("git", ["config", "--global", "core.hooksPath"], { cwd: projectDir });
  const rawGlobal = globalCfg.exitCode === 0 ? globalCfg.stdout.trim() : "";
  if (rawGlobal && rawGlobal !== HOOKS_DIR) {
    globalHooksDir = rawGlobal.startsWith("~") ? `$HOME${rawGlobal.slice(1)}` : rawGlobal;
  }

  const absHooksDir = join(projectDir, HOOKS_DIR);
  const results = [];
  for (const hook of hooks) {
    const target = join(absHooksDir, hook);
    const source = existsSync(target) ? readFileSync(target, "utf8") : HOOK_PREAMBLE;
    const { content, action } = upsertManagedBlock({
      source,
      blockId: `hook:${hook}`,
      version: BLOCK_VERSION,
      body: hookBody(hook, cmds, { globalHooksDir, baseBranch }),
      style: "hash",
    });
    results.push({ hook, target, action });
    if (!dryRun && action !== "unchanged") {
      mkdirSync(absHooksDir, { recursive: true });
      writeFileSync(target, content);
      chmodSync(target, 0o755);
    }
  }

  if (!dryRun) {
    await runCommand("git", ["config", "core.hooksPath", HOOKS_DIR], { cwd: projectDir });
  }

  // KJC-BUG-0161: los parámetros con los que SE GENERÓ — lo que la
  // provenance necesita registrar para que CI pueda recomputar y comparar.
  return { profile, hooksPath: HOOKS_DIR, dryRun, hooks: results, generation: { profile, cmds, baseBranch, globalHooksDir } };
}
