/**
 * Hard data in what the AI says (CLM-A, KJC-TSK-0801, ADR "claims with evidence").
 *
 * A model states an invented figure with the same confidence as a measured one,
 * and that figure travels to a PR, a card, another session or the user, where
 * nobody checks it again. This module pulls the CHECKABLE data out of a text —
 * counts, versions, file paths, card ids, commit SHAs — so it can be crossed
 * against what actually ran. Prose is left alone: only data is verifiable.
 *
 * Deterministic and free: no model in the loop. Verifying must be cheaper than
 * inventing, or nobody will verify.
 */

/** Sentences that ALREADY admit they are unverified are respected, never reported. */
const HEDGES = /\b(de memoria|sin (comprobar|verificar)|no (lo )?he (comprobado|verificado)|creo que|puede que|quizá|quizás|probablemente|from memory|unverified|not checked|i think|probably)\b/i;

// Most specific first: a number already claimed as a PR or a version is not also a bare count.
// A number with no unit next to it (an OTP, a phone) is deliberately NOT a claim: it is not
// verifiable from prose, and some of them are secrets that must never travel into a report.
const PATTERNS = [
  { kind: "card", re: /\b([A-Z]{3}-(?:TSK|BUG|PCS|SPR|PLA|PRP)-\d{4})\b/g, value: (m) => m[1] },
  { kind: "path", re: /\b((?:[\w.-]+\/){1,}[\w.-]+\.\w{1,5})\b/g, value: (m) => m[1] },
  { kind: "version", re: /\bv?(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/g, value: (m) => m[1] },
  { kind: "pr", re: /(?:^|[\s(])#(\d{2,6})\b/g, value: (m) => m[1] },
  { kind: "sha", re: /\b([0-9a-f]{7,40})\b/g, value: (m) => m[1] },
  // A number that means something: "1004 ficheros", "8 ocurrencias", "53 tests".
  { kind: "count", re: /\b(\d[\d.,]*)\s+(?=[a-záéíóúñ]{3,})/gi, value: (m) => m[1].replaceAll(".", "").replaceAll(",", "") },
];

/** Splits into sentences so a hedge only covers what it is attached to. */
const sentences = (text) => String(text || "").split(/(?<=[.!?\n])\s+/).filter(Boolean);

/**
 * @param {string} text
 * @returns {Array<{kind: string, value: string, sentence: string}>} unique claims, in order.
 */
export function extractClaims(text) {
  const out = [];
  const seen = new Set();
  for (const sentence of sentences(text)) {
    if (HEDGES.test(sentence)) continue; // saying "I did not check" is the behaviour to encourage
    const claimedHere = new Set();
    for (const { kind, re, value } of PATTERNS) {
      for (const m of sentence.matchAll(re)) {
        const v = value(m);
        if (claimedHere.has(v)) continue; // already claimed as something more specific
        claimedHere.add(v);
        const key = `${kind}:${v}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, value: v, sentence: sentence.trim() });
      }
    }
  }
  return out;
}
