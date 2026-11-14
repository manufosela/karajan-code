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
import { resolveBaseBranch as resolveBase } from "../config/base-branch.js";
import { resolveTestOnPush } from "../harden/test-on-push.js";
import { compareHarden, formatAdvisoryReport } from "../harden/advisory.js";
import { interactiveHarden } from "../harden/interactive.js";
import { createWizard, isTTY } from "../utils/wizard.js";
import { commitSupervisorRegeneration } from "../harden/supervisor-commit.js";
import { installConfigsForRoots } from "../harden/config-engine.js";
import { readHardenConfig } from "../harden/harden-scope.js";
import { installGuidelines } from "../harden/guidelines-engine.js";
import { commitConventionOf } from "../gates/summary.js";
import { detectRulesync, maybeRulesyncGenerate } from "../utils/rulesync.js";
import { installGeminiContext } from "../harden/gemini-context.js";
import { commandsForLanguage } from "../harden/hook-commands.js";
import { makefileCommands } from "../harden/makefile-targets.js";
import { HOOK_STEPS, pinnedCommands } from "../harden/pinned-commands.js";
import { installHooks } from "../harden/harden-engine.js";
import { installHarnessHooks } from "../harden/harness-hooks.js";
import { installSentinelHooks } from "../harden/sentinel-hooks.js";
import { installTransversalWiring, isTransversalParent, uninstallTransversalWiring } from "../harden/transversal-install.js";
import { installSandbox } from "../harden/sandbox.js";
import { detectStackRoots } from "../harden/stack-roots.js";
import { detectPackageManager, installWorkflows, resolveKjPin } from "../harden/workflow-engine.js";
import { adviseBranchProtection } from "../harden/branch-protection.js";
import { adviseEventPolicy } from "../harden/event-policy.js";
import { detectTestFramework } from "../utils/project-detect.js";
import { ensureIdentity } from "../identity/bootstrap.js";
import { commitContract, contractChanges } from "../environment/contract-commit.js";

// How each package manager runs a package.json script in a hook (`bun test` is bun's own runner, not the script).
const HOOK_RUNNERS = {
  npm: { run: (s) => `npm run -s ${s}`, test: "npm test" },
  pnpm: { run: (s) => `pnpm run -s ${s}`, test: "pnpm test" },
  yarn: { run: (s) => `yarn run ${s}`, test: "yarn test" },
  bun: { run: (s) => `bun run ${s}`, test: "bun run test" },
};

const JS_TEST_CMD = {
  vitest: "npx vitest run",
  jest: "npx jest",
  mocha: "npx mocha",
};

/**
 * Resolve the hook's lint/format/test commands for the primary language.
 * Non-JS stacks use their native toolchain (go/ruff/…); JS/TS is built from
 * the project's own package.json scripts so no npm command is ever assumed.
 */
export async function resolveCmds(projectDir, language, scope = {}) {
  // HU-3521: the fallback detection takes the same --only/--exclude as the run, or an excluded root comes back.
  const lang = language ?? detectStackRoots(projectDir, scope)[0]?.language ?? null;
  const cmds = commandsForLanguage(lang, projectDir);
  if (lang !== "javascript" && lang !== "typescript") return withMakefileTargets(cmds, projectDir);

  const pkgPath = join(projectDir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const scripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
      // KJC-BUG-0450 (#2789): the project's own package manager, as the workflows use it.
      const pm = HOOK_RUNNERS[detectPackageManager(projectDir)] ?? HOOK_RUNNERS.npm;
      if (scripts.lint) cmds.lint = pm.run("lint");
      if (scripts["format:check"]) cmds.format = pm.run("format:check");
      else if (scripts.format) cmds.format = pm.run("format");
      if (scripts.test) cmds.test = pm.test;
    } catch {
      /* unreadable package.json → fall back to framework detection */
    }
  }
  if (!cmds.test) {
    const { framework } = await detectTestFramework(projectDir);
    if (framework && JS_TEST_CMD[framework]) cmds.test = JS_TEST_CMD[framework];
  }
  return withMakefileTargets(cmds, projectDir);
}

/** ADR 0051 (#3763): the project's Makefile targets win over the commands detected for its stack. */
const withMakefileTargets = (cmds, projectDir) => ({ ...cmds, ...makefileCommands(projectDir) });

