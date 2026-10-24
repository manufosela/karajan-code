// KJC-TSK-1174 (RAG-A1): what the working tree holds beyond HEAD, for the pre-query refresh.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execa } from "execa";
import { projectDbPath } from "./project-store.js";

/** Files git does not track yet and does not ignore: the ones a session has just created. */
export async function untrackedFiles(projectDir) {
  const { stdout } = await execa("git", ["-C", projectDir, "ls-files", "--others", "--exclude-standard", "-z"]);
  return stdout.split("\0").filter(Boolean);
}

// The dirty paths the last refresh indexed, next to the store. Reverted or deleted since, git no
// longer lists them, yet the index holds their discarded content: the next refresh reconciles them.
const notePath = (projectDir) => `${projectDbPath(projectDir)}.worktree-paths`;

export function readRefreshedPaths(projectDir) {
  const file = notePath(projectDir);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

export function writeRefreshedPaths(projectDir, paths) {
  const file = notePath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(paths), "utf8");
}
