/**
 * `kj harden` — install the quality harness (git hooks) into any repo.
 *
 * Thin CLI layer over harden-engine (KJC-TSK-0555): resolves stack-aware
 * lint/format/test commands, runs the installer and reports. Config files
 * (eslint/prettier) and CI gates land in later slices (H-C / H-D).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "../config.js";
import { resolveTestOnPush } from "../harden/test-on-push.js";
import { compareHarden, formatAdvisoryReport } from "../harden/advisory.js";
import { interactiveHarden } from "../harden/interactive.js";
import { createWizard, isTTY } from "../utils/wizard.js";
import { installConfigsForRoots } from "../harden/config-engine.js";
import { installGuidelines } from "../harden/guidelines-engine.js";
import { commandsForLanguage } from "../harden/hook-commands.js";
import { installHooks } from "../harden/harden-engine.js";
import { installHarnessHooks } from "../harden/harness-hooks.js";
import { installSentinelHooks } from "../harden/sentinel-hooks.js";
import { detectStackRoots } from "../harden/stack-roots.js";
import { installWorkflows } from "../harden/workflow-engine.js";
import { detectTestFramework } from "../utils/project-detect.js";

const JS_TEST_CMD = {
  vitest: "npx vitest run",
  jest: "npx jest",
  mocha: "npx mocha",
};

/**
 * Per-repo harden scope, persisted in package.json `kj.harden` so a repo with
 * sub-tools (e.g. a python wrapper) excludes them once instead of on every
 * invocation (KJC-TSK-0564). CLI flags are merged on top.
 */
function readHardenConfig(projectDir) {
  const pkgPath = join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).kj?.harden ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolve the hook's lint/format/test commands for the primary language.
 * Non-JS stacks use their native toolchain (go/ruff/…); JS/TS is built from
 * the project's own package.json scripts so no npm command is ever assumed.
 */
export async function resolveCmds(projectDir, language) {
  const lang = language ?? detectStackRoots(projectDir)[0]?.language ?? null;
  const cmds = { ...commandsForLanguage(lang) };
  if (lang !== "javascript" && lang !== "typescript") return cmds;

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
    if (framework && JS_TEST_CMD[framework]) cmds.test = JS_TEST_CMD[framework];
  }
  return cmds;
}

export async function hardenCommand({
  projectDir = process.cwd(),
  profile = "standard",
  config = true,
  ci = true,
  guidelines = true,
  mutation = false,
  dryRun = false,
  json = false,
  report = false,
  interactive = false,
  only = [],
  exclude = [],
  logger = console,
} = {}) {
  const repoCfg = readHardenConfig(projectDir);
  const onlyDirs = [...(repoCfg.only ?? []), ...only];
  const excludeDirs = [...(repoCfg.exclude ?? []), ...exclude];

  // --report is read-only: compare against the kj standard and print/emit the
  // advisory (Advisory B, KJC-TSK-0566), honouring the same scope as an install
  // so it never proposes a root that `kj harden` would skip. Writes nothing.
  if (report) {
    const result = compareHarden({ projectDir, profile, only: onlyDirs, exclude: excludeDirs });
    if (json) logger.info?.(JSON.stringify(result));
    else for (const line of formatAdvisoryReport(result)) logger.info?.(line);
    return { ok: true, report: true, ...result };
  }

  // --interactive: adopt the kj standard piece by piece, default-safe (keep the
  // user's own). Only meaningful with a TTY — without one (CI, --json) we fall
  // through to the normal seed-if-absent install so nothing breaks (KJC-TSK-0567).
  if (interactive && isTTY() && !json) {
    const wizard = createWizard();
    try {
      return await interactiveHarden({
        projectDir,
        profile,
        only: onlyDirs,
        exclude: excludeDirs,
        ask: (prompt, def) => wizard.confirm(prompt, def),
        logger,
      });
    } finally {
      wizard.close();
    }
  }

  const roots = detectStackRoots(projectDir, { only: onlyDirs, exclude: excludeDirs });
  const cmds = await resolveCmds(projectDir, roots[0]?.language ?? null);
  // KJC-TSK-0647: CI already running the suite per PR ⇒ pre-push drops its
  // test command (false-red source under local parallelism); opt back in
  // via package.json kj.harden.test_on_push.
  const top = resolveTestOnPush({ projectDir, repoCfg, testCmd: cmds.test });
  if (top.reason) {
    logger.info?.(`kj harden: ${top.reason}`);
    cmds.test = undefined;
  }
  // KJC-TSK-0648: branch-first guard — the base branch only moves via PR.
  // Resolved from the project's kj config (default "main"); best-effort so
  // harden keeps working on repos that never ran kj init.
  let baseBranch = "main";
  try {
    baseBranch = (await loadConfig(projectDir))?.base_branch || "main";
  } catch { /* no kj config — default stands */ }
  let result;
  try {
    result = await installHooks({ projectDir, profile, cmds, dryRun, baseBranch });
    // KJC-TSK-0710 — the TOOL gate: rules imposed at tool time (Claude Code
    // PreToolUse). Standard+ only; minimal stays hooks-lite.
    if (profile !== "minimal" && !dryRun) {
      const hh = installHarnessHooks({ projectDir, logger });
      result.harnessHooks = hh.wired ? "wired" : "script-only";
      // KJC-TSK-0713 — the Sentinel: method state + Stop gate (turn cannot
      // end red). Same Claude-only harness surface as the tool gate.
      const sh = installSentinelHooks({ projectDir, logger });
      result.sentinelHooks = sh.wired ? "wired" : "script-only";
    }
  } catch (err) {
    if (json) logger.info?.(JSON.stringify({ ok: false, error: err.message }));
    else logger.error?.(`kj harden: ${err.message}`);
    return { ok: false, error: err.message };
  }

  // Config (lint/format/commit) ships with standard+, per language root so a
  // fullstack monorepo is hardened on every side, not just one.
  const withConfig = config && profile !== "minimal";
  const cfg = withConfig ? installConfigsForRoots({ projectDir, roots, dryRun }) : null;
  const withCi = ci && profile !== "minimal";
  const wf = withCi
    ? installWorkflows({ projectDir, language: roots[0]?.language ?? null, profile, mutation, dryRun })
    : null;
  const withGuidelines = guidelines && profile !== "minimal";
  const gl = withGuidelines ? installGuidelines({ projectDir, dryRun }) : null;
  const out = {
    ok: true,
    ...result,
    configs: cfg?.configs ?? [],
    workflows: wf?.workflows ?? [],
    guidelines: gl?.guidelines ?? [],
  };

  if (json) {
    logger.info?.(JSON.stringify(out));
    return out;
  }

  const verb = dryRun ? "would install" : "installed";
  logger.info?.(`kj harden (${profile}) — ${verb} ${result.hooks.length} hook(s) → ${result.hooksPath}`);
  for (const h of result.hooks) logger.info?.(`  • ${h.hook}: ${h.action}`);
  for (const c of out.configs) logger.info?.(`  • ${c.file}: ${c.action}`);
  for (const w of out.workflows) logger.info?.(`  • ${w.file}: ${w.action}`);
  for (const g of out.guidelines) logger.info?.(`  • ${g.file}: ${g.action}`);
  if (!dryRun) logger.info?.("core.hooksPath set. Verify later with `kj check`.");
  return out;
}
