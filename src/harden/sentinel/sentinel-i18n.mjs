// HU-5055 (KJC-TSK-1841): the Sentinel's messages in the configured language, or the
// system's. The Sentinel runs as a hook, so this module uses only node built-ins.
// Order: the project's kj.config.yml, the home's, the OS locale, then English.
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPPORTED = ["en", "es"];
const FALLBACK = "en";
const LOCALE_VARS = ["LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"];
const LANGUAGE_LINE = /^language:\s*["']?([A-Za-z-]+)/m;

const CATALOG = {
  en: {
    governs: "karajan: Karajan governs and is obeyed. Do not go around the gate or change the policy to pass it; if you think it is unfair, tell your user or use kj report-issue.",
    supervisor_file: "karajan sentinel: that file is part of the supervisor ({file}); only the human dismantles the sentinel, so edit it outside the session.",
    governance_file: "karajan sentinel: {file} is governance configuration (policies, gates, exclusions): your user changes it, not the session. If a gate seems unfair, propose it to your user or use kj report-issue.",
    supervisor_bash: "karajan sentinel: the supervisor's files are not touched from Bash: read them with the Read/Grep tools; only the human modifies them, outside the session.",
    supervisor_phone: "karajan sentinel: the phone key (layer 5) belongs to the human: supervisor-phone.json is not touched from the session; enrolling is kj identity enroll-phone from the user's own terminal.",
  },
  es: {
    governs: "karajan: Karajan gobierna y se le obedece. No rodees el gate ni cambies la política para pasarlo; si te parece injusto, díselo a tu usuario o usa kj report-issue.",
    supervisor_file: "karajan sentinel: ese fichero es parte del supervisor ({file}); solo el humano desmonta el sentinel, así que edítalo fuera de la sesión.",
    governance_file: "karajan sentinel: {file} es configuración de gobierno (políticas, gates, exclusiones): la cambia tu usuario, no la sesión. Si un gate te parece injusto, propónselo a tu usuario o usa kj report-issue.",
    supervisor_bash: "karajan sentinel: los ficheros del supervisor no se tocan desde Bash: consúltalos con la tool Read/Grep; solo el humano los modifica, fuera de la sesión.",
    supervisor_phone: "karajan sentinel: la clave del móvil (capa 5) es del humano: supervisor-phone.json no se toca desde la sesión; enrolar es kj identity enroll-phone desde la terminal del usuario.",
  },
};

const normalize = (code) => {
  const lang = String(code).slice(0, 2).toLowerCase();
  return SUPPORTED.includes(lang) ? lang : FALLBACK;
};

const configLanguage = (dir) => {
  const file = join(dir, ".karajan", "kj.config.yml");
  if (!existsSync(file)) return null;
  const match = LANGUAGE_LINE.exec(readFileSync(file, "utf8"));
  return match ? match[1] : null;
};

const localeLanguage = (env) => LOCALE_VARS.map((name) => env[name]).find(Boolean) ?? null;

/**
 * The language the Sentinel speaks: the project's config, then the home's, then the OS locale.
 * Only "en" and "es" are supported; any other code resolves to English.
 * @param {{ projectDir: string, home: string, env?: Record<string, string | undefined> }} options
 * @returns {"en" | "es"}
 */
export const sentinelLang = ({ projectDir, home, env = process.env }) => {
  const found = configLanguage(projectDir) ?? configLanguage(home) ?? localeLanguage(env);
  return found === null ? FALLBACK : normalize(found);
};

const lookup = (lang, key) => (Object.hasOwn(CATALOG[lang] ?? {}, key) ? CATALOG[lang][key] : CATALOG[FALLBACK][key]);

const fillParams = (template, params) => template.replace(/\{(\w+)\}/g, (_, name) => {
  if (!Object.hasOwn(params, name)) throw new Error(`sentinel-i18n: missing parameter {${name}}`);
  return String(params[name]);
});

/**
 * A message of the catalog in a language, with its {param} placeholders filled.
 * A key missing in the language falls back to English; an unknown key throws.
 * @param {string} key
 * @param {"en" | "es"} lang
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export const t = (key, lang, params = {}) => {
  const template = lookup(lang, key);
  if (template === undefined) throw new Error(`sentinel-i18n: unknown message key "${key}"`);
  return fillParams(template, params);
};
