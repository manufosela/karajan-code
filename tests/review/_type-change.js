// HU-4046: shared fixture for the review suites. A source path whose TYPE changes (a
// symlink turned into a file with code) is a T to git, not an M: a file set built from
// --diff-filter=ACMR never sees it, so the Sonar proof was asked of nobody.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const gitIn = (dir) => (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" });

/** Commits `file` as a symlink, then stages it back as a regular file with code. */
export function stageTypeChange(dir, file = "x.js") {
  const git = gitIn(dir);
  fs.symlinkSync("y.js", path.join(dir, file));
  git("add", file);
  git("commit", "-qm", "chore: link");
  fs.rmSync(path.join(dir, file));
  fs.writeFileSync(path.join(dir, file), "export const x = 1;\n");
  git("add", file);
}

/** The commit whose only change is that type change: its sha and the diff its verdict binds to. */
export function typeChangeCommit(dir, file = "x.js") {
  const git = gitIn(dir);
  stageTypeChange(dir, file);
  git("commit", "-qm", "feat: x");
  const oid = git("rev-parse", "HEAD").trim();
  return { oid, diff: git("diff", `${oid}^`, oid) };
}
