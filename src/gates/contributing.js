/**
 * KJC-TSK-1391 (ADR 0045): settings taken from the project's CONTRIBUTING. Each one is kept
 * with the exact sentence that justifies it, and applies only while that sentence is in the
 * file. One about a fixed rule changes nothing: it is a conflict, shown to the user.
 */
import { FIXED_RULES } from "./registry.js";

export const CONTRIBUTING_FILES = ["CONTRIBUTING.md", "CONTRIBUTING", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"];
const MIN_QUOTE = 15; // shorter than this, a "quote" justifies nothing
const squash = (text) => String(text).replaceAll(/\s+/g, " ").trim();

/** The CONTRIBUTING file holding the sentence literally (blanks normalized), or null. */
export function findQuote(quote, readFile) {
  const wanted = squash(quote);
  if (wanted.length < MIN_QUOTE) return null;
  for (const rel of CONTRIBUTING_FILES) {
    let text;
    try { text = readFile(rel); } catch { continue; }
    if (squash(text).includes(wanted)) return rel;
  }
  return null;
}

/**
 * @param {Array<{rule: string, value: unknown, quote: string}>} entries kj.config.yml contributing_rules
 * @returns {{project: Record<string, {value: unknown, evidence: string}>, stale: object[], conflicts: object[]}}
 */
export function contributingLayer(entries = [], readFile) {
  const project = {};
  const stale = [];
  const conflicts = [];
  for (const entry of entries) {
    const file = findQuote(entry.quote, readFile);
    if (!file) stale.push({ ...entry, reason: "its sentence is no longer in the CONTRIBUTING" });
    else if (FIXED_RULES.some((r) => r.id === entry.rule)) conflicts.push({ rule: entry.rule, file, quote: entry.quote });
    else project[entry.rule] = { value: entry.value, evidence: `${file}: "${squash(entry.quote)}"` };
  }
  return { project, stale, conflicts };
}
