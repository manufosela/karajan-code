// The Sentinel's discard guard (KJC-BUG-0238/0241/0242, moved here by KJC-TSK-0916,
// ADR 0014). An agent does not discard changes it did not make. Copied byte for
// byte into .karajan/harness; `root` is the project root, injected.
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { headIndex, shortOpts } from "./sentinel-shell.mjs";

export const DISCARD_VERBS = ["checkout", "restore", "reset", "stash", "switch", "clean"];

/**
 * What a git command would discard, per simple command (a word list).
 * null = discards nothing (or is not git); {stash} = drops saved work;
 * {unknown} = cannot be read with certainty; {clean} = untracked files;
 * {paths} = working-tree changes (":/" = the whole tree, whatever the cwd).
 * @param {string[]} words
 * @param {string} root
 */
export const discardOf = (words, root) => {
  let i = headIndex(words, ["git"]); // /usr/bin/git is git
  // A $variable in command position beside a discard verb ($g checkout) cannot be read.
  if (words[i]?.startsWith("$") && words.some((w) => DISCARD_VERBS.includes(w))) return { unknown: true };
  if (words[i]?.split("/").at(-1) !== "git") return null;
  let cwd = root;
  for (i++; i < words.length && words[i].startsWith("-"); i++) {
    if (words[i] === "-C") cwd = resolve(cwd, words[++i] || ".");
    else if (words[i] === "-c") i++;
    else if (!["--no-pager", "-P", "--paginate", "-p", "--no-optional-locks"].includes(words[i])) return words.some((w) => DISCARD_VERBS.includes(w)) ? { unknown: true } : null;
  }
  const sub = words[i];
  const args = [];
  for (let j = i + 1; j < words.length; j++) {
    // Options that take a value: the value is not a flag (-e -n excludes "-n").
    // Dropping clean's excludes only makes its probe list MORE files.
    if (["-s", "--source", "-e", "--exclude"].includes(words[j]) || (sub === "clean" && /^-[a-zA-Z]*e$/.test(words[j]))) j++;
    else args.push(words[j]);
  }
  const has = (...f) => f.some((x) => args.includes(x));
  const dd = args.indexOf("--");
  const pos = (dd < 0 ? args : args.slice(0, dd)).filter((a) => !a.startsWith("-"));
  const after = dd < 0 ? [] : args.slice(dd + 1);
  const ALL = { cwd, paths: [":/"] };
  if (sub === "stash") return has("drop", "clear") ? { cwd, stash: true } : null;
  if (sub === "reset") return has("--hard") ? ALL : null;
  // Every clean but a dry run (-n in a short cluster BEFORE "--"): clean.requireForce=false deletes without -f.
  const opts = dd < 0 ? args : args.slice(0, dd);
  // Interactive clean decides at the prompt: nothing to probe, fail-closed.
  if (sub === "clean" && opts.some((a) => a === "--interactive" || shortOpts(a).includes("i"))) return { unknown: true };
  if (sub === "clean") return opts.some((a) => a === "--dry-run" || shortOpts(a).includes("n")) ? null : { cwd, clean: [opts, args.slice(opts.length)] };
  if (sub === "switch") return has("--discard-changes", "-f", "--force") ? ALL : null;
  if (sub === "restore") return has("--staged", "-S") && !has("--worktree", "-W") ? null : { cwd, paths: [...pos, ...after] };
  if (sub !== "checkout") return null;
  if (has("-f", "--force")) return ALL;
  if (has("-b", "-B", "--orphan") || !(pos.length || after.length)) return null;
  if (after.length) return { cwd, paths: after };
  const isRef = spawnSync("git", ["-C", cwd, "rev-parse", "--verify", "--quiet", `${pos[0]}^{commit}`]).status === 0;
  if (!isRef) return { cwd, paths: pos };
  return pos.length > 1 ? { cwd, paths: pos.slice(1) } : null;
};

