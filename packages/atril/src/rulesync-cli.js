/**
 * The one place atril resolves and runs rulesync (ADR 0021, decision 11; ADR 0022): the project's own
 * binary, or `npx --no-install`, never a package fetched on the fly. Callers word their own failures.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const defaultRun = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

/** @returns {[string, string[]]} the command and arguments that run rulesync for `projectDir` */
export function rulesyncCommand(projectDir, args) {
  const local = join(projectDir, "node_modules", ".bin", "rulesync");
  return existsSync(local) ? [local, args] : ["npx", ["--no-install", "rulesync", ...args]];
}

/**
 * @param {string[]} args
 * @param {{ projectDir: string, cwd?: string }} where binary is resolved from `projectDir`, run in `cwd`
 * @param {(cmd: string, args: string[], cwd: string) => unknown} [run]
 */
export function runRulesync(args, { projectDir, cwd = projectDir }, run = defaultRun) {
  const [cmd, cmdArgs] = rulesyncCommand(projectDir, args);
  return run(cmd, cmdArgs, cwd);
}
