import process from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { childReposOf, inParent, transversalRoot } from "./transversal.mjs";
import { pathTokens, shellSegments } from "./sentinel/sentinel-shell.mjs";
import { shellWrites } from "./sentinel/sentinel-bash-write.mjs";

/**
 * The Sentinel's guards as the hooks name them (KJC-TSK-1204, ADR 0030): one
 * closed list for both ways of running them from the installed package, the
 * kj-hook bin and `kj sentinel hook` (the single-file binary has no kj-hook).
 * Each entry loads only its module, so running a guard never pays the CLI.
 */
export const SENTINEL_GUARDS = {
  pretooluse: () => import("./sentinel/pretooluse.mjs"),
  "pretooluse-sentinel": () => import("./sentinel/pretooluse-sentinel.mjs"),
  "pretooluse-rules": () => import("./sentinel/pretooluse-rules.mjs"),
  posttooluse: () => import("./sentinel/posttooluse.mjs"),
  stop: () => import("./sentinel/stop.mjs"),
  sessionstart: () => import("./sentinel/sessionstart.mjs"),
};

// ADR 0055 step 2 (KJC-TSK-1558): the guards that judge a call before it runs.
const JUDGING = new Set(["pretooluse", "pretooluse-sentinel", "pretooluse-rules"]);

const readAll = async (stream) => Buffer.concat(await Array.fromAsync(stream, (chunk) => Buffer.from(chunk)));
const parseCall = (bytes) => { try { return JSON.parse(bytes.toString("utf8")) ?? {}; } catch { return {}; } };

/** The words of a command, quotes read as the shell reads them, that name an entry from base (cd a, git -C a, rm notes.md). */
const entryWords = (cmd, base) => [...new Set(shellSegments(cmd).flat())].map((w) => resolve(base, w)).filter((p) => existsSync(p));
/** The dirs a command may read a relative path from: its cwd, then each one a cd or pushd moves it to (every one is judged). */
const runDirs = (cmd, cwd) => shellSegments(cmd).reduce((dirs, [verb, to]) => (["cd", "pushd"].includes(verb) && to ? [...dirs, resolve(dirs.at(-1), to)] : dirs), [cwd]);

/** The paths a hook call touches, absolute, a relative one read from every dir it may run in; naming none, its cwd. */
const touchedPaths = (call, parent) => {
  const input = call.tool_input ?? {};
  const cwd = typeof call.cwd === "string" && call.cwd ? call.cwd : parent;
  const named = [input.file_path, input.path, input.notebook_path].filter((p) => typeof p === "string" && p);
  const cmd = call.tool_name === "Bash" ? String(input.command ?? "") : "";
  // A file it writes may have no slash (cp a/f notes.md); a ~/ one is already a path token, home expanded.
  const writes = shellSegments(cmd).flatMap(shellWrites).filter((w) => !w.startsWith("~/"));
  const words = [...named, ...pathTokens(cmd, process.env.HOME).map((t) => t.path), ...writes];
  const all = runDirs(cmd, cwd).flatMap((dir) => [...words.map((w) => resolve(dir, w)), ...entryWords(cmd, dir)]);
  return all.length > 0 ? [...new Set(all)] : [cwd];
};

/**
 * In a transversal session, move this process into the one child repo the call touches
 * (env, cwd and the stdin bytes re-injected) so the guard fixes its root there.
 * @returns {Promise<boolean>} false when the call was settled here (exit already called).
 */
const enterChildRepo = async (name, parent, { logger, exit }) => {
  if (name === "stop" || name === "sessionstart") {
    logger.error("kj-hook: transversal session: stop/session checks per repo come next");
    exit(0);
    return false;
  }
  const bytes = await readAll(process.stdin);
  const { repos, stray } = childReposOf(touchedPaths(parseCall(bytes), parent), parent);
  // A path in the parent outside every repo is one no guard governs: a judging guard refuses the call.
  const loose = JUDGING.has(name) ? stray.filter((p) => inParent(p, parent)) : [];
  if (repos.length !== 1 || loose.length > 0) {
    if (!JUDGING.has(name)) { exit(0); return false; }
    const repoWhy = repos.length ? `${repos.join(", ")}: one repository per call` : `no repository under ${parent}`;
    const why = repos.length === 1 ? `${loose.join(", ")}, inside ${parent} but in no repository` : repoWhy;
    logger.error(`kj-hook: transversal session: this call touches ${why}`);
    exit(2);
    return false;
  }
  process.env.CLAUDE_PROJECT_DIR = repos[0];
  process.chdir(repos[0]);
  Object.defineProperty(process, "stdin", { value: Readable.from([bytes]), configurable: true, writable: true });
  return true;
};

/**
 * Run one guard: it reads the hook's input from stdin and exits on its own.
 * A name outside the list exits 2, because a wiring that names no known guard
 * cannot be trusted to guard anything. `guards` is a seam for tests.
 */
export async function runGuard(name, { logger = console, exit = (code) => process.exit(code), guards = SENTINEL_GUARDS } = {}) {
  if (!Object.hasOwn(guards, name ?? "")) {
    logger.error(`kj-hook: "${name ?? ""}" is not a Sentinel guard (${Object.keys(guards).join(", ")}) — run kj harden to rewrite the wiring`);
    exit(2);
    return;
  }
  const parent = transversalRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (parent && !(await enterChildRepo(name, parent, { logger, exit }))) return;
  await guards[name]();
}
