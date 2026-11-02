/**
 * Is a text English? (ADR 0039, decisions 1 and 3): atril indexes in English. A deterministic
 * check, not language ID: a Spanish accented letter, `¿`/`¡`, or one Spanish stopword is enough.
 */
import { fold } from "./text.js";

// Folded Spanish words that are not English words (so not `a`, `no`, `me`).
const SPANISH_STOPWORDS = new Set(
  "de del la las el los para por con sin una unos unas que como cuando donde este esta estos estas pero sobre entre segun mas muy tambien hacer usar y o en es son al su sus lo se".split(" "),
);
// No `é`: it is how English spells café and résumé (the spec's own list contradicts itself here).
const SPANISH_MARKS = /[áíóúüñ¿¡]/i;

export const SEARCH_HINT = "the index is in English: try English terms, or kj skills search, which translates both ways";

// Hyphens and digits stay inside a word, so `en-US`, `de-duplicate` and `ES2025` are not Spanish stopwords.
export const looksNonEnglish = (text) => SPANISH_MARKS.test(text) || (fold(text).match(/[a-z0-9-]+/g) ?? []).some((word) => SPANISH_STOPWORDS.has(word));

/** The fields (description, keywords) that look non-English; none when atril.en.description gives an English one. */
export function nonEnglishFields({ description, atril }) {
  if (typeof atril?.en?.description === "string" && atril.en.description !== "") return [];
  const keywords = Array.isArray(atril?.keywords) ? atril.keywords.filter((word) => typeof word === "string").join(" ") : "";
  return Object.entries({ description, keywords }).filter(([, text]) => looksNonEnglish(text ?? "")).map(([field]) => field);
}

/** Warn on stderr (stdout is the command's output, or MCP's) when the artifact does not look English. */
export function warnIfNonEnglish(artifact, onWarning = (text) => console.error(`atril: ${text}`)) {
  const fields = nonEnglishFields(artifact);
  if (fields.length) {
    onWarning(`${artifact.kind}:${artifact.name}: ${fields.join(" and ")} look(s) non-English; atril indexes in English (ADR 0039): add an English description and keywords, or let kj write them with its enricher`);
  }
}
