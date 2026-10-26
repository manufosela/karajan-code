// KJC-TSK-1186: the shared board is written as whoever gh is logged in as. With several GitHub
// accounts on one machine, another session switching the active one turned `kj hu move` into an
// opaque GraphQL permission error, three times in a day. The clone declares its account in
// .karajan/identity.local.yml (ADR 0005): with a declaration, the active account must be it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { readIdentity } from "../identity/store.js";
import { BoardRejectedError } from "./github-board.js";

/** Where gh keeps its accounts, honouring the same overrides gh does. */
export function ghHostsPath(env = process.env) {
  const dir = env.GH_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gh");
  return join(dir, "hosts.yml");
}

/** The account gh would use now for github.com, or null when gh has none. */
export function activeGhUser(env = process.env) {
  let raw;
  try {
    raw = readFileSync(ghHostsPath(env), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const user = yaml.load(raw)?.["github.com"]?.user;
  return typeof user === "string" && user.length > 0 ? user : null;
}

/**
 * With an identity declared, the active gh account must be it; the error carries the exact remedy.
 * Without a declaration nothing is asserted: gh answers for itself.
 * @returns {{ declared: string | null, active: string | null }}
 */
export function assertGhIdentity({ projectDir, env = process.env }) {
  const declared = readIdentity(projectDir)?.gh_user ?? null;
  if (!declared) return { declared: null, active: null };
  const active = activeGhUser(env);
  if (active && active !== declared) {
    throw new BoardRejectedError(`the active gh account is ${active} and this clone declares ${declared}: run gh auth switch --user ${declared} and retry`);
  }
  return { declared, active };
}

/** The token gh keeps for `user`, read without switching the active account; null when it has none. */
function ghTokenOf(user, env) {
  const res = spawnSync("gh", ["auth", "token", "--hostname", "github.com", "--user", user], { env, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() || null : null;
}

/**
 * KJC-BUG-0406: checking the active account and then calling gh was a race; another session could
 * switch it in between. With an identity declared, GH_TOKEN is pinned to that account's token for
 * the rest of the command, so every gh call goes out as it. A token already in the environment is
 * the user's explicit choice and is left alone.
 * @returns {{ declared: string | null, pinned: boolean }}
 */
export function pinGhIdentity({ projectDir, env = process.env, tokenOf = ghTokenOf }) {
  const declared = readIdentity(projectDir)?.gh_user ?? null;
  if (!declared || env.GH_TOKEN || env.GITHUB_TOKEN) return { declared, pinned: false };
  const token = tokenOf(declared, env);
  if (!token) throw new BoardRejectedError(`gh has no login for ${declared}, the account this clone declares: run gh auth login and retry`);
  env.GH_TOKEN = token;
  return { declared, pinned: true };
}
