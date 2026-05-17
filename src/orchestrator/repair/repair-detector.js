/**
 * Heuristics for classifying an acceptance-test failure as "possibly
 * infeasible" — i.e. the test itself looks broken, not the code.
 *
 * Used by the HU sub-pipeline to decide when to invoke the Repairer
 * role instead of feeding the failure back to the coder for ANOTHER
 * iteration. Each iteration costs real money + time; classifying
 * misroutes is the difference between a 3-minute repair and a
 * 30-minute budget burn.
 *
 * The classifier is deliberately CONSERVATIVE: false negatives
 * (treating a broken test as just-failed) cost an extra iteration;
 * false positives (treating a real failure as infeasible) waste a
 * Repairer call AND give the coder a spec change it shouldn't
 * receive. We err toward false negatives.
 */

/**
 * Signatures that strongly suggest the TEST is broken, not the code.
 * Each is a regex applied to the failing command's stderr+stdout.
 */
const INFEASIBLE_SIGNATURES = [
  // jq: `length as $n | .field` after a transform — the binding doesn't
  // change the value flowing through, so `.field` is applied to the wrong
  // thing. Real-world example from 2026-04-29: "Cannot index array with
  // string \"filesOver300LOC\"".
  { kind: "jq-as-binding-misuse", re: /Cannot index array with string/i },
  // bash -n / shell parse errors before the command even runs.
  { kind: "shell-parse-error", re: /syntax error|unexpected token|unexpected EOF/i },
  // jq: invalid query syntax detected by jq itself.
  { kind: "jq-syntax", re: /jq: error \(at .*\): (?!Cannot index)/i },
  // command not found = test references a tool that doesn't exist in
  // this environment. Could be a fixable typo or a real env mismatch.
  { kind: "missing-tool", re: /command not found|: not found$|No such file or directory.*\.(sh|mjs|js|py)/im },
  // jq fails to parse the JSON input — the input file is wrong, the
  // path is wrong, or the assumed schema is off.
  { kind: "jq-parse-input", re: /jq: error: Could not (open|parse)/i },
];

/**
 * Compute a stable signature for a single failing test outcome — the
 * test command + a normalized error fingerprint. Used to detect when
 * the SAME test is failing the SAME way across iterations; that's the
 * pattern that argues for a Repairer call (vs. a coder retry).
 *
 * @param {string} cmd
 * @param {string} errorOutput
 * @returns {string}
 */
export function failureSignature(cmd, errorOutput) {
  const cmdNorm = String(cmd || "").trim().slice(0, 200);
  const errNorm = String(errorOutput || "")
    .replaceAll(/\s+/g, " ")        // collapse whitespace
    .replaceAll(/\d+/g, "N")          // numbers tend to drift; line numbers, counts
    .replaceAll(/\/[^\s]+/g, "/PATH") // absolute paths drift across runs
    .trim()
    .slice(0, 300);
  return `${cmdNorm}|||${errNorm}`;
}

/**
 * Classify a single test failure as `infeasible` or `regular`.
 *
 * @param {object} args
 * @param {string} args.cmd          — the command that ran
 * @param {string} args.errorOutput  — stdout + stderr from the failing run
 * @param {number} args.consecutive  — how many iterations in a row this
 *                                      same signature has failed
 * @param {number} [args.threshold=2] — min consecutive failures before
 *                                       infeasibility is even considered.
 *                                       Below this, we always say "regular"
 *                                       (let the coder try once more).
 * @returns {{infeasible: boolean, kind: string|null, signature: string}}
 */
export function classifyFailure({ cmd, errorOutput, consecutive, threshold = 2 }) {
  const signature = failureSignature(cmd, errorOutput);
  if (!Number.isFinite(consecutive) || consecutive < threshold) {
    return { infeasible: false, kind: null, signature };
  }
  for (const sig of INFEASIBLE_SIGNATURES) {
    if (sig.re.test(errorOutput || "")) {
      return { infeasible: true, kind: sig.kind, signature };
    }
  }
  return { infeasible: false, kind: null, signature };
}

/**
 * Track consecutive identical failures across iterations of the same HU.
 * Caller passes the same instance across iterations; the tracker
 * remembers the last signature per command.
 */
export function createFailureTracker() {
  // Map<cmd, { signature, count }>
  const state = new Map();
  return {
    /**
     * Record a failure and return how many consecutive iterations have
     * produced the same signature for this cmd.
     * @returns {number}
     */
    record(cmd, errorOutput) {
      const signature = failureSignature(cmd, errorOutput);
      const prev = state.get(cmd);
      if (prev && prev.signature === signature) {
        prev.count += 1;
        return prev.count;
      }
      state.set(cmd, { signature, count: 1 });
      return 1;
    },
    /** Reset tracker for a cmd that just passed (stops false positives). */
    reset(cmd) { state.delete(cmd); },
    /** Diagnostic: dump current state. */
    snapshot() { return Object.fromEntries(state); },
  };
}
