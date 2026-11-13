// KJC-TSK-1606 (asked by the maintainer on 2026-11-13): a session that ends its turn to wait for
// something is not done. Its stops close with "Me paro porque…" / "Me paro por…" (the user's global
// rule), and that line says what for: the person (it asks them for something), a process (it waits
// for one to end), or nothing (no work left). Pure: session-names.js reads the transcript.

const STOP = /^\s*«?\s*(me paro por.*)$/i;
const NOTHING = /no (?:me )?queda(?:n)? (?:trabajo|nada)|sin trabajo|no (?:tengo|hay) (?:m[aá]s )?trabajo/i;
// Words that ask the person: "your…" and "you", and the verbs a stop line asks them with.
const YOU = /(?:^|[\s(,])(?:tus?|t[uú]|ti)(?=[\s,.;:)]|$)/i;
const ASKS = /apruebes|decidas|elijas|confirmes|teclees|firmes|respondas|\bOTP\b/i;
const asksPerson = (line) => YOU.test(line) || ASKS.test(line);

/** The last stop line of an answer, trimmed; null without one. */
export function stopLine(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n').map((line) => line.match(STOP)?.[1]?.trim()).filter(Boolean);
  return lines.at(-1)?.replace(/»\s*$/, '') ?? null;
}

/** What a stop line waits for: 'person', 'process', or null when nothing is left to do or there is none. */
export function waitOf(text) {
  const line = stopLine(text);
  if (!line || NOTHING.test(line)) return null;
  return asksPerson(line) ? 'person' : 'process';
}
