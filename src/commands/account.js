// kj account (HU-4599, ADR 0064): add, list, remove and choose the default agent account, never by editing a file.
import path from "node:path";
import { addAccount, assignAccounts, clearProject, readAccounts, removeAccount, setDefault, setPace } from "../accounts/store.js";
import { projectKey } from "../accounts/project-key.js";
import { sessionWarnings, tellableProviders } from "../accounts/session.js";

const describePace = ({ gapSeconds, maxConcurrent, limitWaitSeconds } = {}) => [
  gapSeconds === undefined ? null : `${gapSeconds}s between calls`,
  maxConcurrent === undefined ? null : `at most ${maxConcurrent} at once`,
  limitWaitSeconds === undefined ? null : `${limitWaitSeconds}s after a limit`,
].filter(Boolean).join(", ");

const asNumber = (value) => (value === undefined ? undefined : Number(value));

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
  // HU-4608: an account's pacing (HU-4591); the fields not given keep their value.
  pace: ({ id, gap, max, limitWait }, opts, print) => {
    const account = readAccounts(opts).accounts.find((a) => a.id === id);
    if (!account) throw new Error(`accounts: no account "${id}"`);
    const given = { gapSeconds: asNumber(gap), maxConcurrent: asNumber(max), limitWaitSeconds: asNumber(limitWait) };
    if (Object.values(given).every((v) => v === undefined)) {
      const current = describePace(account.pace);
      return print(current ? `${id}: ${current}` : `${id} has no pace: its calls run as they come`);
    }
    const pace = { ...account.pace };
    for (const [name, value] of Object.entries(given)) if (value !== undefined) pace[name] = value;
    setPace(id, pace, opts);
    print(`✓ ${id}: ${describePace(pace)}`);
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
  // HU-4595: does this session run on one of the project's accounts?
  check: (_args, opts, print) => {
    if (tellableProviders().length === 0) return print("cannot tell which login this session uses");
    const lines = sessionWarnings({ projectKey: projectKey(opts.cwd), home: opts.home });
    for (const line of lines.length ? lines : ["ok"]) print(line);
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
