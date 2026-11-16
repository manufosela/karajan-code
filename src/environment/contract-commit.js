/**
 * The contract commit (KJC-TSK-0857, KJC-BUG-0273). What kj generates for a
 * project (playbook, skills, settings, workflows, gate marker, hooks) the whole
 * team must inherit by cloning, so it goes into git. Nobody wrote it, and an
 * agent's own PR-size rules forbid a 1200-line commit, so kj makes the commit
 * itself: only the files it just generated, never what was already dirty, and
 * never on the base branch once the repo has history. This is NOT the supervisor
 * seal (ADR 0009), which stays a human act.
 */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { basename, resolve } from "node:path";

import { GENERATED_CONFIG_FILES } from "../harden/config-templates.js";
import { isSealedConfig } from "../harden/supervisor-commit.js";
import { sealedFilesOf } from "../policy/engine.js";
import { formatWithRepoPrettier } from "./format-contract.js";

/** What kj generates and the whole team must inherit by cloning (prefixes). */
export const CONTRACT_PATHS = [
  ".gitignore",
  ".karajan/hooks/",
  ".karajan/review-gate",
  ".karajan/adrs/",
  ".karajan/policy.yml",
  ".claude/",
  ".github/workflows/kj-",
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  // KJC-TSK-1504: names AGENTS.md as the rules file Gemini CLI reads.
  ".gemini/settings.json",
  // KJC-TSK-0879: in a Rulesync repo kj's rules live in .rulesync/rules/karajan.md.
  ".rulesync/",
  // KJC-BUG-0289 (#1984): the governance the whole team inherits (ADR 0016, KJC-BUG-0269).
  ".karajan/rules.yml",
  ".karajan/policy-anchor.json",
  ".karajan/supervisor-signers.json",
  // KJC-TSK-0995 (HUM-D, ADR 0018): the security level the whole team inherits.
  ".karajan/security-level.json",
  // KJC-BUG-0346: kj env install wires kj_rag_query as a native tool here; a clone
  // without it loses the tool. Only committed when kj changed it in this run.
  ".mcp.json",
];

const FRESH_MESSAGE = "chore(bootstrap): el contrato del método, para que quien clone lo herede";
const REGEN_MESSAGE = "chore(kj): el contrato del método, generado por kj";

const runner = (projectDir, env) => (args) => execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
// KJC-BUG-0289: the lint/format/commit configs harden generates sit at the root
// or under a stack root (a fullstack monorepo is hardened on every side).
const isContract = (file) =>
  CONTRACT_PATHS.some((p) => (p.endsWith("/") || p.endsWith("-") ? file.startsWith(p) : file === p)) || GENERATED_CONFIG_FILES.has(basename(file));
/** The supervisor's files: the hooks and their provenance, sealed by the human (ADR 0009). */
const isSupervisor = (file) => file.startsWith(".karajan/hooks/") || file === ".karajan/supervisor-provenance.json";

/** The contract files git sees as changed, with their porcelain code (`??` untracked). */
function contractStatus(git) {
  try {
    const lines = git(["status", "--porcelain", "--untracked-files=all"]).split("\n").filter(Boolean);
    return lines.map((line) => [line.slice(3).trim().split(" -> ").at(-1), line.slice(0, 2)]).filter(([file]) => isContract(file));
  } catch {
    return [];
  }
}

/**
 * The contract files that differ from HEAD (or are untracked), one by one.
 * @returns {Set<string>} empty when git cannot answer
 */
export function contractChanges(projectDir, git = runner(projectDir, process.env)) {
  return new Set(contractStatus(git).map(([file]) => file));
}

/**
 * The reason a failed git commit names (KJC-BUG-0597): the hook's own `kj:` line
 * (the last one), else the last non-empty line. Stdout and stderr both count,
 * since git may relay the hook's echo on either.
 * @param {{stdout?: string, stderr?: string, message?: string}} err
 * @returns {string}
 */
