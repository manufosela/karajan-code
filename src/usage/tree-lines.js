// HU-4619: how many lines the working tree adds and removes against HEAD, new untracked files included,
// so kj code can put its coder's lines in the usage record (a difference of two counts, before and after).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// kj's own state (run log, traces) is written during the call too; it is never the coder's work.
const NOT_KJ_STATE = ["--", ".", ":(exclude).kj", ":(exclude).karajan"];
const git = (projectDir, args) => execFileSync("git", args, { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function textLines(file) {
  const content = fs.readFileSync(file, "utf8");
  if (content.includes("\0")) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/** {added, removed} of the tree against HEAD; binary files count 0. Throws outside a git repo with a commit. */
export function treeLines(projectDir) {
  let added = 0;
  let removed = 0;
  for (const row of git(projectDir, ["diff", "--numstat", "HEAD", ...NOT_KJ_STATE]).split("\n").filter(Boolean)) {
    const [plus, minus] = row.split("\t");
    if (plus === "-") continue;
    added += Number(plus);
    removed += Number(minus);
  }
  for (const file of git(projectDir, ["ls-files", "--others", "--exclude-standard", "-z", ...NOT_KJ_STATE]).split("\0").filter(Boolean)) {
    added += textLines(path.join(projectDir, file));
  }
  return { added, removed };
}

/** A measure for the coder's call: the lines it added and removed since `before`, never below zero. */
export function linesSince(projectDir, before) {
  return () => {
    const after = treeLines(projectDir);
    return { linesAdded: Math.max(0, after.added - before.added), linesRemoved: Math.max(0, after.removed - before.removed) };
  };
}
