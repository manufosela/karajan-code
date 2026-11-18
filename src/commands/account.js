// kj account (HU-4599, ADR 0064): add, list, remove and choose the default agent account, never by editing a file.
import path from "node:path";
import { addAccount, readAccounts, removeAccount, setDefault } from "../accounts/store.js";

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

export function accountCommand(action, args = {}, { home, print = console.log } = {}) {
  const handler = ACTIONS[action];
  if (!handler) throw new Error(`kj account: unknown action "${action}" (${Object.keys(ACTIONS).join(", ")})`);
  handler(args, { home }, print);
}
