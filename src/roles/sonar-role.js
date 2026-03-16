import { BaseRole } from "./base-role.js";
import { runSonarScan } from "../sonar/scanner.js";
import { getQualityGateStatus, getOpenIssues } from "../sonar/api.js";
import { shouldBlockByProfile, summarizeIssues } from "../sonar/enforcer.js";

function normalizeIssues(rawIssues) {
  return rawIssues.map((issue) => ({
    severity: issue.severity || "UNKNOWN",
    type: issue.type || "UNKNOWN",
    file: issue.component || "",
    line: issue.line || 0,
    rule: issue.rule || "",
    message: issue.message || ""
  }));
}

export class SonarRole extends BaseRole {
  constructor({ config, logger, emitter = null }) {
    super({ name: "sonar", config, logger, emitter });
  }

  async execute(_input) {
    const scan = await runSonarScan(this.config);

    if (!scan.ok) {
      return {
        ok: false,
        result: {
          projectKey: scan.projectKey || null,
          gateStatus: null,
          issues: [],
          openIssuesTotal: 0,
          issuesSummary: "",
          blocking: false,
          error: scan.stderr || scan.stdout || "Scan failed"
        },
        summary: `Sonar scan failed: ${scan.stderr || scan.stdout || "unknown error"}`
      };
    }

    const gate = await getQualityGateStatus(this.config, scan.projectKey);
    const openIssues = await getOpenIssues(this.config, scan.projectKey);
    const issues = normalizeIssues(openIssues.issues || []);
    const issuesSummary = summarizeIssues(openIssues.issues || []);

    const profile = this.config.sonarqube?.enforcement_profile || "pragmatic";
    const blocking = shouldBlockByProfile({
      gateStatus: gate.status,
      profile
    });

    return {
      ok: !blocking,
      result: {
        projectKey: scan.projectKey,
        gateStatus: gate.status,
        conditions: gate.conditions || [],
        issues,
        openIssuesTotal: openIssues.total || 0,
        issuesSummary,
        blocking
      },
      summary: (() => {
        const issuesPart = issuesSummary ? ` (${issuesSummary})` : "";
        const blockingPart = blocking ? " [BLOCKING]" : "";
        return `Quality gate: ${gate.status}; Issues: ${openIssues.total || 0}${issuesPart}${blockingPart}`;
      })()
    };
  }
}
