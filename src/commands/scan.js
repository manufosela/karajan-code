import { getOpenIssues, getQualityGateStatus } from "../sonar/api.js";
import { runSonarScan } from "../sonar/scanner.js";
import { summarizeIssues } from "../sonar/enforcer.js";

export async function scanCommand({ config }) {
  const scan = await runSonarScan(config);
  if (!scan.ok) {
    throw new Error(`Sonar scan failed: ${scan.stderr || scan.stdout}`);
  }

  const gate = await getQualityGateStatus(config);
  const issues = await getOpenIssues(config);

  console.log(`Quality Gate: ${gate.status}`);
  console.log(`Open issues: ${issues.total}`);
  console.log(`By severity: ${summarizeIssues(issues.issues) || "none"}`);
}