/**
 * KJC-BUG-0261: the tracked files an `rm` or `git rm` removes, relative to root.
 * Removing a file is the session touching it, so its state is noted before it
 * goes and restoring it later is not taken for someone else's change.
 * @param {string[]} words
 * @param {string} root
 * @param {string} cwd where relative paths resolve (the session's cwd)
 * @returns {string[]}
 */
export const removedFiles = (words, root, cwd = process.cwd()) => {
  const i = headIndex(words, ["rm", "git"]);
  const head = words[i]?.split("/").at(-1);
  const isGitRm = head === "git" && words[i + 1] === "rm";
  if (head !== "rm" && !isGitRm) return [];
  const args = words.slice(i + (isGitRm ? 2 : 1));
  const dd = args.indexOf("--");
  const named = dd < 0 ? args.filter((a) => !a.startsWith("-")) : [...args.slice(0, dd).filter((a) => !a.startsWith("-")), ...args.slice(dd + 1)];
  const rels = named.map((p) => relative(root, resolve(cwd, p))).filter((r) => r && !r.startsWith("..") && !isAbsolute(r));
  if (rels.length === 0) return [];
  // ls-files expands a directory (rm -r dir) into the tracked files it holds.
  const r = spawnSync("git", ["-C", root, "ls-files", "-z", "--", ...rels], { encoding: "utf8" });
  return r.status === 0 ? String(r.stdout).split("\0").filter(Boolean) : [];
};

/**
 * Files the discard would lose that the session did not own: dirty now and not
 * clean at first touch. Anything unreadable, or another repo, is foreign.
 * @param {object} d what discardOf returned
 * @param {Record<string, string>} touch the session's first_touch ledger
 * @param {string} root
 * @returns {string[]}
 */
export const foreignLost = (d, touch, root) => {
  if (d.stash) return ["git stash"];
  if (d.unknown) return ["(comando no verificable: ejecutalo como git simple)"];
  const top = spawnSync("git", ["-C", d.cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const sameRepo = top.status === 0 && resolve(String(top.stdout).trim()) === resolve(root);
  const own = (f) => sameRepo && Object.hasOwn(touch, f) && touch[f] === "clean";
  if (d.clean) {
    // Ask git what it would remove: -n wins over -f, so the same flags (-ff included) are kept,
    // minus -q (it silences the listing) and every exclude (dropping one only lists MORE).
    // -n FIRST: after "--" it is a pathspec. LC_ALL=C: lines are parsed.
    const [opts, rest] = d.clean;
    const loud = opts.map((a) => (a.startsWith("--") ? a : `-${shortOpts(a).replaceAll("q", "")}`)).filter((a) => a !== "-" && a !== "--quiet" && !a.startsWith("--exclude"));
    const r = spawnSync("git", ["-C", d.cwd, "clean", "-n", ...loud, ...rest], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    if (r.status !== 0) return ["(git clean -n fallo)"];
    return String(r.stdout).split("\n").filter((l) => l.startsWith("Would remove ")).map((l) => relative(root, resolve(d.cwd, l.slice(13)))).filter((f) => !own(f));
  }
  // Fail-closed: a path git does not know (misparsed, $VAR, substitution) cannot
  // be proven safe; git would refuse to check it out anyway.
  if (spawnSync("git", ["-C", d.cwd, "ls-files", "--error-unmatch", "--", ...d.paths]).status !== 0) {
    // KJC-BUG-0261: what the session removed with git rm left the index, and it is still its own.
    return d.paths.map((p) => relative(root, resolve(d.cwd, p))).every(own) ? [] : [`(ruta no resoluble: ${d.paths.join(" ")})`];
  }
  const r = spawnSync("git", ["-C", d.cwd, "status", "--porcelain", "-z", "--untracked-files=no", "--", ...d.paths], { encoding: "utf8" });
  if (r.status !== 0) return ["(git status fallo)"];
  const files = [];
  const parts = String(r.stdout).split("\0");
  for (let k = 0; k < parts.length; k++) {
    if (parts[k].length < 4) continue;
    files.push(parts[k].slice(3));
    if ("RC".includes(parts[k][0])) k++;
  }
  return files.filter((f) => !own(f));
};