/** The hook commands; HU-4036: per stack root, from its dir, unless the top is the only root (or none). A `kj hooks set` pin wins repo-wide. */
export async function resolveHookCmds(projectDir, roots, scope = {}) {
  const pinned = await pinnedCommands(projectDir);
  if (roots.every((r) => r.dir === ".")) return { ...(await resolveCmds(projectDir, roots[0]?.language ?? null, scope)), ...pinned };
  const perRoot = await Promise.all(roots.map(async ({ dir, language }) => {
    const found = await resolveCmds(join(projectDir, dir), language);
    const steps = Object.fromEntries(HOOK_STEPS.filter((s) => found[s] && !pinned[s]).map((s) => [s, found[s]]));
    return { dir, language, ...steps, ...(found.testNote && { testNote: found.testNote }) };
  }));
  return { ...pinned, roots: perRoot };
}

/**
 * KJC-BUG-0538 (#3763): the commit convention kj resolves for the project (its kj config and
 * history), written into commit-msg so the hook keeps it when kj is not on the PATH.
 */
export async function resolveCommitConvention(projectDir, load = loadConfig) {
  let config = null;
  try {
    config = (await load(projectDir))?.config ?? null;
  } catch {
    /* no kj config: the convention comes from the project's own signals */
  }
  return commitConventionOf({ config, projectDir });
}

/** HU-4268: the resolver lives in config/base-branch.js (same behaviour); the positional signature stays. */
export const resolveBaseBranch = (projectDir, load = loadConfig, logger = {}) => resolveBase(projectDir, { load, logger });

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
  commitSupervisor = false,
  sandbox = false,
  kjVersion = null,
  // KJC-BUG-0289: the contract files already dirty before anything was generated
  // (kj init captures them before writing its own). What is dirty NOW is the person's.
  contractBefore = null,
  fetchFn = fetch,
  uninstallTransversal = false,
  logger = console,
} = {}) {
  const transversal = hardenTransversal({ projectDir, uninstallTransversal, dryRun, logger });
  if (transversal) return transversal;
  const dirtyBefore = contractBefore ?? contractChanges(projectDir);
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
  const cmds = await resolveHookCmds(projectDir, roots, { only: onlyDirs, exclude: excludeDirs });
  // KJC-TSK-0647: CI already running the suite per PR ⇒ pre-push drops its
  // test command (false-red source under local parallelism); opt back in
  // via package.json kj.harden.test_on_push.
  const top = resolveTestOnPush({ projectDir, repoCfg, testCmd: cmds.test ?? cmds.roots?.find((r) => r.test)?.test });
  if (top.reason) {
    logger.info?.(`kj harden: ${top.reason}`);
    cmds.test = undefined;
    for (const root of cmds.roots ?? []) delete root.test;
    cmds.testSkippedByCi = true;
  }
  // KJC-TSK-0648: branch-first guard — the base branch only moves via PR.
  // Resolved from the project's kj config (default "main"); best-effort so
  // harden keeps working on repos that never ran kj init.
  const baseBranch = await resolveBaseBranch(projectDir, loadConfig, logger);
  const commitConvention = await resolveCommitConvention(projectDir);
  let result;
  try {
    result = await installSupervisor({ projectDir, profile, cmds, dryRun, baseBranch, commitConvention, commitSupervisor, sandbox, logger });
  } catch (err) {
    if (json) logger.info?.(JSON.stringify({ ok: false, error: err.message }));
    else logger.error?.(`kj harden: ${err.message}`);
    return { ok: false, error: err.message };
  }
  const out = { ok: true, ...result, ...(await installExtras({ projectDir, roots, profile, config, ci, guidelines, mutation, dryRun, fetchFn, logger, baseBranch })) };
  // KJC-BUG-0289 (#1984): what kj harden generates, kj commits (KJC-BUG-0273's
  // path): only that, never on the base branch. Left to the agent, 3.2k generated
  // lines exceeded its own PR size and stayed untracked. The seal (--commit, ADR
  // 0009) stays a human act over the supervisor alone.
  if (!dryRun) {
    out.contract = commitContract({ projectDir, before: dirtyBefore, baseBranch });
    if (out.contract.committed) logger.info?.(`kj harden: contract committed by kj, ${out.contract.files.length} generated file(s)`);
    else if (!out.contract.reason.startsWith("nothing")) logger.warn?.(`kj harden: the contract kj generated is NOT committed (${out.contract.reason})`);
  }

  if (json) {
    logger.info?.(JSON.stringify(out));
    return out;
  }

  printHardenSummary({ out, result, profile, dryRun, logger });
  if (!dryRun) await afterInstall({ out, result, projectDir, profile, commitSupervisor, kjVersion, logger });
  return out;
}

