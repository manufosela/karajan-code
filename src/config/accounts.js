/**
 * Agent accounts (HU-4587): a list of { id, provider, home, default } kept in
 * the user config. Pure helpers: validate the list, pick the default account
 * of a provider and turn it into the env variable that selects it.
 * Never reads, prints or logs the contents of an account directory.
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** provider -> env variable that points the CLI at the account directory */
export const ACCOUNT_ENV_BY_PROVIDER = Object.freeze({
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
});

/** Expand a leading `~` in an account home. */
export function expandHome(home) {
  if (home === "~") return homedir();
  return home.startsWith("~/") ? join(homedir(), home.slice(2)) : home;
}

/**
 * Validate the list. Returns a message naming the offending entry, or null.
 * @param {Array<{id: string, provider: string, home: string, default?: boolean}>} accounts
 * @returns {string|null}
 */
export function accountsProblem(accounts) {
  const ids = new Set();
  const defaults = new Set();
  for (const account of accounts) {
    const { id, provider } = account;
    if (!Object.hasOwn(ACCOUNT_ENV_BY_PROVIDER, provider)) {
      return `accounts: account "${id}" has unknown provider "${provider}" (use claude or codex)`;
    }
    if (ids.has(id)) return `accounts: duplicate account id "${id}"`;
    ids.add(id);
    if (account.default !== true) continue;
    if (defaults.has(provider)) {
      return `accounts: account "${id}" is a second default for provider "${provider}"`;
    }
    defaults.add(provider);
  }
  return null;
}

/** The default account of a provider, or undefined. */
export function pickDefaultAccount(accounts, provider) {
  return (accounts ?? []).find((a) => a.provider === provider && a.default === true);
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function assertDirectory(account, home) {
  if (!isDirectory(home)) {
    throw new Error(`Agent account "${account.id}": directory does not exist: ${home}`);
  }
}

/**
 * Env variable that selects the default account of a provider.
 * `{}` when no account applies. Throws when the account directory is missing.
 * @returns {Record<string, string>}
 */
export function accountEnv(accounts, provider) {
  const account = pickDefaultAccount(accounts, provider);
  if (!account) return {};
  const home = expandHome(account.home);
  assertDirectory(account, home);
  return { [ACCOUNT_ENV_BY_PROVIDER[provider]]: home };
}
