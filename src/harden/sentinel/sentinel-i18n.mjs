// HU-5055: the Sentinel's messages in the configured language, or the system's.
// It runs as a hook, so it uses only node built-ins.
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SUPPORTED = ["en", "es"];
const FALLBACK = "en";
const LOCALE_VARS = ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"];
const HOME_VARS = ["KARAJAN_HOME", "KJ_HOME"];
const LANGUAGE_LINE = /^language:\s*["']?([A-Za-z-]+)/m;

const CATALOG = {
  en: {
    governs: "karajan: Karajan governs and is obeyed. Do not go around the gate or change the policy to pass it; if you think it is unfair, tell your user or use kj report-issue.",
    governance_file: "karajan sentinel: {file} is governance configuration (policies, gates, exclusions): your user changes it, not the session. If a gate seems unfair, propose it to your user or use kj report-issue.",
  },
  es: {
    governs: "karajan: Karajan gobierna y se le obedece. No rodees el gate ni cambies la política para pasarlo; si te parece injusto, díselo a tu usuario o usa kj report-issue.",
    governance_file: "karajan sentinel: {file} es configuración de gobierno (políticas, gates, exclusiones): la cambia tu usuario, no la sesión. Si un gate te parece injusto, propónselo a tu usuario o usa kj report-issue.",
  },
};

const normalize = (code) => {
  const lang = String(code).slice(0, 2).toLowerCase();
  return SUPPORTED.includes(lang) ? lang : FALLBACK;
};

const configLanguage = (file) => {
  if (!existsSync(file)) return null;
  const match = LANGUAGE_LINE.exec(readFileSync(file, "utf8"));
  return match ? match[1] : null;
};

const localeLanguage = (env) => LOCALE_VARS.map((name) => env[name]).find(Boolean) ?? null;

/** Mirrors paths.js (the hook cannot import karajan-core). @param {Record<string, string | undefined>} [env] @returns {string} */
export const karajanHome = (env = process.env) => {
  const set = HOME_VARS.map((name) => env[name]).find(Boolean);
  return set === undefined ? join(homedir(), ".karajan") : resolve(set);
};

/** @param {{ projectDir: string, home?: string, env?: Record<string, string | undefined> }} options @returns {"en" | "es"} */
export const sentinelLang = ({ projectDir, env = process.env, home = karajanHome(env) }) => {
  const found = configLanguage(join(projectDir, ".karajan", "kj.config.yml")) ?? configLanguage(join(home, "kj.config.yml")) ?? localeLanguage(env);
  return found === null ? FALLBACK : normalize(found);
};

const lookup = (lang, key) => (Object.hasOwn(CATALOG[lang] ?? {}, key) ? CATALOG[lang][key] : CATALOG[FALLBACK][key]);

const fillParams = (template, params) => template.replace(/\{(\w+)\}/g, (_, name) => {
  if (!Object.hasOwn(params, name)) throw new Error(`sentinel-i18n: missing parameter {${name}}`);
  return String(params[name]);
});

/** @param {string} key @param {"en" | "es"} lang @param {Record<string, string | number>} [params] @returns {string} */
export const t = (key, lang, params = {}) => {
  const template = lookup(lang, key);
  if (template === undefined) throw new Error(`sentinel-i18n: unknown message key "${key}"`);
  return fillParams(template, params);
};
