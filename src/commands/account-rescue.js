// kj account rescue (HU-4688, ADR 0064 decision 4): set and show a provider's rescue key and its rules.
// The key comes from stdin or an env var, never from argv, and is never printed or put in an error.
import { removeRescue, rescueFor, rescueKey, setRescue } from "../accounts/rescue.js";

const fail = (message) => { throw new Error(`kj account rescue: ${message}`); };
const list = (text, flag) => {
  const items = String(text).split(",").map((s) => s.trim());
  if (items.some((s) => s === "")) fail(`${flag} needs a comma separated list with no empty item`);
  return items;
};

function parseWindow(text) {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(String(text));
  if (!match) fail(`--window "${text}" must be <from>-<to>, local hours like 22-6`);
  return { from: Number(match[1]), to: Number(match[2]) };
}

/** The rules the flags give; a flag not given leaves its rule out. */
export function rulesFromFlags({ limit, window, roles, models, daily, monthly }) {
  const rules = {};
  const when = {};
  if (limit) when.limit = true;
  if (window !== undefined) when.window = parseWindow(window);
  if (Object.keys(when).length) rules.when = when;
  if (roles !== undefined) rules.roles = list(roles, "--roles");
  if (models !== undefined) rules.models = list(models, "--models");
  if (daily !== undefined) rules.dailyBudget = Number(daily);
  if (monthly !== undefined) rules.monthlyBudget = Number(monthly);
  return rules;
}

const mergeRules = (stored, given) => ({
  ...stored, ...given, ...(given.when ? { when: { ...stored.when, ...given.when } } : {}),
});

export function describeRules({ when = {}, roles, models, dailyBudget, monthlyBudget } = {}) {
  const parts = [
    when.limit ? "when the limit is reached" : null,
    when.window ? `between ${when.window.from} and ${when.window.to}` : null,
    roles ? `roles ${roles.join(",")}` : null,
    models ? `models ${models.join(",")}` : null,
    dailyBudget === undefined ? null : `daily ${dailyBudget}`,
    monthlyBudget === undefined ? null : `monthly ${monthlyBudget}`,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "no rules";
}

function readKey({ keyStdin, keyEnv }, { readStdin, env }) {
  if (keyStdin && keyEnv !== undefined) fail("--key-stdin and --key-env are exclusive: give the key one way");
  if (keyStdin) return readStdin().trim();
  if (keyEnv === undefined) return null;
  const value = env[keyEnv];
  if (value === undefined) fail(`the environment variable ${keyEnv} is not set`);
  return value.trim();
}

export function rescueAction({ provider, remove, ...flags }, opts, print) {
  const { home } = opts;
  if (remove) {
    removeRescue(provider, { home });
    return print(`✓ rescue key for ${provider} removed`);
  }
  const given = rulesFromFlags(flags);
  const fresh = readKey(flags, opts);
  const { rules: stored, hasKey } = rescueFor(provider, { home });
  if (fresh === null && Object.keys(given).length === 0) {
    if (!hasKey) return print(`no rescue key for ${provider}`);
    return print(`rescue for ${provider}: key set; ${describeRules(stored)}`);
  }
  const key = fresh ?? rescueKey(provider, { home });
  if (key === null) fail(`no key stored for ${provider}: give it with --key-stdin or --key-env <NAME>`);
  const rules = mergeRules(stored, given);
  setRescue(provider, { key, rules }, { home });
  print(`✓ rescue rules for ${provider}: ${describeRules(rules)}; key set`);
}