/** ADR 0055 step 4: a marked transversal parent gets only the hook wiring. null = not one, carry on. */
function hardenTransversal({ projectDir, uninstallTransversal, dryRun, logger }) {
  const parent = isTransversalParent(projectDir);
  if (!parent && !uninstallTransversal) return null;
  if (!parent) {
    const error = `--uninstall-transversal solo vale en un padre marcado con .claude-transversal (no ${projectDir})`;
    logger.error?.(`kj harden: ${error}`);
    return { ok: false, error };
  }
  if (dryRun) {
    logger.info?.(`kj harden (dry-run): padre transversal, ${uninstallTransversal ? "retiraría" : "cablearía"} los hooks de kj en .claude/settings.local.json`);
    return { ok: true, transversal: true, dryRun: true };
  }
  return (uninstallTransversal ? uninstallTransversalWiring : installTransversalWiring)({ parent: projectDir, logger });
}

/** The git hooks and, from standard up, the tool gate, the Sentinel and the optional sandbox. */
async function installSupervisor({ projectDir, profile, cmds, dryRun, baseBranch, commitConvention, commitSupervisor, sandbox, logger }) {
  const result = await installHooks({ projectDir, profile, cmds, dryRun, baseBranch, commitConvention });
  // KJC-TSK-0710 — the TOOL gate: rules imposed at tool time (Claude Code
  // PreToolUse). Standard+ only; minimal stays hooks-lite.
  if (profile === "minimal" || dryRun) return result;
  const hh = installHarnessHooks({ projectDir, logger });
  result.harnessHooks = hh.wired ? "wired" : "script-only";
  // KJC-TSK-0713 — the Sentinel: method state + Stop gate (turn cannot
  // end red). Same Claude-only harness surface as the tool gate.
  // KJC-BUG-0193: solo un humano avanza lo que un humano selló. Sin
  // --commit, un guardia sellado se queda como está en lugar de quedarse
  // sin sello, que es como una sesión se dejaba sin herramientas.
  const sh = installSentinelHooks({ projectDir, logger, human: commitSupervisor });
  result.sentinelHooks = sh.wired ? "wired" : "script-only";
  // KJC-TSK-1092/1241: the host sandbox, only when asked (kj harden --sandbox):
  // inside it kj run cannot push, open the PR or reach Sonar on localhost.
  if (sandbox) result.sandbox = installSandbox({ projectDir, logger }).state;
  return result;
}

/** Gemini CLI reads AGENTS.md only when its settings say so; Rulesync writes its own agent files. */
const geminiContext = (projectDir, dryRun) => (detectRulesync(projectDir) ? [] : [installGeminiContext({ projectDir, dryRun })]);

/** Configs, workflows and guidelines (standard+), with the language detected for the first root. */
async function installExtras({ projectDir, roots, profile, config, ci, guidelines, mutation, dryRun, fetchFn, logger, baseBranch }) {
  const full = profile !== "minimal";
  const language = roots[0]?.language ?? null;
  // Config (lint/format/commit) ships with standard+, per language root so a
  // fullstack monorepo is hardened on every side, not just one.
  const cfg = config && full ? installConfigsForRoots({ projectDir, roots, dryRun }) : null;
  // KJC-BUG-0420: consumer CI installs kj from npm, so the workflows pin a published version.
  const pin = ci && full ? await resolveKjPin({ projectDir, fetchFn }) : null;
  if (pin?.note) logger.warn?.(`⚠ ${pin.note}`);
  const wf = ci && full ? installWorkflows({ projectDir, language, roots, profile, mutation, dryRun, kjVersion: pin?.version ?? null, baseBranch }) : null;
  const withGuidelines = guidelines && full;
  // KJC-BUG-0199 (issue #1773): the same detected language the workflows and
  // the configs already use — a Python project must not be told to use `const`.
  let kjConfig = null;
  if (withGuidelines) {
    try { kjConfig = (await loadConfig(projectDir))?.config; } catch { /* no kj config: not opted in */ }
  }
  // KJC-BUG-0510: the guidelines name the commit convention the project really uses.
  const commitConvention = withGuidelines ? commitConventionOf({ config: kjConfig, projectDir }) : undefined;
  const gl = withGuidelines ? installGuidelines({ projectDir, language, dryRun, commitConvention }) : null;
  // KJC-TSK-1504: with the guidelines, Gemini CLI is told to read AGENTS.md (skipped without them).
  gl?.guidelines.push(...geminiContext(projectDir, dryRun));
  // KJC-TSK-0879: in a Rulesync repo, spread the rules only if the project opted in.
  if (withGuidelines && !dryRun) {
    maybeRulesyncGenerate({ projectDir, config: kjConfig, logger });
  }
  return { configs: cfg?.configs ?? [], workflows: wf?.workflows ?? [], guidelines: gl?.guidelines ?? [], migrated: gl?.migrated ?? [] };
}

