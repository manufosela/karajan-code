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
import { basename } from "node:path";

import { GENERATED_CONFIG_FILES } from "../harden/config-templates.js";

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
  // KJC-BUG-0289 (#1984): the governance the whole team inherits (ADR 0016, KJC-BUG-0269).
  ".karajan/rules.yml",
  ".karajan/policy-anchor.json",
  ".karajan/supervisor-signers.json",
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
  const history = hasCommits(git);
  // KJC-BUG-0302: a sealed supervisor regenerated (tracked hooks or provenance
  // that changed) is the seal's, a human act (ADR 0009), never the contract
  // commit's: regenerated together after a version bump, the gate refused the one
  // and the seal the other, and the person had to unstage the hook by hand. The
  // first install (untracked hooks) still rides in the contract commit.
  const files = contractStatus(git).filter(([file, code]) => !before.has(file) && !(history && code !== "??" && isSupervisor(file))).map(([file]) => file).sort();
  if (files.length === 0) return { committed: false, reason: "nothing of the contract to commit" };
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
    // KJC-BUG-0302: the files stay staged, and the reason names the way to commit them.
    const why = String(err.stderr || err.message).trim().split("\n")[0];
    const quoted = files.map((f) => "'" + f.replaceAll("'", String.raw`'\''`) + "'").join(" ");
    return { committed: false, files, reason: `git could not commit the contract: ${why}. Commit these generated files on a branch yourself: git add -- ${quoted} && kj review --staged && git commit -m "chore(kj): el contrato del método, generado por kj"` };
  }
  return { committed: true, files };
}
