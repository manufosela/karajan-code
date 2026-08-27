/**
 * Crossing what was said against what actually ran (CLM-A, KJC-TSK-0801).
 *
 * The transcript is the register of sources: every command, query and read left
 * its output there, so nothing has to be annotated by hand. A datum that appears
 * in some output is BACKED; one that appears nowhere came out of the model's
 * memory (UNBACKED); one whose own source says otherwise is DENIED — and that
 * is the only verdict that blocks, because it is a proven hallucination and not
 * a suspicion.
 *
 * What cannot be decided is NOT_CHECKABLE, never an accusation: a guard that
 * cries wolf gets switched off (KJC-PCS-0082).
 */
import { extractClaims } from "./extract.js";

export const BACKED = "backed";
export const UNBACKED = "unbacked";
export const DENIED = "denied";
export const NOT_CHECKABLE = "not_checkable";

const norm = (s) => String(s ?? "").toLowerCase();
const escape = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Numbers must match as WHOLE tokens: searching "4" as a substring finds it inside "24.6 kB"
 * and backs a figure nobody measured. Found while running this over a real message — the
 * synthetic tests had passed. Ids, paths and versions are distinctive enough as substrings.
 */
function appearsIn(output, claim) {
  const needle = norm(claim.value);
  if (claim.kind === "path" || claim.kind === "card" || claim.kind === "version") return output.includes(needle);
  return new RegExp(`(?<![\\w.])${escape(needle)}(?![\\w.])`).test(output);
}

/** "no cards", "[]", "0 results" — a source that positively states emptiness. */
const SAYS_EMPTY = /(^|\W)(\[\]|\bnone\b|\bno results?\b|\bempty\b|\b0 (results?|items?|matches|cards?|files?)\b)/i;

/**
 * @param {{text: string, outputs: string[], userSaid?: string}} input
 *   outputs: tool outputs of the turn, in order. userSaid: what the user wrote (also a source).
 * @returns {{claims: Array<object>, denied: Array<object>, unbacked: Array<object>}}
 */
export function crossCheck({ text, outputs = [], userSaid = "" }) {
  // Backing can come from an output OR from the user (repeating their datum is not
  // inventing). The DENIED analysis reads only the OUTPUTS: the user asking "how
  // many cards are left?" mentions the noun without saying anything about emptiness,
  // and must not veto a denial — found by the stop-gate wiring test.
  const sources = outputs.map(norm);
  const haystack = [...sources, norm(userSaid)];
  const claims = extractClaims(text).map((claim) => ({ ...claim, status: verdictFor(claim, haystack, sources) }));
  return {
    claims,
    denied: claims.filter((c) => c.status === DENIED),
    unbacked: claims.filter((c) => c.status === UNBACKED),
  };
}

function verdictFor(claim, haystack, sources) {
  if (haystack.some((h) => appearsIn(h, claim))) return BACKED;

  // A count stated as non-zero while every OUTPUT that mentions the same noun says empty:
  // that is the "four cards are waiting" case, and it is the one that blocks.
  if (claim.kind === "count" && Number(claim.value) > 0) {
    const noun = nounAfterCount(claim.sentence, claim.value);
    if (noun) {
      const mentions = sources.filter((h) => h.includes(norm(noun)));
      if (mentions.length && mentions.every((h) => SAYS_EMPTY.test(h))) return DENIED;
    }
    // Small numbers are prose as often as data ("las dos capas", "3 reglas"): not worth accusing.
    if (Number(claim.value) <= 3) return NOT_CHECKABLE;
  }
  return UNBACKED;
}

function nounAfterCount(sentence, value) {
  const m = new RegExp(`${value}\\s+([a-zá-ú]{4,})`, "i").exec(sentence);
  return m ? m[1] : null;
}

/** One human line per problem; the message is what makes a guard usable. */
export function formatClaimReport({ denied, unbacked }) {
  const lines = [];
  for (const c of denied) lines.push(`✗ "${c.value}" (${c.kind}) is DENIED by the output that should back it — ${c.sentence.slice(0, 100)}`);
  for (const c of unbacked) lines.push(`? "${c.value}" (${c.kind}) has no backing in this turn — verify it or say it is from memory`);
  return lines.join("\n");
}
