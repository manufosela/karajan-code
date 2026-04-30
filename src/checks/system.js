/**
 * Miscellaneous system-level checks: Karajan version, git repo presence.
 * Kept in a dedicated module so they're easy to find and extend.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGitRepo } from "../utils/git.js";
import { STRATEGY } from "./types.js";

function getPackageVersion() {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

export function createKarajanVersionCheck() {
  return {
    name: "karajan",
    label: "Karajan Code",
    strategy: STRATEGY.NONE,
    async detect() {
      const version = getPackageVersion();
      return { ok: true, severity: "info", detail: `v${version}` };
    },
  };
}

export function createGitRepoCheck() {
  return {
    name: "git",
    label: "Git repository",
    strategy: STRATEGY.MANUAL,
    async detect() {
      let gitOk;
      try {
        gitOk = await ensureGitRepo();
      } catch {
        gitOk = false;
      }
      return {
        ok: gitOk,
        severity: "fail",
        detail: gitOk ? "Inside a git repository" : "Not a git repository",
        fix: gitOk ? undefined : "Run 'git init' or navigate to a git-managed project.",
      };
    },
  };
}

export function getSystemChecks() {
  return [createKarajanVersionCheck(), createGitRepoCheck()];
}
