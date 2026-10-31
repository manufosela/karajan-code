/**
 * KJC-BUG-0447 (issue #2655): is the review gate actually ENFORCED? The marker
 * only declares it; what refuses a commit is a pre-commit hook that runs
 * `kj review --check`. Checked where git will look (core.hooksPath, local or
 * global, or .git/hooks), never assumed from a hooks path being configured.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The contract: a line that RUNS the check and stops the commit when it fails, as the
// pre-commit kj harden writes (`kj review --check || { ...; exit 1; }`) or `|| exit 1`.
// A comment, the phrase inside an echo, `|| true`, `|| exit 0` or a group that does
// not END in `exit N` (N > 0) enforce nothing. Right after `||`, a bare `exit` keeps
// the failing check's status; inside a group it would take the previous command's.
const GATE_LINE = /^\s*kj review --check\s*\|\|\s*(?:exit(?:\s+[1-9]\d*)?\s*(?:;|#|$)|\{(?:[^}]*;)?\s*exit\s+[1-9]\d*\s*;?\s*\})/;
const runsGate = (body) => body.split("\n").some((line) => GATE_LINE.test(line));

/** @returns {{enforced: boolean, hooksDir: string|null, reason: string|null}} */
export function gateHookStatus(projectDir) {
  let hooksDir;
  try {
    // --git-path hooks honours core.hooksPath (repo or global) and worktrees.
    const rel = execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    hooksDir = path.resolve(projectDir, rel);
  } catch {
    return { enforced: false, hooksDir: null, reason: "not a git repository: no hook can enforce the gate" };
  }
  const hook = path.join(hooksDir, "pre-commit");
  let body;
  try { body = fs.readFileSync(hook, "utf8"); } catch {
    return { enforced: false, hooksDir, reason: `no pre-commit hook in ${hooksDir}, where git looks for hooks` };
  }
  if (!runsGate(body)) return { enforced: false, hooksDir, reason: `${hook} does not run kj review --check` };
  try { fs.accessSync(hook, fs.constants.X_OK); } catch {
    return { enforced: false, hooksDir, reason: `${hook} is not executable, so git skips it` };
  }
  return { enforced: true, hooksDir, reason: null };
}
