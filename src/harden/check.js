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
import { PROFILE_HOOKS } from "./hook-templates.js";

const HOOKS_DIR = join(".karajan", "hooks");

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

  return { ok: checks.every((c) => c.ok), checks };
}
