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
  // KJC-TSK-0879: in a Rulesync repo kj's rules live in .rulesync/rules/karajan.md.
  ".rulesync/",
];

const FRESH_MESSAGE = "chore(bootstrap): el contrato del método, para que quien clone lo herede";
const REGEN_MESSAGE = "chore(kj): el contrato del método, generado por kj";

const runner = (projectDir, env) => (args) => execFileSync("git", ["-C", projectDir, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
const isContract = (file) => CONTRACT_PATHS.some((p) => (p.endsWith("/") || p.endsWith("-") ? file.startsWith(p) : file === p));

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

const hasCommits = (git) => { try { git(["rev-parse", "--verify", "HEAD"]); return true; } catch { return false; } };
const branchOf = (git) => { try { return git(["symbolic-ref", "--short", "HEAD"]).trim(); } catch { return ""; } };

/**
 * @param {{projectDir: string, before?: Set<string>, baseBranch?: string, env?: object}} opts
 *   `before`: the contract files already dirty BEFORE kj generated anything,
 *   tracked or not. They may carry the person's words, so they stay out.
 * @returns {{committed: boolean, files?: string[], reason?: string}}
 */
export function commitContract({ projectDir, before = new Set(), baseBranch = "main", env = process.env }) {
  const git = runner(projectDir, env);
  const files = contractStatus(git).map(([file]) => file).filter((file) => !before.has(file)).sort();
  if (files.length === 0) return { committed: false, reason: "nothing of the contract to commit" };
  const history = hasCommits(git);
  if (history && branchOf(git) === baseBranch) {
    // kj never commits on the base branch, and will not switch the person's branch
    // for them: the files are named so the commit can be made where it belongs.
    return { committed: false, files, reason: `on the base branch '${baseBranch}', where kj never commits: create a branch and commit these generated files there (git checkout -b chore/kj-contract && git add -- ${files.join(" ")} && git commit -m "chore(kj): el contrato del método")` };
  }
  try {
    git(["add", "--", ...files]);
    // --only: these paths and nothing else. What the person had staged stays staged.
    git(["commit", "--only", "-m", history ? REGEN_MESSAGE : FRESH_MESSAGE, "--", ...files]);
  } catch (err) {
    return { committed: false, files, reason: `git could not commit the contract: ${String(err.stderr || err.message).trim().split("\n")[0]}` };
  }
  return { committed: true, files };
}
