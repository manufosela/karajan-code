/**
 * Identity lock — detect (IDN-A, KJC-TSK-0762). What is EFFECTIVE right now,
 * with no network and no spawned `gh`: the active gh account is read from
 * gh's own hosts.yml (the file `gh auth switch` mutates), the git email from
 * `git config user.email`. Both return null when unknown — never a guess.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";

export function defaultHostsPath() {
  const base = process.env.GH_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh");
  return join(base, "hosts.yml");
}

/**
 * @param {{hostsPath?: string, host?: string}} [opts]
 * @returns {string|null} active gh login for the host, null without a session
 */
export function activeGhUser({ hostsPath = defaultHostsPath(), host = "github.com" } = {}) {
  if (!existsSync(hostsPath)) return null;
  try {
    const parsed = yaml.load(readFileSync(hostsPath, "utf8"));
    const user = parsed?.[host]?.user;
    return typeof user === "string" && user.length > 0 ? user : null;
  } catch {
    return null;
  }
}

const defaultGitFn = (projectDir) =>
  execFileSync("git", ["config", "--get", "user.email"], { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * @param {string} projectDir
 * @param {{gitFn?: (projectDir: string) => string}} [opts]
 * @returns {string|null}
 */
export function effectiveGitEmail(projectDir, { gitFn = defaultGitFn } = {}) {
  try {
    // --get yields the single effective value; keep the last line anyway so a
    // multi-line answer from an odd config can never leak a newline into it.
    const out = String(gitFn(projectDir) || "").trim().split("\n").at(-1).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
