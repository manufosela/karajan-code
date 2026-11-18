/**
 * HU-4590 (ADR 0064): a rescue API key per provider, with the rules that say when, with what and how much.
 * Kept in ~/.karajan/rescue.json (mode 0600), apart from accounts.json. kj never prints a key: only
 * rescueKey() reads it, and no error message here carries the key or the file's content.
 */
import fs from "node:fs";
import path from "node:path";
import { getKarajanHome } from "../utils/paths.js";
import { ACCOUNT_VAR } from "../utils/agent-home.js";

const fileOf = (home) => path.join(home, "rescue.json");
const fail = (message) => { throw new Error(`rescue: ${message}`); };

function readAll(home) {
  const file = fileOf(home);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // The parser's message can quote the file, and the file holds keys: say nothing of it.
    return fail(`${file} cannot be read; fix it or remove it`);
  }
}

function writeAll(data, home) {
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${fileOf(home)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, fileOf(home));
}

const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function validateWhen(when) {
  if (!isObject(when)) fail("rules.when must be an object");
  if (when.limit !== undefined && typeof when.limit !== "boolean") fail("rules.when.limit must be true or false");
  const w = when.window;
  if (w !== undefined && !(isObject(w) && isHour(w.from) && isHour(w.to) && w.from !== w.to)) {
    fail("rules.when.window needs two different local hours, from and to, from 0 to 23");
  }
}

function validateRules(rules) {
  if (!isObject(rules)) fail("rules must be an object");
  if (rules.when !== undefined) validateWhen(rules.when);
  for (const name of ["roles", "models"]) {
    const list = rules[name];
    if (list !== undefined && !(Array.isArray(list) && list.every((s) => typeof s === "string"))) {
      fail(`rules.${name} must be a list of strings`);
    }
  }
  for (const name of ["dailyBudget", "monthlyBudget"]) {
    const value = rules[name];
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) fail(`rules.${name} must be a number >= 0`);
  }
}

export function setRescue(provider, { key, rules = {} } = {}, { home = getKarajanHome() } = {}) {
  if (!ACCOUNT_VAR[provider]) fail(`unknown provider "${provider}" (${Object.keys(ACCOUNT_VAR).join(", ")})`);
  if (typeof key !== "string" || key.trim() === "") fail("the key must be a non-empty string");
  validateRules(rules);
  const data = readAll(home);
  data[provider] = { key, rules: structuredClone(rules) };
  writeAll(data, home);
}

/** @returns {{rules: object, hasKey: boolean}} the rules and whether a key is stored, never the key. */
export function rescueFor(provider, { home = getKarajanHome() } = {}) {
  const entry = readAll(home)[provider];
  return { rules: entry?.rules ?? {}, hasKey: typeof entry?.key === "string" };
}

/** The only reader of the key: the seam slice 2 uses to launch an agent on it. */
export function rescueKey(provider, { home = getKarajanHome() } = {}) {
  return readAll(home)[provider]?.key ?? null;
}

const inWindow = (hour, { from, to }) => (from < to ? hour >= from && hour < to : hour >= from || hour < to);

function whenMet(when, now, limitReached) {
  if (!when || (when.limit === undefined && when.window === undefined)) return true;
  return (when.limit === true && limitReached) || (when.window !== undefined && inWindow(now.getHours(), when.window));
}

const outside = (list, value) => list !== undefined && !list.includes(value);
const exhausted = (budget, spent) => budget !== undefined && spent >= budget;

/** Pure: may the rescue key serve this call? Checks no-key, not-yet, role, model, daily, monthly, in that order. */
export function rescueDecision({ rules = {}, hasKey, now, spent = {}, role, model, limitReached = false }) {
  const deny = (reason) => ({ allow: false, reason });
  if (!hasKey) return deny("no-key");
  if (!whenMet(rules.when, now, limitReached)) return deny("not-yet");
  if (outside(rules.roles, role)) return deny("role");
  if (outside(rules.models, model)) return deny("model");
  if (exhausted(rules.dailyBudget, spent.day ?? 0)) return deny("daily-budget");
  if (exhausted(rules.monthlyBudget, spent.month ?? 0)) return deny("monthly-budget");
  return { allow: true };
}
