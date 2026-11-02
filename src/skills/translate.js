/**
 * HU-2782 (ADR 0039, decision 2): atril indexes English, so a query in another
 * language is translated first, by the `translator` role (it inherits the coder).
 */
import { createAgent } from "../agents/index.js";
import { assertAgentsAvailable } from "../agents/availability.js";
import { resolveRole } from "../config/role-resolver.js";
import { agentAnswerText } from "../review/parser.js";

// The same Spanish stopword list as packages/atril/src/lang.js (HU-2781); copied, not imported from atril's internals.
const SPANISH_STOPWORDS = new Set("de del la las el los para por con sin una unos unas que como cuando donde este esta estos estas pero sobre entre segun mas muy tambien hacer usar y o en es son al su sus lo se".split(" "));
const stripAccents = (text) => text.normalize("NFD").replaceAll(/\p{Diacritic}/gu, "");

/** Deterministic gate, no model needed: text outside ASCII or a Spanish stopword means not English. */
export const looksNonEnglish = (query) => /[^\u0000-\u007F]/.test(query)
  || stripAccents(query.toLowerCase()).split(/[^a-z]+/).some((token) => SPANISH_STOPWORDS.has(token));

const PROMPT = (query) => `Detect the language of this skill-search query and translate it to English.
Answer ONLY a JSON object {"lang":"<ISO 639-1 code>","english":"<the query in English>"}, no fences, no explanation.

Query: ${JSON.stringify(query)}`;

/** One agent call: `ask(prompt)` returns the agent's text. Throws when the answer is unusable. */
export async function translateQuery({ query, ask }) {
  const text = String(await ask(PROMPT(query))).replace(/^```[a-z]*\n?|```\s*$/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`the translator answer is not valid JSON (${err.message})`, { cause: err });
  }
  if (typeof parsed?.english !== "string" || !parsed.english.trim()) throw new Error("the translator answer has no english text");
  return { lang: typeof parsed.lang === "string" ? parsed.lang : null, english: parsed.english.trim() };
}

/** The panel's translator, as `ask(prompt) => text`; never a silent fallback to another agent. */
export function panelAsk({ config, logger, create = createAgent, check = assertAgentsAvailable }) {
  return async (prompt) => {
    const { provider } = resolveRole(config, "translator");
    await check([provider]);
    const res = await create(provider, config, logger).runTask({ prompt, role: "translator" });
    if (!res?.ok) throw new Error(`${provider}: ${res?.error || "no output"}`);
    return agentAnswerText(res.output);
  };
}
