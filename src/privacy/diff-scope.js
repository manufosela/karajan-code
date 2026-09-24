/**
 * Which part of a diff the privacy gate reads, and how (KJC-BUG-0203).
 *
 * The gate used to concatenate every added line of the diff and scan the lump.
 * Two consequences: a finding could not name the file it came from, and build
 * output got judged as if a person had written it. A minified Starlight page
 * warned twice for `[phone]` over an Astro class hash, which is the kind of
 * false alarm that teaches people to skip the gate.
 *
 * The exemption is by SEVERITY, not by file. Generic heuristics (a shape that
 * could be a phone, a card, an id) are silenced on generated output, where
 * nobody typed anything. A denylist hit is NOT: the incident that created this
 * scanner was personal emails published on a landing, which is exactly a
 * denylist datum inside a build artifact.
 *
 * `kj privacy scan <dir>` is untouched. Scanning an artifact you are about to
 * publish must keep looking at everything, generated or not.
 */

/** Paths that are build output in this project's own vocabulary. */
const GENERATED = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.astro\//,
  /(^|\/)public\/docs\//,
  /\.min\.(js|css)$/,
  /\.map$/,
];

/** @param {string} file @returns {boolean} */
export function isGeneratedPath(file) {
  if (!file) return false;
  return GENERATED.some((re) => re.test(file));
}

/**
 * Split a unified diff into its added lines, per file.
 * @param {string} diff
 * @returns {Array<{file: string, added: string}>} files with at least one added line
 */
export function splitAddedByFile(diff) {
  const out = [];
  let current = null;
  for (const line of String(diff || "").split("\n")) {
    const header = /^diff --git a\/(?:.+) b\/(.+)$/.exec(line);
    if (header) {
      current = { file: header[1], lines: [] };
      out.push(current);
      continue;
    }
    if (!current) continue;
    // `+++ b/x` is the header, not content; `+` alone is an added blank line.
    if (line.startsWith("+") && !line.startsWith("+++")) current.lines.push(line.slice(1));
  }
  return out.filter((f) => f.lines.length > 0).map((f) => ({ file: f.file, added: f.lines.join("\n") }));
}
