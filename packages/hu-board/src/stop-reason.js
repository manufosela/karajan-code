// KJC-TSK-1606 (asked by the maintainer on 2026-11-13): a session that ends its turn to wait for
// something is not done. Its stops close with "Me paro porque…" / "Me paro por…" (the user's global
// rule), and that line says what for: the person (it asks them for something), a process (it waits
// for one to end), or nothing (no work left). Pure: session-names.js reads the transcript.

const STOP = /^\s*«?\s*(me paro por.*)$/i;
// KJC-BUG-0638: and in the infinitive ("por no quedar trabajo", "no quedarme nada"), with "tareas" too.
const NOTHING = [
  /no (?:me )?qued(?:an?|ar(?:me)?) (?:trabajo|nada|tareas)/i,
  /sin trabajo|no (?:tengo|tener|hay) (?:m[aá]s )?(?:trabajo|tareas)/i,
];
// Words that ask the person: "your…" and "you", and the verbs a stop line asks them with.
const YOU = /(?:^|[\s(,])(?:tus?|t[uú]|ti)(?=[\s,.;:)]|$)/i;
const ASKS = /apruebes|decidas|elijas|confirmes|teclees|firmes|respondas|\bOTP\b/i;
// KJC-TSK-1810: "a que" + a verb in the second person (revises, compruebes, estés, me digas): it waits
// for the person. An article is no verb, and neither is the subject a plural verb follows in its clause
// ("a que las validaciones terminen", "las pruebas de integración terminen"): "las" was its article.
const FOR_YOU = /\ba que (?:(me|nos|lo|la|le|los|las|les|se) )?(\p{L}+(?:es|as|és|ás))(?!\p{L})/iu;
const ARTICLES = new Set(['las', 'les', 'unas']);
const PLURAL = new Set(['los', 'las', 'les']);
const PLURAL_VERB = /^\p{L}{2,}(?<!i)(?:en|an|én|án)$/u;
// Nouns that end like a plural verb: imagen, origen, examen, resumen, orden, joven.
const NOT_A_VERB = /(?:gen|men)$|^(?:orden|joven)$/u;
// The subject's verb comes within a few words ("unitarias terminen", "de integración terminen"), and
// never past a connector that opens another clause ("los firmes mientras llegan los documentos").
const CLAUSE_END = /[,.;:!?]|\s(?:y|o|ni|cuando|mientras|si|hasta|antes|después|aunque|para|porque|pero|donde|como|sin|luego)\s/iu;
const SUBJECT_WORDS = 3;
const pluralVerbIn = (rest) => rest.split(CLAUSE_END)[0].trim().split(/\s+/).slice(0, SUBJECT_WORDS)
  .some((word) => PLURAL_VERB.test(word.toLowerCase()) && !NOT_A_VERB.test(word.toLowerCase()));
const waitsForYou = (line) => {
  const found = line.match(FOR_YOU);
  const [said, pronoun, verb] = found ?? [];
  if (!verb || ARTICLES.has(verb.toLowerCase())) return false;
  return !(PLURAL.has(pronoun?.toLowerCase()) && pluralVerbIn(line.slice(found.index + said.length)));
};
const asksPerson = (line) => YOU.test(line) || ASKS.test(line) || waitsForYou(line);

/** The last stop line of an answer, trimmed; null without one. */
export function stopLine(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map((line) => line.match(STOP)?.[1]?.trim()).filter(Boolean);
  return lines.at(-1)?.replace(/»\s*$/, '') ?? null;
}

/**
 * What a stop line waits for: 'person' or 'process'; 'done' when nothing is left to do (KJC-TSK-1811:
 * not a wait, it has its own mark); null when there is no stop line.
 */
export function waitOf(text) {
  const line = stopLine(text);
  if (!line) return null;
  if (NOTHING.some((said) => said.test(line))) return 'done';
  return asksPerson(line) ? 'person' : 'process';
}
