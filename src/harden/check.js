/**
 * checkHarden — verify the quality harness installed by `kj harden`
 * (KJC-TSK-0558). Detects drift: a deleted hook, a hook that lost its kj
 * marker or its executable bit, or a core.hooksPath that no longer points at
 * `.karajan/hooks`. Returns a per-check report; the CLI maps it to exit 0/≠0.
 *
 * Config, workflow and language-advisory checks land in the next slice.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { runCommand } from "../utils/process.js";
import { configLeftAlone } from "./config-engine.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";
import { readHardenConfig } from "./harden-scope.js";
import { PROFILE_HOOKS } from "./hook-templates.js";
import { detectStackRoots } from "./stack-roots.js";
import { ownTestWorkflow } from "./test-on-push.js";
import { qualityWorkflowFor, WORKFLOWS } from "./workflow-templates.js";

const HOOKS_DIR = join(".karajan", "hooks");
const WORKFLOWS_DIR = join(".github", "workflows");

/** A config/workflow file just needs to be present (it may be user-owned). */
function presence(projectDir, rel, id, miss) {
  const ok = existsSync(join(projectDir, rel));
  return { id, ok, detail: ok ? "ok" : miss };
}

/** The first thing wrong with one installed hook, or "ok". */
function hookDetail(exists, executable, marked) {
  if (!exists) return "missing";
  if (!executable) return "not executable";
  return marked ? "ok" : "no kj marker";
}

function hookCheck(projectDir, hook) {
  const target = join(projectDir, HOOKS_DIR, hook);
  const exists = existsSync(target);
  const executable = exists && (statSync(target).mode & 0o100) !== 0;
  const marked = exists && readFileSync(target, "utf8").includes(`kj:managed:hook:${hook}`);
  return { id: `hook:${hook}`, ok: exists && executable && marked, detail: hookDetail(exists, executable, marked) };
}

// KJC-BUG-0370: the same verdict on a missing config as kj harden, so check never calls drift what harden leaves alone.
function configCheck(projectDir, cfg, rel, altDirs, missing) {
  const leftAlone = existsSync(join(projectDir, rel)) ? null : configLeftAlone(cfg, altDirs);
  if (!leftAlone) return presence(projectDir, rel, `config:${rel}`, missing);
  const detail = leftAlone.action === "covered" ? `covered by ${leftAlone.by}` : `omitted: ${leftAlone.note}`;
  return { id: `config:${rel}`, ok: true, detail };
}

function configChecks(projectDir, roots) {
  const checks = UNIVERSAL_CONFIGS.map((cfg) => configCheck(projectDir, cfg, cfg.file, [projectDir], "missing — run kj harden"));
  for (const { dir, language } of roots) {
    const rootDir = dir === "." ? projectDir : join(projectDir, dir);
    for (const cfg of CONFIGS_BY_LANGUAGE[language] ?? []) {
      const rel = dir === "." ? cfg.file : join(dir, cfg.file);
      checks.push(configCheck(projectDir, cfg, rel, [rootDir, projectDir], `missing for ${language} — run kj harden`));
    }
  }
  return checks;
}

function workflowChecks(projectDir, roots) {
  const expectedWf = [...WORKFLOWS];
  // HU-4621 (ADR 0065): a repo whose own CI runs its tests has no kj-quality to miss.
  const quality = ownTestWorkflow(projectDir) ? null : qualityWorkflowFor(roots[0]?.language ?? null);
  if (quality) expectedWf.push(quality);
  return expectedWf.map((wf) => presence(projectDir, join(WORKFLOWS_DIR, wf.file), `workflow:${wf.file}`, "missing — run kj harden"));
}

export async function checkHarden({ projectDir = process.cwd(), profile = "standard" } = {}) {
  const checks = [];

  const res = await runCommand("git", ["config", "--local", "core.hooksPath"], { cwd: projectDir });
  const hooksPath = (res.stdout ?? "").trim();
  checks.push({
    id: "core.hooksPath",
    ok: hooksPath === HOOKS_DIR,
    detail: hooksPath === HOOKS_DIR ? "ok" : hooksPath || "(unset) — run kj harden",
  });

  for (const hook of PROFILE_HOOKS[profile] ?? []) checks.push(hookCheck(projectDir, hook));

  // Config + workflows ship with standard+ — and surface the greenfield gap:
  // a language now present but never hardened ⇒ its config shows as missing.
  if (profile !== "minimal") {
    // KJC-BUG-0370: the same scope (package.json kj.harden) as kj harden.
    const { only = [], exclude = [] } = readHardenConfig(projectDir);
    const roots = detectStackRoots(projectDir, { only, exclude });
    checks.push(...configChecks(projectDir, roots), ...workflowChecks(projectDir, roots));
  }

  return { ok: checks.every((c) => c.ok), checks };
}
