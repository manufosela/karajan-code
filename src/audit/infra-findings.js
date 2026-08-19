/**
 * Checkov infra-misconfiguration collector for `kj audit` (INF-C,
 * KJC-TSK-0760, epic KJC-PCS-0078).
 *
 * One tool covers the whole infra surface — terraform, kubernetes, helm,
 * kustomize, ansible, dockerfiles — so checkov is THE infra scanner (tfsec
 * and tflint stay out of scope: single dependency to learn and install).
 * This module ships the PURE half (parser + marker gate); the governed
 * collector that runs checkov and wires the audit lands in the follow-up
 * PR — same best-effort channel as semgrep-findings (KJC-TSK-0366).
 */

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
