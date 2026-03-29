/**
 * OS locale detection and language instruction generation for i18n support.
 */

export const SUPPORTED_LANGUAGES = {
  en: "English",
  es: "Español"
};

const LANG_ENV_VARS = ["LANG", "LANGUAGE", "LC_ALL", "LC_MESSAGES"];

/**
 * Detect the 2-letter language code from OS environment variables.
 * Checks LANG, LANGUAGE, LC_ALL, LC_MESSAGES in order.
 * @returns {string} 2-letter language code (e.g. "en", "es")
 */
export function detectOsLocale() {
  for (const envVar of LANG_ENV_VARS) {
    const value = process.env[envVar];
    if (value) {
      const code = extractLangCode(value);
      if (code) return code;
    }
  }
  return "en";
}

/**
 * Extract a 2-letter language code from a locale string.
 * Handles formats like "es_ES.UTF-8", "en_US", "es", "C.UTF-8".
 * @param {string} locale
 * @returns {string|null}
 */
function extractLangCode(locale) {
  const trimmed = locale.trim();
  if (!trimmed || trimmed === "C" || trimmed === "POSIX") return null;
  // Match first 2 lowercase letters before _, ., or end
  const match = /^([a-z]{2})(?:[_.\-]|$)/i.exec(trimmed);
  if (match) return match[1].toLowerCase();
  return null;
}

/**
 * Get a prompt instruction string for the given language.
 * Returns empty string for English (agents default to English).
 * @param {string} lang - 2-letter language code
 * @returns {string}
 */
export function getLanguageInstruction(lang) {
  if (!lang || lang === "en") return "";
  const languageName = SUPPORTED_LANGUAGES[lang];
  if (lang === "es") {
    return "IMPORTANT: Respond in Spanish. All output, explanations, and feedback must be in Spanish.";
  }
  if (languageName) {
    return `IMPORTANT: Respond in ${languageName}. All output must be in ${languageName}.`;
  }
  return `IMPORTANT: Respond in ${lang}. All output must be in ${lang}.`;
}
