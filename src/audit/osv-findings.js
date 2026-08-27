/**
 * OSV-Scanner findings collector for `kj audit` (KJC-TSK-0365).
 *
 * Wraps Google's `osv-scanner` CLI and feeds its results into the audit
 * prompt as a deterministic vulnerability section. OSV.dev's database
 * pulls from GitHub Advisory Database, GLSA, PyPI advisories, Go vuln
 * DB and others — broader coverage than `npm audit` alone, with no
 * account, token, or upload (the scanner runs locally and only the
 * advisory data is fetched on demand).
 *
 * This module follows the same pattern as src/audit/sonar-findings.js:
 *   - Best-effort: missing binary or scan errors return
 *     {available: false, reason} and the audit continues without the
 *     section.
 *   - Severity-grouped: helps the LLM (and the deterministic summary)
 *     prioritise the worst issues without scrolling.
 *   - Capped: only the first MAX_OSV_VULNS_IN_PROMPT entries land in
 *     the prompt, with overflow markers per severity, so an
 *     out-of-control result list cannot blow the token budget.
 */

import { runGoverned } from "../utils/tool-governor.js";

const SCAN_TIMEOUT_MS = 60_000;
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "MODERATE"];

/**
 * Run osv-scanner on the project and return a structured result.
 *
 * @param {string} projectDir - absolute path to the project root
 * @param {object} [logger]
 * @returns {Promise<{available: boolean, reason?: string, total?: number, vulnerabilities?: object[]}>}
 */
export async function collectOsvFindings(projectDir, logger = null) {
  // KJC-BUG-0122: same kill-switch as semgrep — external scanners never
  // fire from the unit suite; e2e opts in with KJ_ALLOW_REAL_SCANS=1.
  if (process.env.VITEST && process.env.KJ_ALLOW_REAL_SCANS !== "1") {
    return { available: false, reason: "real scans disabled under the test runner (set KJ_ALLOW_REAL_SCANS=1 to opt in)" };
  }
  let stdout;
  try {
    // KJC-TSK-0668: governed run — single-flight across kj processes and a
    // timeout that kills the whole process tree (osv-scanner is I/O-bound,
    // no jobs flag to cap).
    const { stdout: out } = await runGoverned(
      "osv-scanner",
      ["--format=json", "--recursive", projectDir || "."],
      { cwd: projectDir, timeout: SCAN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }
    );
    stdout = out;
  } catch (err) {
    // osv-scanner exits with non-zero when vulnerabilities are found, so
    // err.code 1 is NORMAL — we still want the stdout. Real failures are
    // ENOENT (binary missing) or stdout empty.
    if (err.code === "ENOENT") {
      if (logger?.warn) logger.warn("osv-scanner not found in PATH — install via 'go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest'");
      return { available: false, reason: "osv-scanner not installed" };
    }
    if (err.killed) {
      if (logger?.warn) logger.warn(`osv-scanner timed out after ${SCAN_TIMEOUT_MS}ms`);
      return { available: false, reason: `osv-scanner timed out after ${SCAN_TIMEOUT_MS}ms` };
    }
    if (typeof err.stdout === "string" && err.stdout.trim().length > 0) {
      stdout = err.stdout;
    } else {
      if (logger?.warn) logger.warn(`osv-scanner failed: ${err.message}`);
      return { available: false, reason: `osv-scanner failed: ${err.message}` };
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    if (logger?.warn) logger.warn(`osv-scanner output not parseable: ${err.message}`);
    return { available: false, reason: "osv-scanner output not parseable as JSON" };
  }

  return { available: true, ...parseOsvOutput(parsed) };
}

/**
 * Flatten the osv-scanner JSON shape into a flat list of vulnerabilities.
 * The scanner emits results[].packages[].vulnerabilities[].
 *
 * @param {object} raw - parsed osv-scanner JSON
 * @returns {{total: number, vulnerabilities: object[]}}
 */
export function parseOsvOutput(raw) {
  const flat = [];
  const results = Array.isArray(raw?.results) ? raw.results : [];
  for (const result of results) {
    const source = result.source?.path || result.source || "";
    const packages = Array.isArray(result.packages) ? result.packages : [];
    for (const pkg of packages) {
      const name = pkg.package?.name || "";
      const version = pkg.package?.version || "";
      const ecosystem = pkg.package?.ecosystem || "";
      const vulns = Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities : [];
      const groups = Array.isArray(pkg.groups) ? pkg.groups : [];
      for (const vuln of vulns) {
        flat.push({
          id: vuln.id || vuln.aliases?.[0] || "UNKNOWN",
          aliases: vuln.aliases || [],
          severity: extractSeverity(vuln, groups),
          summary: vuln.summary || vuln.details?.split("\n")[0] || "",
          publishedAt: vuln.published || null, // the ADVISORY's date — the Steward ages by it (KJC-TSK-0789 AC6)
          package: name,
          version,
          ecosystem,
          source,
          fixed: extractFixedVersion(vuln),
        });
      }
    }
  }
  return { total: flat.length, vulnerabilities: flat };
}

/**
 * Resolve a vulnerability's effective severity. osv-scanner reports
 * CVSS (per-vuln) and a separate `groups[].severity` (per scanner run).
 * Group severity wins when present because it reflects scanner policy.
 */
function extractSeverity(vuln, groups) {
  // Group-level severity (scanner-resolved, includes ecosystem context)
  for (const group of groups) {
    if (group.ids?.includes(vuln.id) && group.severity) {
      return String(group.severity).toUpperCase();
    }
  }
  // Per-vuln CVSS — pick the highest score
  const severities = Array.isArray(vuln.severity) ? vuln.severity : [];
  for (const sev of severities) {
    if (sev?.severity) return String(sev.severity).toUpperCase();
  }
  // database_specific severity (GHSA-style)
  if (vuln.database_specific?.severity) {
    return String(vuln.database_specific.severity).toUpperCase();
  }
  return "UNKNOWN";
}

function extractFixedVersion(vuln) {
  const ranges = vuln.affected?.[0]?.ranges || [];
  for (const range of ranges) {
    const events = range.events || [];
    for (const event of events) {
      if (event.fixed) return event.fixed;
    }
  }
  return null;
}

/**
 * Group vulnerabilities by severity, preserving canonical ordering
 * (CRITICAL → HIGH → MEDIUM/MODERATE → LOW → UNKNOWN).
 */
export function groupVulnerabilitiesBySeverity(vulnerabilities) {
  const groups = Object.fromEntries(SEVERITY_ORDER.map(s => [s, []]));
  groups.UNKNOWN = [];
  for (const vuln of vulnerabilities || []) {
    const sev = (vuln.severity || "UNKNOWN").toUpperCase();
    if (groups[sev]) groups[sev].push(vuln);
    else groups.UNKNOWN.push(vuln);
  }
  return groups;
}
