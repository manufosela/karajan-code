/**
 * KJC-BUG-0494: an agent merged a PR while its CI was still running; it came out green
 * afterwards, by luck. Before gh pr merge the Sentinel asks kj, and kj reads the PR's checks:
 * one running or red stops the merge. With no check yet, a repo that has CI stops it too (the
 * CI has not started); a repo without workflows has nothing to wait for. --auto passes:
 * GitHub itself waits for the checks.
 */
import { spawnSync } from "node:child_process";

const VALUE_OPTIONS = new Set(["-b", "--body", "-F", "--body-file", "-t", "--subject", "-A", "--author-email", "--match-head-commit"]);
const RED = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);

/** The PR a shell command merges ({selector, repo, auto}), or null when it merges none. */
export function mergeTarget(command) {
  // The shell runs `gh pr \<newline>merge`, `g\h` and `"gh"` as gh: read the command as it runs.
  const flat = String(command ?? "").replaceAll(/\\\n/g, " ").replaceAll(/\\(.)/g, "$1").replaceAll(/(["'])([\w-]*)\1/g, "$2");
  const m = /\bgh\s+pr\s+merge\b([^;&|\n]*)/.exec(flat);
  if (!m) return null;
  const words = (m[1].match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^(['"])(.*)\1$/, "$2"));
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

/**
 * The verdict on a shell command: {ok: true} when it merges no PR, merges with --auto, or the
 * PR's checks allow it; otherwise {ok: false, reason}. run(cmd, args) -> {status, stdout, stderr}.
 */
export function mergeGate({ command, run }) {
  const target = mergeTarget(command);
  if (!target || target.auto) return { ok: true };
  const repo = target.repo ? ["--repo", target.repo] : [];
  const pr = run("gh", ["pr", "view", ...(target.selector ? [target.selector] : []), ...repo, "--json", "statusCheckRollup,url"]);
  if (pr.status !== 0) return { ok: false, reason: `could not read the PR's checks: ${pr.stderr.trim() || "gh gave no output"}` };
  const { statusCheckRollup: checks = [], url = "" } = JSON.parse(pr.stdout);
  if (checks.length > 0) return checksVerdict(checks, { hasWorkflows: true });
  // The PR's own repo, from its URL: a cross-repo selector is not the current repo.
  const prRepo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1];
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
