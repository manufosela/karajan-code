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
import { commitSupervisorRegeneration } from "../harden/supervisor-commit.js";
import { installConfigsForRoots } from "../harden/config-engine.js";
import { installGuidelines } from "../harden/guidelines-engine.js";
import { maybeRulesyncGenerate } from "../utils/rulesync.js";
import { commandsForLanguage } from "../harden/hook-commands.js";
import { installHooks } from "../harden/harden-engine.js";
import { installHarnessHooks } from "../harden/harness-hooks.js";
import { installSentinelHooks } from "../harden/sentinel-hooks.js";
import { detectStackRoots } from "../harden/stack-roots.js";
import { installWorkflows } from "../harden/workflow-engine.js";
import { detectTestFramework } from "../utils/project-detect.js";
import { ensureIdentity } from "../identity/bootstrap.js";
import { commitContract, contractChanges } from "../environment/contract-commit.js";

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

/**
 * KJC-BUG-0233: loadConfig returns `{ config, ... }`; reading `base_branch` off
 * the result was always undefined, so the guard always protected "main".
 */
export async function resolveBaseBranch(projectDir, load = loadConfig) {
  try {
    return (await load(projectDir))?.config?.base_branch || "main";
  } catch {
    return "main"; // no kj config: the default stands
  }
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
  commitSupervisor = false,
  kjVersion = null,
  // KJC-BUG-0289: the contract files already dirty before anything was generated
  // (kj init captures them before writing its own). What is dirty NOW is the person's.
  contractBefore = null,
  logger = console,
} = {}) {
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
  const baseBranch = await resolveBaseBranch(projectDir);
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
      // KJC-BUG-0193: solo un humano avanza lo que un humano selló. Sin
      // --commit, un guardia sellado se queda como está en lugar de quedarse
      // sin sello, que es como una sesión se dejaba sin herramientas.
      const sh = installSentinelHooks({ projectDir, logger, human: commitSupervisor });
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
    ? installWorkflows({ projectDir, language: roots[0]?.language ?? null, root: roots[0]?.dir ?? ".", profile, mutation, dryRun })
    : null;
  const withGuidelines = guidelines && profile !== "minimal";
  // KJC-BUG-0199 (issue #1773): the same detected language the workflows and
  // the configs already use — a Python project must not be told to use `const`.
  const gl = withGuidelines ? installGuidelines({ projectDir, language: roots[0]?.language ?? null, dryRun }) : null;
  // KJC-TSK-0879: in a Rulesync repo, spread the rules only if the project opted in.
  if (withGuidelines && !dryRun) {
    let kjConfig = null;
    try { kjConfig = (await loadConfig(projectDir))?.config; } catch { /* no kj config: not opted in */ }
    maybeRulesyncGenerate({ projectDir, config: kjConfig, logger });
  }
  const out = {
    ok: true,
    ...result,
    configs: cfg?.configs ?? [],
    workflows: wf?.workflows ?? [],
    guidelines: gl?.guidelines ?? [],
  };
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

  const verb = dryRun ? "would install" : "installed";
  logger.info?.(`kj harden (${profile}) — ${verb} ${result.hooks.length} hook(s) → ${result.hooksPath}`);
  for (const h of result.hooks) logger.info?.(`  • ${h.hook}: ${h.action}`);
  for (const c of out.configs) {
    const note = c.note ? ` (${c.note})` : "";
    logger.info?.(`  • ${c.file}: ${c.action}${note}`);
  }
  for (const w of out.workflows) logger.info?.(`  • ${w.file}: ${w.action}`);
  for (const g of out.guidelines) {
    logger.info?.(`  • ${g.file}: ${g.action}`);
    // KJC-BUG-0206: quitar reglas no puede leerse como "updated" y nada más.
    if (g.shrank) logger.warn?.(`    ⚠ ${g.file} queda con MENOS reglas que antes — revisa si el lenguaje detectado es el que crees (kj check lo dice)`);
    // KJC-BUG-0232: cuales. Si una es tuya, vivia dentro del bloque: va fuera.
    if (g.removed?.length) {
      for (const line of g.removed.slice(0, 10)) logger.warn?.(`      - ${line.length > 120 ? `${line.slice(0, 117)}...` : line}`);
      if (g.removed.length > 10) logger.warn?.(`      (+${g.removed.length - 10} más)`);
      logger.warn?.("      Si alguna es vuestra, estaba dentro del bloque gestionado: recuperadla de git y ponedla fuera de él.");
    }
  }
  if (!dryRun) logger.info?.("core.hooksPath set. Verify later with `kj check`.");
  // IDN-A (KJC-TSK-0762): a hardened clone declares who works it. Captured
  // only with a human confirming; headless runs get the pending command.
  if (!dryRun) {
    const id = await ensureIdentity({ projectDir, logger });
    out.identity = id.declared ? id.identity : null;
    if (id.pending) {
      out.identityPending = id.pending;
      out.identityCommand = id.command;
    }
  }
  // KJC-BUG-0161 / ADR 0009 (opción A): --commit versiona la regeneración
  // del supervisor con procedencia sellada. Acto humano — el guard vive en
  // commitSupervisorRegeneration y rechaza sesiones de agente.
  if (commitSupervisor && !dryRun) {
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
  return out;
}
