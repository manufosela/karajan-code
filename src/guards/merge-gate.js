/**
 * KJC-BUG-0494: an agent merged a PR while its CI was still running; it came out green
 * afterwards, by luck. Before gh pr merge the Sentinel asks kj, and kj reads the PR's checks:
 * one running or red stops the merge. With no check yet, a repo that has CI stops it too (the
 * CI has not started); a repo without workflows has nothing to wait for. --auto passes:
 * GitHub itself waits for the checks. Red checks pass only under a signed main-guard exception.
 */
import { spawnSync } from "node:child_process";

import { rosterFromText } from "../harden/phone-sign.js";
import { exceptionsFor, findValidException } from "./main-guard-exception.js";

const VALUE_OPTIONS = new Set(["-b", "--body", "-F", "--body-file", "-t", "--subject", "-A", "--author-email", "--match-head-commit"]);
const RED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);

// gh, a path to it, a gh-<account> wrapper, a substitution or a variable may name gh.
const GH = /^(?:\S*\/)?gh(?:-[\w-]+)?$|^\$/;
const PR_VALUE_FLAGS = new Set(["-R", "--repo"]);

/** The shell as it runs the command: line continuations, escapes, quoted words, one-word prose. */
function shellWords(command) {
  const flat = String(command ?? "").replaceAll(/\\\n/g, " ").replaceAll(/\\(.)/g, "$1").replaceAll(/(["'])([\w-]*)\1/g, "$2");
  const bare = flat.replaceAll(/\$\([^)]*\)/g, "$SUB").replaceAll(/'[^']*'|"[^"]*"/g, (q) => (/\s/.test(q) ? "_" : q));
  return bare.split(/[;&|\n]+/).map((segment) => segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []);
}

/** The words after `gh pr [pr flags] merge` in a segment, or null when it merges no PR. */
function mergeWords(words) {
  for (let i = 0; i < words.length - 1; i += 1) {
    if (!GH.test(words[i]) || words[i + 1] !== "pr") continue;
    const rest = words.slice(i + 2);
    const before = [];
    while (rest[0]?.startsWith("-")) {
      const flag = rest.shift();
      before.push(flag, ...(PR_VALUE_FLAGS.has(flag) && rest.length > 0 ? [rest.shift()] : []));
    }
    if (rest[0] === "merge") return [...before, ...rest.slice(1)];
  }
  return null;
}

/** The PR a shell command merges ({selector, repo, auto}), or null when it merges none. */
export function mergeTarget(command) {
  const found = shellWords(command).map(mergeWords).find(Boolean);
  if (!found) return null;
  const words = found.map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
  const target = { selector: null, repo: null, auto: false };
  let valueOf = null;
  for (const w of words) {
    if (valueOf) {
      if (valueOf === "repo") target.repo = w;
      valueOf = null;
    } else if (w === "--auto") target.auto = true;
    else if (w === "-R" || w === "--repo") valueOf = "repo";
    else if (w.startsWith("--repo=")) target.repo = w.slice("--repo=".length);
    else if (w.startsWith("-R")) target.repo = w.slice(w[2] === "=" ? 3 : 2);
    else if (VALUE_OPTIONS.has(w)) valueOf = "other";
    else if (!w.startsWith("-") && target.selector === null) target.selector = w;
  }
  return target;
}

const nameOf = (c) => c.name ?? c.context;
const stateOf = (c) => {
  if (c.__typename === "StatusContext") {
    if (c.state === "PENDING" || c.state === "EXPECTED") return "pending";
    return RED.has(c.state) ? "red" : "ok";
  }
  if (c.status !== "COMPLETED") return "pending";
  return RED.has(c.conclusion) ? "red" : "ok";
};

/** The latest run of each check: a re-run supersedes the runs before it. */
function latestRuns(checks) {
  const latest = new Map();
  for (const c of checks) {
    const key = `${c.workflowName ?? ""}\u0000${nameOf(c)}`;
    const seen = latest.get(key);
    if (!seen || String(c.startedAt ?? "") > String(seen.startedAt ?? "")) latest.set(key, c);
  }
  return [...latest.values()];
}

/** Whether a PR with these checks (gh's statusCheckRollup) may be merged now. */
export function checksVerdict(checks, { hasWorkflows }) {
  if (checks.length === 0) return hasWorkflows ? { ok: false, reason: "no check yet, and the repo has CI: it has not started, wait for it" } : { ok: true };
  const runs = latestRuns(checks);
  const named = (state) => runs.filter((c) => stateOf(c) === state).map(nameOf);
  const parts = [];
  if (named("pending").length) parts.push(`still running: ${named("pending").join(", ")}`);
  if (named("red").length) parts.push(`red: ${named("red").join(", ")}`);
  return parts.length ? { ok: false, reason: parts.join("; ") } : { ok: true };
}

// The PR's own repo, from its URL: a cross-repo selector is not the current repo.
const repoOf = (url) => /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1];

const ROSTER = ".karajan/supervisor-signers.json";
const ghSaid = (r) => r.stderr.trim() || "gh gave no output";

/**
 * HU-4969: who may sign an exception for a PR into `base`, asked to GitHub, never to the local
 * clone, whose refs and files whoever runs the merge can rewrite. Only the default branch is
 * excepted. An unreadable roster trusts nobody and says so in `unread`.
 * @returns {{refused: string} | {keys: Set<string>, passkeys: object[], unread?: string}}
 */
function trustedRoster(run, repo, base) {
  const head = run("gh", ["api", `repos/${repo}`, "--jq", ".default_branch"]);
  const main = head.status === 0 ? head.stdout.trim() : "";
  if (!main) return { refused: `could not read the default branch of ${repo} from GitHub: ${ghSaid(head)}` };
  if (base !== main) return { refused: `the main-guard exception covers only merges into ${main}, this PR targets ${base}` };
  const file = run("gh", ["api", `repos/${repo}/contents/${ROSTER}?ref=${encodeURIComponent(base)}`, "--jq", ".content"]);
  const { keys, passkeys } = rosterFromText(file.status === 0 ? Buffer.from(file.stdout, "base64").toString("utf8") : "");
  const unread = file.status === 0 ? undefined : `could not read ${ROSTER} on ${base} from GitHub: ${ghSaid(file)}`;
  return { keys: new Set(keys), passkeys, unread };
}

/**
 * HU-4969: a refusal for red checks, lifted by the maintainer's signed main-guard exception
 * (KJC-TSK-1402) for this PR and head. A check still running is never excepted.
 */
function underException(refusal, checks, { url = "", number, headRefOid, baseRefName, comments = [] }, run) {
  const runs = latestRuns(checks);
  if (runs.some((c) => stateOf(c) === "pending")) return refusal;
  const pull = { bodies: comments.map((c) => c.body), repo: repoOf(url), pr: number };
  const signed = exceptionsFor(pull);
  if (signed.length === 0) return refusal;
  const refused = (why) => ({ ok: false, reason: `${refusal.reason}; ${why}` });
  if (!signed.some((b) => b.head === headRefOid)) {
    const heads = signed.map((b) => String(b.head).slice(0, 7)).join(", ");
    return refused(`the exception for #${number} was signed for head ${heads}, not for the PR's head ${headRefOid.slice(0, 7)}`);
  }
  const roster = trustedRoster(run, pull.repo, baseRefName);
  if (roster.refused) return refused(roster.refused);
  const found = findValidException({ ...pull, head: headRefOid, keys: roster.keys, passkeys: roster.passkeys });
  if (!found.ok) return refused([roster.unread, found.reason].filter(Boolean).join("; "));
  const red = runs.filter((c) => stateOf(c) === "red").map(nameOf).join(", ");
  return { ok: true, note: `red: ${red}, merged under the main-guard exception signed by ${found.signer}: ${found.why}` };
}

/**
 * The verdict on a shell command: {ok: true} when it merges no PR, merges with --auto, or the
 * PR's checks allow it, or its red checks carry an exception signed by the roster GitHub has on
 * the default branch (with a `note`); otherwise {ok: false, reason}. run(cmd, args) -> {status, stdout, stderr}.
 */
export function mergeGate({ command, run }) {
  const target = mergeTarget(command);
  if (!target || target.auto) return { ok: true };
  const repo = target.repo ? ["--repo", target.repo] : [];
  const pr = run("gh", ["pr", "view", ...(target.selector ? [target.selector] : []), ...repo, "--json", "statusCheckRollup,url,number,headRefOid,baseRefName,comments"]);
  if (pr.status !== 0) return { ok: false, reason: `could not read the PR's checks: ${pr.stderr.trim() || "gh gave no output"}` };
  const view = JSON.parse(pr.stdout);
  const { statusCheckRollup: checks = [], url = "" } = view;
  if (checks.length > 0) {
    const verdict = checksVerdict(checks, { hasWorkflows: true });
    return verdict.ok ? verdict : underException(verdict, checks, view, run);
  }
  const prRepo = repoOf(url);
  if (!prRepo) return { ok: false, reason: `no check yet, and kj could not tell the PR's repo from ${url || "gh's answer"}` };
  const wf = run("gh", ["api", `repos/${prRepo}/actions/workflows`, "--jq", ".total_count"]);
  if (wf.status !== 0) return { ok: false, reason: `no check yet, and kj could not tell whether the repo has CI: ${wf.stderr.trim()}` };
  return checksVerdict([], { hasWorkflows: Number(wf.stdout.trim()) > 0 });
}

/** The real runner: gh inherits the GH_TOKEN kj pinned at startup (ADR 0040). */
export function runCommand(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
}
