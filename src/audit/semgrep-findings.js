/**
 * Semgrep SAST collector for `kj audit` (KJC-TSK-0366).
 *
 * Wraps `semgrep --config auto --json` and feeds structured static-
 * analysis findings into the audit prompt. Equivalent to the SAST half
 * of `snyk code` but free for OSS, no account, runs locally. Semgrep
 * has 2000+ built-in rules across JS/TS/Python/Go/etc. covering OWASP
 * Top 10, taint analysis, hardcoded secrets, regex misuse and language-
 * specific anti-patterns.
 *
 * Same best-effort pattern as sonar-findings.js and osv-findings.js:
 *   - Missing binary or timeout returns {available: false, reason}.
 *   - 120s timeout (semgrep can be slow on large repos with --config auto).
 *   - Severity-grouped (ERROR / WARNING / INFO) and capped at
 *     MAX_SEMGREP_FINDINGS_IN_PROMPT (50) total entries with overflow
 *     markers.
 *   - The LLM is told these are deterministic and asked to fold them
 *     into the `security` dimension using the rule ID as the rule field.
 */

import { runGoverned, jobsCap } from "../utils/tool-governor.js";

const SCAN_TIMEOUT_MS = 120_000;
const SEVERITY_ORDER = ["ERROR", "WARNING", "INFO"];

/**
 * Run semgrep on the project and return a structured result.
 *
 * @param {string} projectDir - absolute path to the project root
 * @param {object} [logger]
 * @returns {Promise<{available: boolean, reason?: string, total?: number, findings?: object[]}>}
 */
export async function collectSemgrepFindings(projectDir, logger = null) {
  // KJC-BUG-0122: a full `--config auto` scan must NEVER fire from the unit
  // suite — on machines with the complete stack installed (the product
  // default since v4.1.2) parallel vitest workers each launched a real
  // whole-repo scan: load average 50, orphaned semgrep-core processes.
  // E2E tests that genuinely want the real scan opt in explicitly.
  if (process.env.VITEST && process.env.KJ_ALLOW_REAL_SCANS !== "1") {
    return { available: false, reason: "real scans disabled under the test runner (set KJ_ALLOW_REAL_SCANS=1 to opt in)" };
  }
  let stdout;
  try {
    // KJC-TSK-0668: governed run — machine-wide single-flight, --jobs capped
    // at half the CPUs (semgrep grabs 14 by default), nice +10, and a timeout
    // that kills the whole process tree (no more orphaned semgrep-core).
    const { stdout: out } = await runGoverned(
      "semgrep",
      ["--config", "auto", "--json", "--quiet", `--jobs=${jobsCap()}`, `--timeout=${Math.floor(SCAN_TIMEOUT_MS / 1000)}`, projectDir || "."],
      { cwd: projectDir, timeout: SCAN_TIMEOUT_MS + 5000, maxBuffer: 32 * 1024 * 1024 }
    );
    stdout = out;
  } catch (err) {
    if (err.code === "ENOENT") {
      if (logger?.warn) logger.warn("semgrep not found in PATH — install via 'pipx install semgrep' or 'brew install semgrep'");
      return { available: false, reason: "semgrep not installed" };
    }
    if (err.killed) {
      if (logger?.warn) logger.warn(`semgrep timed out after ${SCAN_TIMEOUT_MS}ms`);
      return { available: false, reason: `semgrep timed out after ${SCAN_TIMEOUT_MS}ms` };
    }
    // semgrep exits 1 when it finds blocking rules (ERROR severity), but
    // still emits a valid JSON report on stdout. Rescue that case.
    if (typeof err.stdout === "string" && err.stdout.trim().length > 0) {
      stdout = err.stdout;
    } else {
      if (logger?.warn) logger.warn(`semgrep failed: ${err.message}`);
      return { available: false, reason: `semgrep failed: ${err.message}` };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    if (logger?.warn) logger.warn(`semgrep output not parseable: ${err.message}`);
    return { available: false, reason: "semgrep output not parseable as JSON" };
  }

  return { available: true, ...parseSemgrepOutput(parsed, projectDir) };
}

function relativizeSemgrepPath(p, projectDir) {
  return p.startsWith(projectDir + "/") ? p.slice(projectDir.length + 1) : p;
}

/**
 * Convert semgrep's JSON shape into the flat findings list the prompt
 * builder consumes. Semgrep emits results[] with rule id, severity,
 * path, start/end line, message, fix hints.
 *
 * @param {object} raw - parsed semgrep --json output
 * @param {string} [projectDir] - used to make paths repo-relative
 * @returns {{total: number, findings: object[]}}
 */
export function parseSemgrepOutput(raw, projectDir = "") {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const findings = [];
  for (const r of results) {
    const file = r.path && projectDir
      ? relativizeSemgrepPath(r.path, projectDir)
      : r.path || "";
    findings.push({
      rule: r.check_id || "(unknown)",
      severity: String(r.extra?.severity || "INFO").toUpperCase(),
      file,
      line: r.start?.line ?? 0,
      endLine: r.end?.line ?? 0,
      message: r.extra?.message || "",
      fix: r.extra?.fix || r.extra?.fix_regex || null,
      cwe: r.extra?.metadata?.cwe || null,
      owasp: r.extra?.metadata?.owasp || null,
    });
  }
  return { total: findings.length, findings };
}

/**
 * Group findings by severity in canonical order (ERROR → WARNING → INFO).
 */
export function groupFindingsBySeverity(findings) {
  const groups = Object.fromEntries(SEVERITY_ORDER.map(s => [s, []]));
  for (const f of findings || []) {
    const sev = (f.severity || "INFO").toUpperCase();
    if (groups[sev]) groups[sev].push(f);
    else groups.INFO.push(f);
  }
  return groups;
}
