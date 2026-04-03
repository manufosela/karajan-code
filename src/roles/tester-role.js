import { AgentRole } from "./agent-role.js";
import { extractFirstJson } from "../utils/json-extract.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on evaluating test quality."
].join(" ");

export class TesterRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "tester" });
  }

  extractInput(input) {
    if (typeof input === "string") return { task: input, diff: null, sonarIssues: null };
    return {
      task: input?.task || this.context?.task || "",
      diff: input?.diff || null,
      sonarIssues: input?.sonarIssues || null,
      onOutput: input?.onOutput || null
    };
  }

  async buildPrompt({ task, diff, sonarIssues }) {
    const sections = [SUBAGENT_PREAMBLE];
    if (this.instructions) sections.push(this.instructions);
    sections.push(
      "You are a test quality gate. You do NOT write tests — you evaluate them.",
      "Run the test suite, check coverage, identify missing scenarios, and evaluate assertion quality.",
      "Return a single valid JSON object with your findings and nothing else.",
      '{"tests_pass":boolean,"coverage":{"overall":number,"services":number,"utilities":number},"missing_scenarios":[string],"quality_issues":[string],"verdict":"pass"|"fail"}',
      `## Task\n${task}`
    );
    if (diff) sections.push(`## Git diff\n${diff}`);
    if (sonarIssues) sections.push(`## Sonar test issues\n${sonarIssues}`);
    return { prompt: sections.join("\n\n") };
  }

  parseOutput(raw) { return extractFirstJson(raw); }

  isSuccessful(parsed) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    return verdict === "pass";
  }

  buildSuccessResult(parsed, provider) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    return {
      tests_pass: Boolean(parsed.tests_pass),
      coverage: parsed.coverage || {},
      missing_scenarios: parsed.missing_scenarios || [],
      quality_issues: parsed.quality_issues || [],
      verdict,
      provider
    };
  }

  buildSummary(parsed) {
    const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
    const coverage = parsed.coverage || {};
    const missingPart = parsed.missing_scenarios?.length ? `; ${parsed.missing_scenarios.length} missing scenario(s)` : "";
    const qualityPart = parsed.quality_issues?.length ? `; ${parsed.quality_issues.length} quality issue(s)` : "";
    return `Verdict: ${verdict}; Coverage: ${coverage.overall ?? "?"}%${missingPart}${qualityPart}`;
  }
}
