/**
 * KJC-TSK-0928 (M15-B): the method's CI checks become required on the base
 * branch, where no agent reaches. Branch protection needs admin rights, so kj
 * never applies it: it reads what is there and says the exact command.
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { runCommand } from "../utils/process.js";
import { assertGhIdentity } from "../hu/gh-identity.js";

// Scheduled or advisory kj workflows: they never block a PR, so they are never required.
const NOT_REQUIRED = new Set(["kj-mutation.yml", "kj-steward.yml"]);

/** The GitHub check name of each job: its `name:` when it has one, its id otherwise. */
function jobChecks(text) {
  const jobs = parseYaml(text)?.jobs ?? {};
  return Object.entries(jobs).map(([id, job]) => (typeof job?.name === "string" ? job.name : id));
}

/** The checks kj harden's own workflows publish, from the files installed in the repo. */
export function requiredChecksFrom(projectDir) {
  const dir = path.join(projectDir, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^kj-.*\.ya?ml$/.test(f) && !NOT_REQUIRED.has(f))
    .toSorted()
    .flatMap((f) => jobChecks(fs.readFileSync(path.join(dir, f), "utf8")));
}

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

// A base branch such as release/1.0 is one path segment of the REST endpoint.
const protectionPath = ({ owner, repo, branch }) => `repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;

function protectCommand({ checks, ...target }) {
  const contexts = checks.map((c) => `-f ${shellQuote(`required_status_checks[contexts][]=${c}`)}`).join(" ");
  // KJC-BUG-0401: enforce_admins=true; an agent working with an admin's token would skip every check otherwise.
  return `gh api -X PUT ${protectionPath(target)} -F 'required_status_checks[strict]=false' ${contexts} -F enforce_admins=true -F required_pull_request_reviews=null -F restrictions=null -F allow_force_pushes=false`;
}

const addCommand = ({ missing, ...target }) =>
  `gh api -X POST ${protectionPath(target)}/required_status_checks/contexts ${missing.map((c) => `-f ${shellQuote(`contexts[]=${c}`)}`).join(" ")}`;

const settingsUrl = ({ owner, repo }) => `https://github.com/${owner}/${repo}/settings/branches`;

/**
 * What the base branch needs for the checks to be required, and how. A command
 * is given only when it cannot undo anything: the full PUT for a branch with no
 * protection at all, the additive contexts call otherwise. Protection without
 * status checks, or unreadable, gets the settings page: a PUT there would wipe
 * the reviews and restrictions already set. Never applies anything, never throws.
 * @returns {Promise<{status: "ok"|"missing"|"unprotected"|"no-checks"|"unverified", command?: string, settings?: string, missing?: string[], reason?: string}>}
 */
export async function protectionAdvice({ owner, repo, branch, checks, run = runCommand }) {
  const target = { owner, repo, branch };
  let res;
  try {
    res = await run("gh", ["api", protectionPath(target)]);
  } catch (err) {
    return { status: "unverified", reason: err.message, settings: settingsUrl(target), missing: checks };
  }
  if (res.exitCode !== 0) {
    if (/404|not protected/i.test(`${res.stderr}${res.stdout}`)) return { status: "unprotected", command: protectCommand({ ...target, checks }) };
    return { status: "unverified", reason: (res.stderr || res.stdout || "gh failed").trim(), settings: settingsUrl(target), missing: checks };
  }
  const protection = JSON.parse(res.stdout || "{}");
  const statusChecks = protection.required_status_checks;
  if (!statusChecks) return { status: "no-checks", settings: settingsUrl(target), missing: checks };
  const existing = new Set(statusChecks.contexts ?? []);
  const missing = checks.filter((c) => !existing.has(c));
  // KJC-BUG-0401: required checks an admin skips are not required for an agent holding an admin's token.
  const bindAdmins = protection.enforce_admins?.enabled === false ? `gh api -X POST ${protectionPath(target)}/enforce_admins` : null;
  if (missing.length > 0) return { status: "missing", missing, command: [addCommand({ ...target, missing }), bindAdmins].filter(Boolean).join(" && ") };
  if (bindAdmins) return { status: "admins-exempt", command: bindAdmins };
  return { status: "ok" };
}

// Owner and repo go into a command an admin copies: only the characters GitHub allows in them.
const GITHUB_REMOTE = /github\.com[^:/]*[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

/** kj harden's last step: on a GitHub remote, what the base branch needs and who runs it. */
export async function adviseBranchProtection({ projectDir, branch, logger, run = runCommand, identity = assertGhIdentity }) {
  const checks = requiredChecksFrom(projectDir);
  if (checks.length === 0) return null;
  const remote = await run("git", ["-C", projectDir, "remote", "get-url", "origin"]).catch(() => null);
  const match = remote?.exitCode === 0 ? GITHUB_REMOTE.exec(remote.stdout.trim()) : null;
  if (!match) return null;
  // KJC-BUG-0401: read the protection as the account the clone declares; another one gets a 404
  // and kj said "not protected" about a protected branch.
  let advice;
  try {
    identity({ projectDir });
    advice = await protectionAdvice({ owner: match[1], repo: match[2], branch, checks, run });
  } catch (err) {
    advice = { status: "unverified", reason: err.message, settings: settingsUrl({ owner: match[1], repo: match[2] }), missing: checks };
  }
  if (advice.status === "ok") {
    logger.info?.(`  • branch protection: ${branch} requires the ${checks.length} kj check(s)`);
    return advice;
  }
  const list = advice.missing?.join(", ");
  const why = {
    unprotected: `${branch} is not protected: the method's checks do not stop a merge. An admin runs (kj never does):`,
    missing: `${branch} does not require ${advice.missing?.length} kj check(s) (${list}). An admin runs (kj never does):`,
    "no-checks": `${branch} is protected but requires no status checks. An admin enables "Require status checks" and adds ${list} in:`,
    unverified: `could not read the protection of ${branch} (${advice.reason}). An admin checks that ${list} are required in:`,
    "admins-exempt": `${branch} requires the kj checks, but admins can merge without them, and an agent working with an admin's token would. An admin runs (kj never does):`,
  }[advice.status];
  logger.warn?.(`  ⚠ branch protection: ${why}`);
  logger.warn?.(`      ${advice.command ?? advice.settings}`);
  return advice;
}
