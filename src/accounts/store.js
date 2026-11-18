/**
 * HU-4587 (ADR 0064): the agent accounts, one list under ~/.karajan/accounts.json, written only by kj.
 * An account names its provider and the directory of its login; each provider has one default account.
 * No account added: no file, and every agent runs on the login it inherits, as before.
 */
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { ACCOUNT_VAR } from "../utils/agent-home.js";

const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const fileOf = (home) => path.join(home, "accounts.json");

/** @returns {{accounts: {id: string, provider: string, dir: string}[], default: Record<string, string>}} */
export function readAccounts({ home = getKarajanHome() } = {}) {
  const file = fileOf(home);
  if (!fs.existsSync(file)) return { accounts: [], default: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { accounts: data.accounts ?? [], default: data.default ?? {} };
  } catch (error) {
    throw new Error(`accounts: ${file} cannot be read (${error.message}); fix it or remove it`, { cause: error });
  }
}

function write(data, home) {
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${fileOf(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, fileOf(home));
}

function find(data, id) {
  const account = data.accounts.find((a) => a.id === id);
  if (!account) throw new Error(`accounts: no account "${id}"`);
  return account;
}

export function addAccount({ id, provider, dir }, { home = getKarajanHome() } = {}) {
  if (!ID.test(String(id))) throw new Error(`accounts: the id "${id}" must be lowercase letters, digits, - or _ (up to 40)`);
  if (!ACCOUNT_VAR[provider]) throw new Error(`accounts: unknown provider "${provider}" (${Object.keys(ACCOUNT_VAR).join(", ")})`);
  if (!path.isAbsolute(String(dir))) throw new Error(`accounts: the login dir must be an absolute path, got "${dir}"`);
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`accounts: ${dir} is not a directory`);
  const data = readAccounts({ home });
  if (data.accounts.some((a) => a.id === id)) throw new Error(`accounts: the account "${id}" is already added`);
  data.accounts.push({ id, provider, dir });
  data.default[provider] ??= id;
  write(data, home);
}

export function removeAccount(id, { home = getKarajanHome() } = {}) {
  const data = readAccounts({ home });
  const { provider } = find(data, id);
  data.accounts = data.accounts.filter((a) => a.id !== id);
  if (data.default[provider] === id) delete data.default[provider];
  write(data, home);
}

export function setDefault(id, { home = getKarajanHome() } = {}) {
  const data = readAccounts({ home });
  data.default[find(data, id).provider] = id;
  write(data, home);
}

/** The env that moves an agent to its provider's default account, {} when it has none. */
export function accountEnv(agent, { home = getKarajanHome() } = {}) {
  const name = ACCOUNT_VAR[agent];
  if (!name) return {};
  const data = readAccounts({ home });
  const id = data.default[agent];
  return id ? { [name]: find(data, id).dir } : {};
}
