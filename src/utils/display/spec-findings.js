// Pretty-printer for SpecReviewerRole findings (KJC-PCS-0048 PR 2).
// Grouped by category, colours by severity, every finding gets its
// `suggestion` printed below as the actionable fix-it line.

const COLOURS = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m",
};

const SEV_COLOUR = { info: COLOURS.cyan, warn: COLOURS.yellow, fail: COLOURS.red };
const SEV_LABEL = { info: "INFO", warn: "WARN", fail: "FAIL" };

function colour(severity, text) {
  const c = SEV_COLOUR[severity] || COLOURS.gray;
  return `${c}${text}${COLOURS.reset}`;
}

/**
 * @param {Array<{id,severity,category,message,suggestion?}>} findings
 * @param {"ok"|"info"|"warn"|"fail"} severity
 * @param {object} [opts]
 * @param {(line:string)=>void} [opts.write]  Defaults to `console.warn` (stderr).
 */
export function printFindings(findings, severity, opts = {}) {
  const write = opts.write || ((line) => process.stderr.write(`${line}\n`));
  if (!Array.isArray(findings) || findings.length === 0) return;

  write("");
  write(`${COLOURS.bold}Spec review — ${colour(severity, SEV_LABEL[severity] || severity.toUpperCase())}${COLOURS.reset} (${findings.length} finding${findings.length === 1 ? "" : "s"})`);

  const byCat = new Map();
  for (const f of findings) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category).push(f);
  }
  for (const [cat, items] of byCat) {
    write(`${COLOURS.dim}── ${cat}${COLOURS.reset}`);
    for (const f of items) {
      write(`  ${colour(f.severity, "●")} ${COLOURS.bold}${f.id}${COLOURS.reset} ${f.message}`);
      if (f.suggestion) write(`    ${COLOURS.dim}→${COLOURS.reset} ${f.suggestion}`);
    }
  }
  write("");
}
