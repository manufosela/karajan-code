/**
 * HU-2782: `kj skills search` asks atril in English. kj prints the results itself
 * (atril's line format), so the translation step can sit between query and search.
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../config/loader.js";
import { createLogger } from "../utils/logger.js";
import { ATRIL_ROOT } from "./atril-skills.js";
import { atrilSearch } from "./atril-cli.js";
import { looksNonEnglish, panelAsk, translateQuery } from "./translate.js";

// Text from an artifact author or an agent must not drive the terminal.
const printable = (text) => [...String(text)]
  .map((ch) => { const code = ch.codePointAt(0); return code < 32 || (code >= 127 && code < 160) ? " " : ch; })
  .join("").replaceAll(/\s+/g, " ").trim();

// Errors only, to stderr: the agent's progress lines must never mix into the results on stdout.
const lazyAsk = async (prompt) => panelAsk({ config: (await loadConfig()).config, logger: createLogger("error") })(prompt);

export async function skillsSearch({ args, deps = {} }) {
  const { search = atrilSearch, ask = lazyAsk, out = (line) => process.stdout.write(`${line}\n`), err = (line) => process.stderr.write(`${line}\n`) } = deps;
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: false,
    options: { kind: { type: "string" }, root: { type: "string" }, json: { type: "boolean" }, "no-translate": { type: "boolean" } },
  });
  const query = positionals.join(" ");
  const opts = { kind: values.kind, root: values.root ?? ATRIL_ROOT };
  try {
    let found = await search(query, opts);
    const translation = { english: query, lang: null, translated: false };
    if (!values["no-translate"] && (found.hits.length === 0 || looksNonEnglish(query))) {
      try {
        const { english, lang } = await translateQuery({ query, ask });
        if (english !== query) found = await search(english, opts);
        Object.assign(translation, { english, lang, translated: true });
      } catch (cause) {
        translation.error = cause.message;
        err(`kj: translation unavailable (${cause.message}); showing results for the untranslated query`);
      }
    }
    err(`kj: search mode ${found.mode}`);
    if (values.json) {
      const { english, lang, translated, error } = translation;
      out(JSON.stringify({ mode: found.mode, query: { original: query, english, lang }, translated, hits: found.hits, ...(error && { translation_error: error }) }, null, 2));
    } else if (found.hits.length === 0) out(`no results for ${JSON.stringify(translation.english)}`);
    else for (const h of found.hits) out(`${h.score}\t${h.kind}\t${printable(h.name)}\t${h.source}\t${printable(h.description)}`);
    return 0;
  } catch (failure) {
    err(`kj: ${failure.message}`);
    return 1;
  }
}
