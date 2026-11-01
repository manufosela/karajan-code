/**
 * `kj main-guard` (KJC-TSK-1369, ADR 0037 layer 2): audits a push to the protected branch
 * against GitHub and exits 1 with a markdown report when a merge skipped its required checks
 * or the protection no longer enforces them on admins. The sealed workflow runs it on every
 * push to main and posts the report as the alarm.
 *
 * Pull requests and check results are read with the token gh has (the workflow's GITHUB_TOKEN).
 * Reading the branch protection needs Administration, so it uses MAIN_GUARD_PROTECTION_TOKEN,
 * a read-only secret (the maintainer's choice, 2026-11-01).
 */
import { execFileSync } from "node:child_process";

import { auditMain } from "../guards/main-guard.js";

const NEW_BRANCH = /^0+$/;

const gitIn = (projectDir) => (args) => execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8" });

/** The commits the push put on the branch, newest first: its first-parent line. */
export function pushedCommits({ before, after, git }) {
  if (!before || NEW_BRANCH.test(before)) return [after];
  return git(["rev-list", "--first-parent", `${before}..${after}`]).split("\n").filter(Boolean);
}

/** `gh api` as JSON; a token, when given, replaces gh's own for that call only. */
function ghJson(path, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
}

/** GitHub as main-guard's api. */
export function githubApi({ repo, branch, protectionToken }) {
  return {
    // The commit's pull list leaves merged_by out; a merged one is read in full to name who merged it.
    pullsOf: async (sha) => ghJson(`repos/${repo}/commits/${sha}/pulls`).map((p) => (p.merged_at ? ghJson(`repos/${repo}/pulls/${p.number}`) : p)),
    async checksOf(sha) {
      const runs = ghJson(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).check_runs ?? [];
      const statuses = ghJson(`repos/${repo}/commits/${sha}/status`).statuses ?? [];
      return [...runs.map((r) => ({ name: r.name, conclusion: r.conclusion })), ...statuses.map((s) => ({ name: s.context, conclusion: s.state }))];
    },
    async protection() {
      if (!protectionToken) throw new Error("main-guard: MAIN_GUARD_PROTECTION_TOKEN is not set; the protection cannot be read");
      try {
        return ghJson(`repos/${repo}/branches/${encodeURIComponent(branch)}/protection`, protectionToken);
      } catch (err) {
        if (/Branch not protected/i.test(`${err.stdout ?? ""}${err.stderr ?? ""}`)) return null;
        throw err;
      }
    },
  };
}

/** The alarm as markdown. */
export function renderReport(result, { repo, branch }) {
  if (result.ok) return `main-guard: nothing reached ${branch} without its checks, and the protection of ${repo} is as declared.`;
  const lines = [`## main-guard: ${repo}@${branch} needs a look`, ""];
  for (const m of result.merges) {
    lines.push(m.kind === "direct-push"
      ? `- \`${m.sha.slice(0, 7)}\`: direct push, ${m.detail}`
      : `- \`${m.sha.slice(0, 7)}\`: PR #${m.pr} merged by @${m.mergedBy} without ${m.missing.join(", ")}`);
  }
  for (const change of result.protection) lines.push(`- protection: ${change}`);
  return lines.join("\n");
}

/** @returns {Promise<number>} the exit code */
export async function runMainGuard({ repo, branch, before, after, require, git, audit = auditMain, api, print = console.log }) {
  const commits = pushedCommits({ before, after, git });
  const result = await audit({ branch, commits, requiredChecks: require, api });
  print(renderReport(result, { repo, branch }));
  return result.ok ? 0 : 1;
}

export async function mainGuardCommand({ flags, projectDir = process.cwd() }) {
  const { repo, branch, before, after } = flags;
  const api = githubApi({ repo, branch, protectionToken: process.env.MAIN_GUARD_PROTECTION_TOKEN });
  process.exitCode = await runMainGuard({ repo, branch, before, after, require: flags.require, git: gitIn(projectDir), api });
}