export function commitFailureReason(err) {
  const output = [err.stdout, err.stderr || err.message].filter(Boolean).join("\n");
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const hookLines = lines.filter((line) => line.startsWith("kj harden:") || line.startsWith("kj:"));
  return hookLines.at(-1) ?? lines.at(-1) ?? "";
}

const hasCommits = (git) => { try { git(["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; } };
const branchOf = (git) => { try { return git(["symbolic-ref", "--short", "HEAD"]).trim(); } catch { return ""; } };

/** Git's own first line of an error: what failed, before its advice. */
const firstLine = (err) => String(err.stderr || err.message).trim().split("\n")[0];

/** Takes back from the index what kj staged; returns "" or why it could not. */
function unstage(git, files, fresh) {
  const added = new Set(fresh);
  const tracked = files.filter((f) => !added.has(f));
  try {
    if (tracked.length > 0) git(["restore", "--staged", "--", ...tracked]);
    if (fresh.length > 0) git(["rm", "--cached", "-q", "--", ...fresh]);
    return "";
  } catch (err) {
    return firstLine(err);
  }
}

/** What would be committed: `{ result }` when there is nothing to do, else the files to stage. */
function planContract({ git, before, baseBranch, projectDir }) {
  const history = hasCommits(git);
  // KJC-BUG-0302: a sealed supervisor regenerated (tracked hooks or provenance
  // that changed) is the seal's, a human act (ADR 0009), never the contract
  // commit's: regenerated together after a version bump, the gate refused the one
  // and the seal the other, and the person had to unstage the hook by hand.
  // HU-4384: the workflows and governance files the seal covers by hash are the seal's too.
  // KJC-BUG-0608: new or regenerated alike. The contract is reviewed before its commit and the
  // review's policy denies them outside the seal; only the bootstrap (no history) carries them.
  // KJC-BUG-0614: with the files the project declares in policy.yml sealed_files (HU-3899).
  const declared = history ? sealedFilesOf(projectDir) : [];
  const mine = contractStatus(git).filter(([file]) => !before.has(file) && !(history && (isSupervisor(file) || isSealedConfig(file, declared))));
  const files = mine.map(([file]) => file).sort();
  // Files git did not track before kj added them: they leave the index with `rm --cached`.
  const fresh = mine.filter(([, code]) => code === "??" || !history).map(([file]) => file);
  if (files.length === 0) return { result: { committed: false, reason: "nothing of the contract to commit" } };
  if (history && branchOf(git) === baseBranch) {
    // kj never commits on the base branch, and will not switch the person's branch
    // for them: the files are named so the commit can be made where it belongs.
    return { result: { committed: false, files, reason: `on the base branch '${baseBranch}', where kj never commits: create a branch and commit these generated files there (git checkout -b chore/kj-contract && git add -- ${files.join(" ")} && git commit -m "chore(kj): el contrato del método")` } };
  }
  return { files, fresh, history, message: history ? REGEN_MESSAGE : FRESH_MESSAGE };
}

const stageContract = (git, { files }) => git(["add", "--", ...files]);
// --only: these paths and nothing else. What the person had staged stays staged.
const commitStaged = (git, { files, message }) => git(["commit", "--only", "-m", message, "--", ...files]);

/** The way to commit the generated files by hand, named whenever kj could not. */
function commitByHand(files) {
  const quoted = files.map((f) => "'" + f.replaceAll("'", String.raw`'\''`) + "'").join(" ");
  return `Commit these generated files on a branch yourself: git add -- ${quoted} && kj review --staged && git commit -m "chore(kj): el contrato del método, generado por kj"`;
}

/** KJC-BUG-0302 / KJC-BUG-0522: the files stay in the working tree, not staged, so the seal can still run; the reason names the way to commit them. */
function commitFailure(git, { files, fresh }, err) {
  const why = commitFailureReason(err);
  const failed = unstage(git, files, fresh);
  const note = failed ? ` (and they could not be unstaged: ${failed})` : "";
  return { committed: false, files, reason: `git could not commit the contract: ${why}${note}. ${commitByHand(files)}` };
}

/** Stages the contract and commits it alone (`--only`). */
function commitPlan(git, plan) {
  try {
    stageContract(git, plan);
    commitStaged(git, plan);
  } catch (err) {
    return commitFailure(git, plan, err);
  }
  return { committed: true, files: plan.files };
}

/**
 * @param {{projectDir: string, before?: Set<string>, baseBranch?: string, env?: object}} opts
 *   `before`: the contract files already dirty BEFORE kj generated anything,
 *   tracked or not. They may carry the person's words, so they stay out.
 * @returns {{committed: boolean, files?: string[], reason?: string}}
 */
export function commitContract({ projectDir, before = new Set(), baseBranch = "main", env = process.env }) {
  const git = runner(projectDir, env);
  const plan = planFormatted({ git, before, baseBranch, projectDir, env });
  return plan.result ?? commitPlan(git, plan);
}

/**
 * KJC-BUG-0604: the plan, after the repo's prettier formatted the files kj generated. Planned
 * again when it formatted, since a file it brought back to HEAD's bytes is no longer a change.
 */
function planFormatted({ git, before, baseBranch, projectDir, env }) {
  const draft = planContract({ git, before, baseBranch, projectDir });
  if (draft.result) return draft;
  const fmt = formatWithRepoPrettier({ projectDir, files: draft.files, env });
  if (fmt.error) return { result: { committed: false, files: draft.files, reason: `the repo's prettier could not format kj's files: ${fmt.error}. ${commitByHand(draft.files)}` } };
  return fmt.formatted.length > 0 ? planContract({ git, before, baseBranch, projectDir }) : draft;
}

/**
 * HU-4361 (KJC-BUG-0599): the review reads a throwaway index, next to git's own,
 * holding HEAD plus the contract alone: what `commit --only` commits. The person's
 * index, and what they had staged in it, is neither reviewed nor touched.
 */
async function reviewContractAlone({ projectDir, env, git, plan, reviewStaged }) {
  let indexFile = "";
  try {
    indexFile = resolve(projectDir, git(["rev-parse", "--git-dir"]).trim(), `kj-contract-index-${process.pid}`);
    const alone = runner(projectDir, { ...env, GIT_INDEX_FILE: indexFile });
    alone(["read-tree", plan.history ? "HEAD" : "--empty"]);
    stageContract(alone, plan);
  } catch (err) {
    if (indexFile) rmSync(indexFile, { force: true });
    return { status: "unindexed", error: firstLine(err) };
  }
  try {
    return await reviewStaged({ indexFile });
  } catch (err) {
    return { status: "unavailable", error: firstLine(err) };
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * HU-4361 (KJC-BUG-0599): like commitContract, but the contract diff is reviewed
 * BEFORE the commit, so a repo with the review gate finds its verdict in the
 * pre-commit hook. A rejection commits nothing; a reviewer that cannot run still
 * lets the commit be tried (a repo without the gate commits fine), and then the
 * review carries the command that reviews that commit later.
 * @param {{reviewStaged: (opts: {indexFile: string}) => Promise<{status: string}>}} opts reviewStaged: reviews what indexFile stages
 * @returns {Promise<{committed: boolean, files?: string[], reason?: string, review?: object}>}
 */
export async function commitContractReviewed({ projectDir, before = new Set(), baseBranch = "main", env = process.env, reviewStaged }) {
  const git = runner(projectDir, env);
  const plan = planFormatted({ git, before, baseBranch, projectDir, env });
  if (plan.result) return plan.result;
  const review = await reviewContractAlone({ projectDir, env, git, plan, reviewStaged });
  if (review.status === "unindexed") return { committed: false, files: plan.files, review, reason: `kj could not stage the contract alone for its review: ${review.error}. ${commitByHand(plan.files)}` };
  if (review.status === "rejected") return { committed: false, files: plan.files, review, reason: "the cross-AI review rejected the contract diff, nothing was committed" };
  const done = commitPlan(git, plan);
  if (!done.committed || review.status !== "unavailable") return { ...done, review };
  const sha = git(["rev-parse", "--short=7", "HEAD"]).trim();
  return { ...done, review: { ...review, command: `kj review --range ${sha}^..${sha}` } };
}
