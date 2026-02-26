import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on evaluating test quality."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.tester?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, diff, sonarIssues, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a test quality gate. You do NOT write tests — you evaluate them.",
    "Run the test suite, check coverage, identify missing scenarios, and evaluate assertion quality.",
    "Return a single valid JSON object with your findings and nothing else.",
    'JSON schema: {"tests_pass":boolean,"coverage":{"overall":number,"services":number,"utilities":number},"missing_scenarios":[string],"quality_issues":[string],"verdict":"pass"|"fail"}'
  );

  sections.push(`## Task\n${task}`);

  if (diff) {
    sections.push(`## Git diff\n${diff}`);
  }

  if (sonarIssues) {
    sections.push(`## Sonar test issues\n${sonarIssues}`);
  }

  return sections.join("\n\n");
}

function parseTesterOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

export class TesterRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "tester", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, diff, sonarIssues } = typeof input === "string"
      ? { task: input, diff: null, sonarIssues: null }
      : { task: input?.task || this.context?.task || "", diff: input?.diff || null, sonarIssues: input?.sonarIssues || null };

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({ task, diff, sonarIssues, instructions: this.instructions });
    const result = await agent.runTask({ prompt, role: "tester" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Tester failed",
          provider
        },
        summary: `Tester failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseTesterOutput(result.output);
      if (!parsed) {
        return {
          ok: false,
          result: { error: "Failed to parse tester output: no JSON found", provider },
          summary: "Tester output parse error: no JSON found"
        };
      }

      const verdict = parsed.verdict || (parsed.tests_pass ? "pass" : "fail");
      const ok = verdict === "pass";
      const coverage = parsed.coverage || {};

      return {
        ok,
        result: {
          tests_pass: Boolean(parsed.tests_pass),
          coverage,
          missing_scenarios: parsed.missing_scenarios || [],
          quality_issues: parsed.quality_issues || [],
          verdict,
          provider
        },
        summary: `Verdict: ${verdict}; Coverage: ${coverage.overall ?? "?"}%${parsed.missing_scenarios?.length ? `; ${parsed.missing_scenarios.length} missing scenario(s)` : ""}${parsed.quality_issues?.length ? `; ${parsed.quality_issues.length} quality issue(s)` : ""}`
      };
    } catch (err) {
      return {
        ok: false,
        result: { error: `Failed to parse tester output: ${err.message}`, provider },
        summary: `Tester output parse error: ${err.message}`
      };
    }
  }
}
