// kj account (HU-4599, ADR 0064): add, list, remove and choose the default agent account, never by editing a file.
import path from "node:path";
import { addAccount, assignAccounts, clearProject, readAccounts, removeAccount, setDefault } from "../accounts/store.js";
import { projectKey } from "../accounts/project-key.js";

const ACTIONS = {
  add: ({ id, provider, dir }, opts, print) => {
    addAccount({ id, provider, dir: path.resolve(String(dir)) }, opts);
    const isDefault = readAccounts(opts).default[provider] === id;
    print(`✓ account ${id} added for ${provider}${isDefault ? " (its default)" : ""}`);
  },
  list: (_args, opts, print) => {
    const { accounts, default: defaults } = readAccounts(opts);
    if (accounts.length === 0) return print("no accounts: kj launches each agent with the login it inherits");
    for (const a of accounts) print(`${defaults[a.provider] === a.id ? "*" : " "} ${a.id}  ${a.provider}  ${a.dir}`);
    const key = projectKey(opts.cwd);
    for (const [provider, ids] of Object.entries(readAccounts(opts).projects[key] ?? {})) {
      print(`${path.basename(key)}: ${provider} ${ids.join(", ")}`);
    }
  },
  // HU-4588: the project's order per provider; the first account is the one kj launches.
  use: ({ ids = [], clear }, opts, print) => {
    const key = projectKey(opts.cwd);
    if (clear) {
      clearProject(key, opts);
      return print(`✓ ${path.basename(key)} back to the default accounts`);
    }
    if (ids.length === 0) throw new Error("kj account use: name at least one account, or --clear");
    const { accounts } = readAccounts(opts);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const missing = ids.find((id) => !byId.has(id));
    if (missing) throw new Error(`accounts: no account "${missing}"`);
    for (const [provider, list] of Object.entries(Object.groupBy(ids, (id) => byId.get(id).provider))) {
      assignAccounts(key, provider, list, opts);
      print(`✓ ${path.basename(key)} uses ${provider}: ${list.join(", ")}`);
    }
  },
  remove: ({ id }, opts, print) => {
    removeAccount(id, opts);
    print(`✓ account ${id} removed`);
  },
  default: ({ id }, opts, print) => {
    setDefault(id, opts);
    const { provider } = readAccounts(opts).accounts.find((a) => a.id === id);
    print(`✓ ${id} is now the default ${provider} account`);
  },
};

export function accountCommand(action, args = {}, { home, cwd = process.cwd(), print = console.log } = {}) {
  const handler = ACTIONS[action];
  if (!handler) throw new Error(`kj account: unknown action "${action}" (${Object.keys(ACTIONS).join(", ")})`);
  handler(args, { home, cwd }, print);
}
