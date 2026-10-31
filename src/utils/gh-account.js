/**
 * KJC-BUG-0458 (ADR 0040): with several gh accounts and parallel sessions, another session can
 * switch the active account between `gh auth switch` and the gh calls kj makes, so kj posted a
 * review under the wrong account. At startup kj pins GH_TOKEN to the repo's account, so every
 * gh it runs inherits that token whatever the active account is by then. The account is the
 * configured one, or else the owner of the origin remote. A token already set is never touched.
 */
import { execFileSync } from "node:child_process";

// The owner segment of github.com remotes: https, ssh and ssh host aliases
// (github.com-work:owner/repo.git). Any other host is not gh's to answer for.
const OWNER = /(?:^|[@/])github\.com(?:-[\w.-]+)?[:/]([^/:\s]+)\/[^/\s]+?(?:\.git)?\/?$/;

/** The owner of a github.com remote URL, or null for any other host. */
export function remoteOwner(url) {
  return OWNER.exec(String(url ?? "").trim())?.[1] ?? null;
}

const quiet = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * Pin GH_TOKEN for every gh child of this process.
 * @returns {{account: string|null, reason: string|null}} the pinned account, or why none was
 */
export function pinGhAccount({ env = process.env, cwd = process.cwd(), account = null, exec = quiet } = {}) {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return { account: null, reason: null };
  let login = account;
  if (!login) {
    try { login = remoteOwner(exec("git", ["remote", "get-url", "origin"], cwd)); } catch { login = null; }
  }
  if (!login) return { account: null, reason: null };
  let token;
  try { token = exec("gh", ["auth", "token", "--user", login], cwd); } catch { token = ""; }
  if (!token) return { account: null, reason: `gh has no logged-in account ${login}: gh calls use the active account` };
  env.GH_TOKEN = token;
  return { account: login, reason: null };
}