/** KJC-TSK-1257: what was installed, file by file, in the order it always had. */
function printHardenSummary({ out, result, profile, dryRun, logger }) {
  const verb = dryRun ? "would install" : "installed";
  logger.info?.(`kj harden (${profile}) — ${verb} ${result.hooks.length} hook(s) → ${result.hooksPath}`);
  for (const h of result.hooks) logger.info?.(`  • ${h.hook}: ${h.action}`);
  for (const c of out.configs) {
    const note = c.note ? ` (${c.note})` : "";
    logger.info?.(`  • ${c.file}: ${c.action}${note}`);
  }
  for (const w of out.workflows) {
    logger.info?.(`  • ${w.file}: ${w.action}`);
    if (w.note) logger.warn?.(`⚠ ${w.note}`);
  }
  for (const g of out.guidelines) printGuideline(g, logger);
  // KJC-TSK-1504: an old agent file is gone; say where its words went.
  for (const m of out.migrated ?? []) logger.info?.(`  • ${m.file}: ${dryRun ? "would move" : "moved"} into AGENTS.md (${m.moved} paragraph(s) written by hand)`);
  if (!dryRun) logger.info?.("core.hooksPath set. Verify later with `kj check`.");
}

function printGuideline(g, logger) {
  logger.info?.(`  • ${g.file}: ${g.action}`);
  if (g.note) logger.warn?.(`    ⚠ ${g.note}`);
  // KJC-BUG-0206: quitar reglas no puede leerse como "updated" y nada más.
  if (g.shrank) logger.warn?.(`    ⚠ ${g.file} queda con MENOS reglas que antes — revisa si el lenguaje detectado es el que crees (kj check lo dice)`);
  // KJC-BUG-0232: cuales. Si una es tuya, vivia dentro del bloque: va fuera.
  if (!g.removed?.length) return;
  for (const line of g.removed.slice(0, 10)) logger.warn?.(`      - ${line.length > 120 ? `${line.slice(0, 117)}...` : line}`);
  if (g.removed.length > 10) logger.warn?.(`      (+${g.removed.length - 10} más)`);
  logger.warn?.("      Si alguna es vuestra, estaba dentro del bloque gestionado: recuperadla de git y ponedla fuera de él.");
}

/** After a real install: who works the clone, the branch protection advice and, if asked, the human seal. */
async function afterInstall({ out, result, projectDir, profile, commitSupervisor, kjVersion, logger }) {
  // IDN-A (KJC-TSK-0762): a hardened clone declares who works it. Captured
  // only with a human confirming; headless runs get the pending command.
  const id = await ensureIdentity({ projectDir, logger });
  out.identity = id.declared ? id.identity : null;
  if (id.pending) {
    out.identityPending = id.pending;
    out.identityCommand = id.command;
  }
  // KJC-TSK-0928: the method's checks only stop a merge with branch protection; kj says the exact command.
  out.branchProtection = await adviseBranchProtection({ projectDir, branch: await resolveBaseBranch(projectDir), logger });
  // KJC-BUG-0532: public repos need an Actions event policy allowing pull_request_target (admin act).
  out.eventPolicy = await adviseEventPolicy({ projectDir, logger });
  // KJC-BUG-0161 / ADR 0009 (opción A): --commit versiona la regeneración
  // del supervisor con procedencia sellada. Acto humano — el guard vive en
  // commitSupervisorRegeneration y rechaza sesiones de agente.
  if (!commitSupervisor) return;
  try {
    out.supervisorCommit = await commitSupervisorRegeneration({
      projectDir,
      kjVersion: kjVersion ?? "unknown",
      generation: result.generation ?? { profile },
      logger,
    });
  } catch (err) {
    // Fallar ALTO (catch de codex): un --commit que no commitea no puede
    // devolver ok — quien lo pidió debe verlo, no descubrirlo después.
    logger.error?.(`kj harden: ${err.message}`);
    out.supervisorCommit = { committed: false, reason: err.message };
    out.ok = false;
  }
}
