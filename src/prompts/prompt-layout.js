/**
 * Prompt layout helper — Phase 1 (KJC-PCS-0057, cache propio).
 *
 * Separates prompt sections into two buckets so every prompt builder can
 * emit a cache-friendly shape:
 *
 *   - stable:   identical across iterations of the same HU and across HUs
 *               of the same plan (preamble, rules, constraints, skills,
 *               product/domain context). Goes FIRST in the rendered prompt
 *               so providers with automatic prefix caching (OpenAI, Gemini,
 *               LiteLLM-routed) hit on the literal prefix. For Anthropic,
 *               agents can send this bucket via --append-system-prompt
 *               where the CLI already places cache breakpoints.
 *   - volatile: changes per HU/iteration (task, plan, acceptance tests,
 *               reviewer feedback, diff). Goes LAST, preserving the
 *               relative order the builder pushed it in — the semantic
 *               ordering inside the bucket ("order matters" in coder.js)
 *               is untouched.
 *
 * Tagging is explicit on purpose: an untagged section throws instead of
 * silently landing in one bucket (a misclassified volatile section would
 * silently break the byte-identical invariant the prefix cache relies on).
 */

export const STABLE = "stable";
export const VOLATILE = "volatile";

const SEPARATOR = "\n\n";

/**
 * Tag a section for buildPromptLayout. Returns null for empty/non-string
 * content so builders can push conditional sections without guards.
 *
 * @param {string|null|undefined} content
 * @param {"stable"|"volatile"} [stability]
 * @returns {{content: string, stability: string}|null}
 */
export function section(content, stability = VOLATILE) {
  if (typeof content !== "string" || content.length === 0) return null;
  return { content, stability };
}

/**
 * Split tagged sections into { stable, volatile } blocks. Insertion order
 * is preserved within each bucket. Null/undefined entries are skipped.
 *
 * @param {Array<{content: string, stability: string}|null|undefined>} sections
 * @returns {{stable: string, volatile: string}}
 */
export function buildPromptLayout(sections) {
  const stable = [];
  const volatile = [];
  for (const entry of sections) {
    if (entry == null) continue;
    if (entry.stability === STABLE) {
      stable.push(entry.content);
    } else if (entry.stability === VOLATILE) {
      volatile.push(entry.content);
    } else {
      throw new Error(
        `prompt-layout: section has invalid stability tag "${entry?.stability}" — use section(content, STABLE|VOLATILE)`
      );
    }
  }
  return { stable: stable.join(SEPARATOR), volatile: volatile.join(SEPARATOR) };
}

/**
 * Render a layout as a single prompt string: stable prefix first, volatile
 * tail last. Used by agents whose provider caches on the literal token
 * prefix (codex, gemini, aider, opencode).
 *
 * @param {{stable: string, volatile: string}} layout
 * @returns {string}
 */
export function joinLayout({ stable, volatile }) {
  if (!stable) return volatile;
  if (!volatile) return stable;
  return `${stable}${SEPARATOR}${volatile}`;
}
