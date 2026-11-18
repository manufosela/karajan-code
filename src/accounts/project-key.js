/**
 * HU-4588 (ADR 0064): the key a project's account order is stored under. Every worktree of a repo
 * shares the main worktree's path, so one order serves all lanes; outside git it is the cwd.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function projectKey(cwd = process.cwd()) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return fs.realpathSync(path.dirname(common));
  } catch {
    // a cwd that does not exist is the spawn's error to report, not the key's
    return fs.existsSync(cwd) ? fs.realpathSync(cwd) : path.resolve(cwd);
  }
}
