/**
 * The main checkout of the repo a dir belongs to: lanes and plans hang from it, never from a
 * lane (#2566). Not the Sentinel's lane identity (ADR 0002). Outside git, the dir unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// null only for "not a git repository"; any other git failure is loud, never a silent nested lane.
const gitOrNull = (args, cwd) => {
  // A git hook exports GIT_DIR & co: left in, they would override `cwd` and answer for the wrong repo.
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "LANGUAGE"]) delete env[name];
  env.LC_ALL = "C"; // the stderr check below reads git's English message (KJC-BUG-0409)
  try {
    return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (/not a git repository/i.test(String(err.stderr))) return null;
    throw new Error(`cannot resolve the main checkout of ${cwd}: ${String(err.stderr || err.message).trim()}`, { cause: err });
  }
};

export function mainCheckout(dir) {
  const out = gitOrNull(["rev-parse", "--path-format=absolute", "--git-common-dir", "--is-bare-repository"], dir);
  if (out === null) return dir;
  const [common, bare] = out.split("\n");
  if (bare === "true") throw new Error(`${dir} belongs to a bare repository: kj lanes need a main checkout`);
  // The main checkout is the dir whose `.git` IS the common dir or a file pointing at it. Git
  // records no path back to it, so the candidates are the ancestors of the toplevel (lanes live
  // under it; --separate-git-dir, submodules) and the common dir's parent (a lane beside it).
  const top = gitOrNull(["rev-parse", "--show-toplevel"], dir);
  const candidates = [];
  for (let up = top; path.dirname(up) !== up; up = path.dirname(up)) candidates.push(up);
  const found = [...candidates, path.dirname(common)].find((c) => dotGitIs(path.join(c, ".git"), common));
  if (!found) {
    throw new Error(`cannot find the main checkout of ${dir}: its git dir is separate and the worktree sits outside the checkout`);
  }
  return found;
}

const GITDIR_PREFIX = "gitdir:";
const dotGitIs = (dotGit, common) => {
  try {
    if (fs.statSync(dotGit).isDirectory()) return fs.realpathSync(dotGit) === common;
    const line = fs.readFileSync(dotGit, "utf8").split("\n").find((l) => l.startsWith(GITDIR_PREFIX));
    return line !== undefined && fs.realpathSync(path.resolve(path.dirname(dotGit), line.slice(GITDIR_PREFIX.length).trim())) === common;
  } catch {
    return false; // no ".git" here: keep climbing
  }
};
