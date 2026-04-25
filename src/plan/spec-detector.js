/**
 * Detect numbered/sectioned headings in a task description so the
 * planner prompt can demand `spec_section` per HU instead of leaving
 * it as a soft "preferred" hint that LLMs ignore.
 *
 * Recognises three common shapes (kept intentionally narrow — false
 * positives turn the planner prompt into noise):
 *
 *   ## 1. Overview              → section "1",   title "Overview"
 *   ### 2.1 add                 → section "2.1", title "add"
 *   ## §5 Initial Scope         → section "5",   title "Initial Scope"
 *
 * The matcher is anchored to markdown heading lines (`^#+`) so prose
 * mentions of a number ("see version 4.2") never trigger detection.
 *
 * Returns `{ hasSpec, sections, sectionList }`:
 *   - `hasSpec`     boolean — true when at least one heading matched.
 *                   Prompt builders use this to switch language from
 *                   "preferred" to "MUST".
 *   - `sections`    string[] — bare section refs, dedup, in document
 *                   order. e.g. ["1", "2", "2.1", "2.2", "3"].
 *   - `sectionList` Array<{section, title}> — full list with titles
 *                   so the prompt can echo the checklist back at the
 *                   LLM. Keeps order, dedup by section ref.
 *
 * @param {string} text
 * @returns {{ hasSpec: boolean, sections: string[], sectionList: Array<{section: string, title: string}> }}
 */
export function detectSpecSections(text) {
  const empty = { hasSpec: false, sections: [], sectionList: [] };
  if (!text || typeof text !== "string") return empty;

  // Anchored to heading lines. Two regex shapes — numbered sections
  // and §-prefixed sections — are both common in the wild.
  //
  //   ^#{1,6}\s*               ← markdown heading marker (any depth)
  //   §?\s*                    ← optional "§"
  //   (\d+(?:\.\d+){0,4})      ← section number, up to 5 levels deep
  //   [.)]?\s+                 ← optional trailing "." or ")", then space
  //   (.+?)\s*$                ← title (lazy, trim trailing whitespace)
  const headingRe = /^#{1,6}\s*§?\s*(\d+(?:\.\d+){0,4})[.)]?\s+(.+?)\s*$/;

  const seen = new Set();
  const sectionList = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = headingRe.exec(line);
    if (!m) continue;
    const section = m[1];
    if (seen.has(section)) continue;
    seen.add(section);
    sectionList.push({ section, title: m[2].trim() });
  }

  if (sectionList.length === 0) return empty;
  return {
    hasSpec: true,
    sections: sectionList.map((s) => s.section),
    sectionList,
  };
}
