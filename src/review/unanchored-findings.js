// HU-4837 (KJC-TSK-1731, épica KJC-PCS-0113): the blocking findings of a rejection are anchored
// (anchorFinding) before they reach the coder. What does not hold is kept apart, never deleted in
// silence; a protected one (security, critical) keeps blocking. kj never turns a rejection into an approval.
import { readFileSync, realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { anchorFinding } from "./finding-anchor.js";

/** Reads a project file; null when it is missing or its real path (symlinks resolved) leaves the project. */
export const projectFileReader = (projectDir) => (file) => {
  try {
    const root = realpathSync(resolve(projectDir ?? process.cwd()));
    const target = realpathSync(resolve(root, String(file)));
    const rel = relative(root, target);
    if (rel.split(sep)[0] === ".." || isAbsolute(rel)) return null;
    return readFileSync(target, "utf8");
  } catch { return null; }
};

/**
 * Splits the blocking findings: `blocking` keeps the ones that hold (and the protected ones, marked
 * `unanchored: <reason>`); `unanchored` is what does not hold, each with its reason.
 */
export const splitFindings = (issues, { diff, readFile }) => {
  const blocking = [];
  const unanchored = [];
  for (const issue of issues ?? []) {
    const { anchored, reason, protected: isProtected } = anchorFinding(issue, { diff, readFile });
    if (anchored) blocking.push(issue);
    else if (isProtected) blocking.push({ ...issue, unanchored: reason });
    else unanchored.push({ ...issue, reason });
  }
  return { blocking, unanchored };
};

const lineSuffix = (line) => (line ? `:${line}` : "");

/** The note appended to the reviewer prompt when its rejection held only findings that do not anchor. */
export const unanchoredNote = (unanchored) => [
  "",
  "Your previous rejection cited only findings that do not anchor to the code:",
  ...unanchored.map((f) => `- ${f.id ?? "?"} (${f.file ?? "no file"}${lineSuffix(f.line)}): ${f.reason}`),
  "Cite the real file, line and code, or approve if nothing blocks the commit.",
].join("\n");
