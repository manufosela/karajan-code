/**
 * Escape regex metacharacters so a value can be interpolated into a
 * RegExp literally (KJC-TSK-0536 — closes Semgrep's
 * detect-non-literal-regexp findings in one move).
 *
 * Use this EVERY time a variable lands inside `new RegExp(...)`. It is
 * NOT for config-provided patterns (output-guard/perf-guard policies),
 * which are regexes by design.
 *
 * @param {unknown} value - coerced to string
 * @returns {string}
 */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
