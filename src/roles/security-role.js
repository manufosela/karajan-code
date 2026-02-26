import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on auditing code for security vulnerabilities."
].join(" ");

function resolveProvider(config) {
  return (
    config?.roles?.security?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, diff, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "You are a security auditor. Analyze the code changes for vulnerabilities.",
    "Check for: OWASP top 10, exposed secrets/API keys, hardcoded credentials, command injection, XSS, SQL injection, path traversal, prototype pollution, insecure dependencies.",
    "Return a single valid JSON object with your findings and nothing else.",
    'JSON schema: {"vulnerabilities":[{"severity":"critical|high|medium|low","category":string,"file":string,"line":number,"description":string,"fix_suggestion":string}],"verdict":"pass"|"fail"}'
  );

  sections.push(`## Task\n${task}`);

  if (diff) {
    sections.push(`## Git diff to audit\n${diff}`);
  }

  return sections.join("\n\n");
}

function parseSecurityOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function buildSummary(parsed) {
  const vulns = parsed.vulnerabilities || [];
  if (vulns.length === 0) {
    return `Verdict: ${parsed.verdict || "pass"}; No vulnerabilities found`;
  }

  const bySeverity = {};
  for (const v of vulns) {
    const sev = v.severity || "unknown";
    bySeverity[sev] = (bySeverity[sev] || 0) + 1;
  }

  const parts = Object.entries(bySeverity)
    .sort(([a], [b]) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a] ?? 4) - (order[b] ?? 4);
    })
    .map(([sev, count]) => `${count} ${sev}`);

  return `Verdict: ${parsed.verdict || "fail"}; ${parts.join(", ")}`;
}

export class SecurityRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "security", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, diff } = typeof input === "string"
      ? { task: input, diff: null }
      : { task: input?.task || this.context?.task || "", diff: input?.diff || null };

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({ task, diff, instructions: this.instructions });
    const result = await agent.runTask({ prompt, role: "security" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Security audit failed",
          provider
        },
        summary: `Security audit failed: ${result.error || "unknown error"}`
      };
    }

    try {
      const parsed = parseSecurityOutput(result.output);
      if (!parsed) {
        return {
          ok: false,
          result: { error: "Failed to parse security output: no JSON found", provider },
          summary: "Security output parse error: no JSON found"
        };
      }

      const verdict = parsed.verdict || (parsed.vulnerabilities?.length ? "fail" : "pass");
      const ok = verdict === "pass";

      return {
        ok,
        result: {
          vulnerabilities: parsed.vulnerabilities || [],
          verdict,
          provider
        },
        summary: buildSummary({ ...parsed, verdict })
      };
    } catch (err) {
      return {
        ok: false,
        result: { error: `Failed to parse security output: ${err.message}`, provider },
        summary: `Security output parse error: ${err.message}`
      };
    }
  }
}
