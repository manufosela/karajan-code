/**
 * `kj harden` — install the quality harness (git hooks) into any repo.
 *
 * Thin CLI layer over harden-engine (KJC-TSK-0555): resolves stack-aware
 * lint/format/test commands, runs the installer and reports. Config files
 * (eslint/prettier) and CI gates land in later slices (H-C / H-D).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { installConfigsForRoots } from "../harden/config-engine.js";
import { installHooks } from "../harden/harden-engine.js";
import { detectStackRoots } from "../harden/stack-roots.js";
import { detectTestFramework } from "../utils/project-detect.js";

const TEST_CMD = {
  vitest: "npx vitest run",
  jest: "npx jest",
  mocha: "npx mocha",
  pytest: "pytest",
};

/** Pick lint/format/test commands from package.json scripts, then by framework. */
export async function resolveCmds(projectDir) {
  const cmds = {};
  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const scripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
      if (scripts.lint) cmds.lint = "npm run -s lint";
      if (scripts["format:check"]) cmds.format = "npm run -s format:check";
      else if (scripts.format) cmds.format = "npm run -s format";
      if (scripts.test) cmds.test = "npm test";
    } catch {
      /* unreadable package.json → fall back to framework detection */
    }
  }
  if (!cmds.test) {
    const { framework } = await detectTestFramework(projectDir);
    if (framework && TEST_CMD[framework]) cmds.test = TEST_CMD[framework];
  }
  return cmds;
}

export async function hardenCommand({
  projectDir = process.cwd(),
  profile = "standard",
  config = true,
  dryRun = false,
  json = false,
  logger = console,
} = {}) {
  const cmds = await resolveCmds(projectDir);
  let result;
  try {
    result = await installHooks({ projectDir, profile, cmds, dryRun });
  } catch (err) {
    if (json) logger.info?.(JSON.stringify({ ok: false, error: err.message }));
    else logger.error?.(`kj harden: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // Config (lint/format/commit) ships with standard+, per language root so a
  // fullstack monorepo is hardened on every side, not just one.
  const withConfig = config && profile !== "minimal";
  const roots = withConfig ? detectStackRoots(projectDir) : [];
  const cfg = withConfig ? installConfigsForRoots({ projectDir, roots, dryRun }) : null;
  const out = { ok: true, ...result, configs: cfg?.configs ?? [] };

  if (json) {
    logger.info?.(JSON.stringify(out));
    return out;
  }

  const verb = dryRun ? "would install" : "installed";
  logger.info?.(`kj harden (${profile}) — ${verb} ${result.hooks.length} hook(s) → ${result.hooksPath}`);
  for (const h of result.hooks) logger.info?.(`  • ${h.hook}: ${h.action}`);
  for (const c of out.configs) logger.info?.(`  • ${c.file}: ${c.action}`);
  if (!dryRun) logger.info?.("core.hooksPath set. Verify later with `kj check` (H-E).");
  return out;
}
