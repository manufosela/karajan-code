/**
 * Checkov infra-misconfiguration collector for `kj audit` (INF-C,
 * KJC-TSK-0760, epic KJC-PCS-0078).
 *
 * One tool covers the whole infra surface — terraform, kubernetes, helm,
 * kustomize, ansible, dockerfiles — so checkov is THE infra scanner (tfsec
 * and tflint stay out of scope: single dependency to learn and install).
 * Findings enter the audit through the SAME best-effort channel as
 * semgrep-findings (KJC-TSK-0366): no infra markers → not-applicable (zero
 * noise, checkov never runs); missing binary → declared with the install
 * command; non-zero exit with JSON on stdout (checkov's failed-checks
 * behavior) rescued; unparseable output degrades SAYING so.
 */

import { runGoverned, jobsCap } from "../utils/tool-governor.js";
import { detectInfraMarkers } from "../utils/project-detect.js";

const SCAN_TIMEOUT_MS = 120_000;
const INSTALL_HINT = "install via 'pipx install checkov' or 'pip install checkov'";

/**
 * Run checkov on the project and return a structured result.
 *
 * @param {string} projectDir - absolute path to the project root
 * @param {object} [logger]
 * @returns {Promise<{available: boolean, reason?: string, total?: number, findings?: object[]}>}
 */
export async function collectInfraFindings(projectDir, logger = null) {
  // KJC-BUG-0122 doctrine: external scanners never fire from the unit suite.
  if (process.env.VITEST && process.env.KJ_ALLOW_REAL_SCANS !== "1") {
    return { available: false, reason: "real scans disabled under the test runner (set KJ_ALLOW_REAL_SCANS=1 to opt in)" };
  }
  if (!(await detectInfraMarkers(projectDir))) {
    return { available: false, reason: "no infra markers (terraform/helm/kustomize/ansible) — not applicable" };
  }
  let stdout;
  try {
    const { stdout: out } = await runGoverned(
      "checkov",
      ["-d", projectDir || ".", "--output", "json", "--quiet", "--compact", `--parallel-runner-count=${jobsCap()}`],
      { cwd: projectDir, timeout: SCAN_TIMEOUT_MS + 5000, maxBuffer: 32 * 1024 * 1024 }
    );
    stdout = out;
  } catch (err) {
    if (err.code === "ENOENT") {
      if (logger?.warn) logger.warn(`checkov not found in PATH — ${INSTALL_HINT}`);
      return { available: false, reason: `checkov not installed — ${INSTALL_HINT}` };
    }
    if (err.killed) {
      if (logger?.warn) logger.warn(`checkov timed out after ${SCAN_TIMEOUT_MS}ms`);
      return { available: false, reason: `checkov timed out after ${SCAN_TIMEOUT_MS}ms` };
    }
    // checkov exits non-zero when checks fail, but still emits the report.
    if (typeof err.stdout === "string" && err.stdout.trim().length > 0) {
      stdout = err.stdout;
    } else {
      if (logger?.warn) logger.warn(`checkov failed: ${err.message}`);
      return { available: false, reason: `checkov failed: ${err.message}` };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    if (logger?.warn) logger.warn(`checkov output not parseable: ${err.message}`);
    return { available: false, reason: "checkov output not parseable as JSON" };
  }

  return { available: true, ...parseCheckovOutput(parsed) };
}

/**
 * Convert checkov's JSON (object for one framework, array for several)
 * into the flat findings list the audit prompt consumes. Checkov OSS may
 * omit severity — WARNING is the honest default.
 *
 * @param {object|object[]} raw
 * @returns {{total: number, findings: object[]}}
 */
export function parseCheckovOutput(raw) {
  const reports = Array.isArray(raw) ? raw : [raw];
  const findings = [];
  for (const report of reports) {
    const failed = report?.results?.failed_checks;
    if (!Array.isArray(failed)) continue;
    for (const c of failed) {
      findings.push({
        rule: c.check_id || "(unknown)",
        severity: String(c.severity || "WARNING").toUpperCase(),
        framework: report.check_type || "infra",
        file: String(c.file_path || "").replace(/^\//, ""),
        line: Array.isArray(c.file_line_range) ? (c.file_line_range[0] ?? 0) : 0,
        message: c.check_name || "",
        guideline: c.guideline || null,
      });
    }
  }
  return { total: findings.length, findings };
}
