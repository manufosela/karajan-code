import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing code for security vulnerabilities."
].join(" ");

export class SecurityRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "security" });
  }

  async buildPrompt({ task, diff }) {
    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);
    sections.push(
      "You are a security auditor. Analyze the code changes for vulnerabilities.",
      "Check for: OWASP top 10, exposed secrets/API keys, hardcoded credentials, command injection, XSS, SQL injection, path traversal, prototype pollution, insecure dependencies.",
      "Return a single valid JSON object with your findings and nothing else.",
      '{"vulnerabilities":[{"severity":"critical|high|medium|low","category":string,"file":string,"line":number,"description":string,"fix_suggestion":string}],"verdict":"pass"|"fail"}',
      `## Task\n${task}`
    );
    if (diff) sections.push(`## Git diff to audit\n${diff}`);
    return { prompt: sections.join("\n\n") };
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: null };
    return { task: input?.task || this.context?.task || "", diff: input?.diff || null, onOutput: input?.onOutput || null };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  isSuccessful(parsed) {
    const verdict = parsed.verdict || (parsed.vulnerabilities?.length ? "fail" : "pass");
    return verdict === "pass";
  }

  buildSuccessResult(parsed, provider) {
    const verdict = parsed.verdict || (parsed.vulnerabilities?.length ? "fail" : "pass");
    return { vulnerabilities: parsed.vulnerabilities || [], verdict, provider };
  }

  buildSummary(parsed) {
    const verdict = parsed.verdict || (parsed.vulnerabilities?.length ? "fail" : "pass");
    const vulns = parsed.vulnerabilities || [];
    if (!vulns.length) return `Verdict: ${verdict}; No vulnerabilities found`;

    const bySeverity = {};
    for (const v of vulns) bySeverity[v.severity || "unknown"] = (bySeverity[v.severity || "unknown"] || 0) + 1;

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    const parts = Object.entries(bySeverity)
      .sort(([a], [b]) => (order[a] ?? 4) - (order[b] ?? 4))
      .map(([sev, count]) => `${count} ${sev}`);

    return `Verdict: ${verdict}; ${parts.join(", ")}`;
  }
}
