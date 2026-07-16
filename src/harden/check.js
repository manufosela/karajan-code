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
import { artifactIdForConfig, findAlternative } from "./alternatives.js";
import { CONFIGS_BY_LANGUAGE, UNIVERSAL_CONFIGS } from "./config-templates.js";
import { PROFILE_HOOKS } from "./hook-templates.js";
import { detectStackRoots } from "./stack-roots.js";
import { qualityWorkflowFor, WORKFLOWS } from "./workflow-templates.js";

const HOOKS_DIR = join(".karajan", "hooks");
const WORKFLOWS_DIR = join(".github", "workflows");

/** A config/workflow file just needs to be present (it may be user-owned). */
function presence(projectDir, rel, id, miss) {
  const ok = existsSync(join(projectDir, rel));
  return { id, ok, detail: ok ? "ok" : miss };
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

  for (const hook of PROFILE_HOOKS[profile] ?? []) {
    const target = join(projectDir, HOOKS_DIR, hook);
    const exists = existsSync(target);
    const executable = exists && (statSync(target).mode & 0o100) !== 0;
    const marked = exists && readFileSync(target, "utf8").includes(`kj:managed:hook:${hook}`);
    const detail = !exists ? "missing" : !executable ? "not executable" : !marked ? "no kj marker" : "ok";
    checks.push({ id: `hook:${hook}`, ok: exists && executable && marked, detail });
  }

  // Config + workflows ship with standard+ — and surface the greenfield gap:
  // a language now present but never hardened ⇒ its config shows as missing.
  if (profile !== "minimal") {
    const roots = detectStackRoots(projectDir);
    for (const cfg of UNIVERSAL_CONFIGS) {
      checks.push(presence(projectDir, cfg.file, `config:${cfg.file}`, "missing — run kj harden"));
    }
    for (const { dir, language } of roots) {
      const rootDir = dir === "." ? projectDir : join(projectDir, dir);
      for (const cfg of CONFIGS_BY_LANGUAGE[language] ?? []) {
        const rel = dir === "." ? cfg.file : join(dir, cfg.file);
        // A config covered by the user's own tool (biome.json ⇒ eslint+prettier)
        // is not drift — kj must not demand a second linter/formatter (KJC-TSK-0614).
        if (!existsSync(join(projectDir, rel))) {
          const alt = findAlternative([rootDir, projectDir], artifactIdForConfig(cfg));
          if (alt) {
            checks.push({ id: `config:${rel}`, ok: true, detail: `covered by ${alt.foundAt} (${alt.tool})` });
            continue;
          }
        }
        checks.push(presence(projectDir, rel, `config:${rel}`, `missing for ${language} — run kj harden`));
      }
    }
    const expectedWf = [...WORKFLOWS];
    const quality = qualityWorkflowFor(roots[0]?.language ?? null);
    if (quality) expectedWf.push(quality);
    for (const wf of expectedWf) {
      checks.push(presence(projectDir, join(WORKFLOWS_DIR, wf.file), `workflow:${wf.file}`, "missing — run kj harden"));
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
