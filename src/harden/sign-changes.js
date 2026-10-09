/**
 * KJC-TSK-0992 (HUM-G, ADR 0018): what the phone is asked to sign, said.
 *
 * The signing page used to show a project name and a list of files with their
 * sha256: nothing a person can read as "this is what changes". The signature
 * still covers exactly the sha256 (payload v2); this module describes, file by
 * file, what kj regenerated so the page can show it: new, modified or deleted,
 * lines added and removed, a one-line summary and the unified diff, cut to a
 * size the request can carry and scanned for personal data before it leaves.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { scanText } from "../privacy/scan.js";

export const DIFF_LIMIT_PER_FILE = 12_000;
export const DIFF_LIMIT_TOTAL = 400_000;

const defaultGit = (projectDir) => (args) => {
  try {
    return execFileSync("git", args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    // `git diff --no-index` exits 1 when the files differ: the diff is still on stdout.
    if (args.includes("--no-index") && typeof err?.stdout === "string") return err.stdout;
    throw err;
  }
};

const inHead = (git, file) => { try { git(["cat-file", "-e", `HEAD:${file}`]); return true; } catch { return false; } };

/** The first comment kj added, which in a generated hook says why it changed. */
const summaryOf = (diff) => {
  const comment = diff.split("\n").find((l) => /^\+\s*(#|\/\/)\s*\S/.test(l) && !l.startsWith("+++"));
  return comment ? comment.replace(/^\+\s*(#|\/\/)\s*/, "").trim().slice(0, 160) : "";
};

/** A file git does not know yet: the whole file is the addition. */
const newFile = (git, projectDir, file) => ({
  raw: git(["diff", "--no-index", "--", "/dev/null", join(projectDir, file)]),
  added: readFileSync(join(projectDir, file), "utf8").split("\n").filter(Boolean).length,
  removed: 0,
});
/** A tracked file, changed or deleted: the diff against HEAD and its numstat. */
const trackedFile = (git, file) => {
  const stat = git(["diff", "--numstat", "HEAD", "--", file]).trim().split("\t");
  return { raw: git(["diff", "HEAD", "--", file]), added: Number.parseInt(stat[0], 10) || 0, removed: Number.parseInt(stat[1], 10) || 0 };
};

const MARKER_ROOM = 60;
/** Cut `text` so the result, marker included, never exceeds `limit`; no room left is one bounded marker. */
const cut = (text, limit) => {
  if (text.length <= limit) return { diff: text, truncated: false };
  const keep = Math.max(0, limit - MARKER_ROOM);
  return { diff: `${text.slice(0, keep)}\n… [cut: ${text.length - keep} more characters]`.slice(0, limit), truncated: true };
};

/**
 * @param {{projectDir: string, files: Array<{file: string, deleted?: boolean}>, gitFn?: Function, scan?: Function}} opts
 * @returns {Array<{file: string, status: "new"|"modified"|"deleted", added: number, removed: number, summary: string, diff: string, truncated: boolean}>}
 */
export function describeSupervisorChanges({ projectDir, files, gitFn = defaultGit(projectDir), scan = scanText }) {
  let budget = DIFF_LIMIT_TOTAL;
  return files.map(({ file, deleted }) => {
    const tracked = inHead(gitFn, file);
    const present = !deleted && existsSync(join(projectDir, file));
    let status = "modified";
    if (deleted || !present) status = "deleted";
    else if (!tracked) status = "new";
    const measured = status === "new" ? newFile(gitFn, projectDir, file) : trackedFile(gitFn, file);
    const { added, removed } = measured;
    // What leaves the machine is scanned like anything kj publishes: a hit
    // replaces the diff, never travels.
    const hits = scan(measured.raw, { source: file }).filter((h) => h.severity === "block");
    const raw = hits.length > 0 ? `[diff withheld: the privacy scan found ${hits.length} sensitive item(s) in ${file}]` : measured.raw;
    // Per file and in total: what the request carries never exceeds the limits.
    const { diff, truncated } = cut(raw, Math.min(DIFF_LIMIT_PER_FILE, Math.max(0, budget)));
    budget = Math.max(0, budget - diff.length);
    return { file, status, added, removed, summary: summaryOf(raw), diff, truncated };
  });
}
