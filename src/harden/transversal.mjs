// ADR 0055 step 1 (KJC-TSK-1558): a session opened in a transversal parent (a folder
// that is not a git repo and holds a .claude-transversal marker) mutates the child
// repos under it. These pure blocks find that parent and map a path to its child
// repo; the guards will judge each call with the repo it touches.
import process from "node:process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// A hook may run with GIT_DIR/GIT_WORK_TREE set: they would pin every answer to one repo.
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const canonical = (p) => { try { return realpathSync(p); } catch { return p; } };
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** @param {string} cwd @returns {string|null} its git toplevel; null when git cannot read it. */
const gitToplevel = (cwd) => {
  try {
    const out = execFileSync("git", ["--no-optional-locks", "rev-parse", "--show-toplevel"], {
      cwd, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"], timeout: 3000,
    }).toString().trim();
    return out ? realpathSync(out) : null;
  } catch { return null; }
};

/** @param {string} p @returns {string|null} the nearest existing directory of p, canonical. */
const nearestDir = (p) => {
  let d = p;
  while (!isDir(d)) {
    if (dirname(d) === d) return null;
    d = dirname(d);
  }
  return canonical(d);
};

/** @returns {boolean} child strictly below parent. */
const isBelow = (child, parent) => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** Walking up from dir, the first folder with the marker that is not inside a git work tree. @returns {string|null} */
export const transversalRoot = (dir) => {
  for (let d = resolve(String(dir)); ; d = dirname(d)) {
    if (isFile(join(d, ".claude-transversal")) && !gitToplevel(d)) return canonical(d);
    if (dirname(d) === d) return null;
  }
};

/** Whether dir lies inside a git work tree: a session opened there is that repo's own, never transversal. @returns {boolean} */
export const inWorkTree = (dir) => Boolean(gitToplevel(String(dir)));

/** The git toplevel of path's nearest existing dir when it lies below parent (relative paths read from parent). @returns {string|null} */
export const childRepoOf = (path, parent) => {
  const root = canonical(resolve(String(parent)));
  const dir = nearestDir(resolve(root, String(path)));
  const top = dir && gitToplevel(dir);
  return top && isBelow(top, root) ? top : null;
};

/** Whether path's nearest existing dir, real path, is parent or under it (relative paths read from parent). @returns {boolean} */
export const inParent = (path, parent) => {
  const root = canonical(resolve(String(parent)));
  return !relative(root, nearestDir(resolve(root, String(path))) ?? root).split(sep).includes("..");
};

/** The distinct child repos of paths, and the paths in none. @returns {{repos: string[], stray: string[]}} */
export const childReposOf = (paths, parent) => {
  const repos = new Set();
  const stray = [];
  for (const p of paths) {
    const repo = childRepoOf(p, parent);
    if (repo) repos.add(repo);
    else stray.push(p);
  }
  return { repos: [...repos], stray };
};

// ADR 0055 step 3: a dot dir or node_modules is never a child repo's home.
const subdirs = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules"); }
  catch { return []; }
};

/** The repos under parent, nested ones up to depth levels down, never one inside another. @returns {string[]} */
export const listChildRepos = (parent, depth = 3) => {
  const walk = (dir, left) => subdirs(dir).flatMap((e) => {
    const d = join(dir, e.name);
    if (existsSync(join(d, ".git"))) return [d];
    return left > 1 ? walk(d, left - 1) : [];
  });
  return walk(canonical(resolve(String(parent))), depth).toSorted();
};
