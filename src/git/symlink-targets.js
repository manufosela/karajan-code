/**
 * KJC-BUG-0414 (#2606, from #2564): Solomon told the coder to drop a file from the commit as a
 * mirror of another, but the other was a symlink to it: the link would be committed dangling.
 * kj names the in-repo targets of the symlinks in a change, and a condition that takes one of
 * them out of the commit is dropped before it reaches the coder.
 */
import { lstatSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The in-repo target of each symlink among `paths` (relative to projectDir). */
export function symlinkTargets(projectDir, paths) {
  const root = resolve(projectDir);
  return paths.flatMap((link) => {
    try {
      const abs = join(root, link);
      if (!lstatSync(abs).isSymbolicLink()) return [];
      const target = relative(root, resolve(dirname(abs), readlinkSync(abs)));
      const outside = target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target);
      return target && !outside ? [{ link, target: target.split(sep).join("/") }] : [];
    } catch {
      return [];
    }
  });
}

// A `*` matches within one path segment, as in the shell.
const segmentMatches = (pattern, name) => {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === name;
  if (!name.startsWith(parts[0]) || !name.endsWith(parts.at(-1))) return false;
  let at = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return at <= name.length - parts.at(-1).length;
};
const globMatches = (pattern, path) => {
  const p = pattern.split("/");
  const t = path.split("/");
  return p.length === t.length && p.every((seg, i) => segmentMatches(seg, t[i]));
};
const REMOVES = /\b(unstage|remove|drop|exclude|delete|restore|reset|revert|rm|untrack|quitar|sacar|eliminar|excluir|borrar)\b/i;
// Quoted strings are one token (a path may hold spaces); bare tokens lose surrounding punctuation.
const TOKENS = /"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+)/g;
const tokensOf = (text) => [...String(text).matchAll(TOKENS)]
  .map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]).replace(/^[([{]+/, "").replace(/[)\]}:;,]+$/, ""));
// Named literally anywhere in the text (any character git allows), or by a glob token.
const names = (condition, target) => String(condition).includes(target) || tokensOf(condition).some((t) => globMatches(t, target));

/** Splits Solomon's conditions: the ones that would take a symlink's target out of the commit go to `dropped`. */
export function keepSymlinkTargets(conditions, targets) {
  const takesTargetOut = (condition) => REMOVES.test(condition) && targets.some(({ target }) => names(condition, target));
  const dropped = targets.length ? conditions.filter(takesTargetOut) : [];
  return { kept: conditions.filter((c) => !dropped.includes(c)), dropped };
}
