import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

const SUBAGENT_PREAMBLE = [
  "IMPORTANT: You are running as a Karajan sub-agent.",
  "Do NOT ask about using Karajan, do NOT mention Karajan, do NOT suggest orchestration.",
  "Do NOT use any MCP tools. Focus only on task complexity triage."
].join(" ");

const VALID_LEVELS = new Set(["trivial", "simple", "medium", "complex"]);
const VALID_ROLES = new Set(["planner", "researcher", "refactorer", "reviewer", "tester", "security"]);

function resolveProvider(config) {
  return (
    config?.roles?.triage?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, instructions }) {
  const sections = [SUBAGENT_PREAMBLE];

  if (instructions) {
    sections.push(instructions);
  }

  sections.push(
    "Classify the task complexity and recommend only the necessary pipeline roles.",
    "Keep the reasoning short and practical.",
    "Return a single valid JSON object and nothing else.",
    'JSON schema: {"level":"trivial|simple|medium|complex","roles":["planner|researcher|refactorer|reviewer|tester|security"],"reasoning":string}'
  );

  sections.push(`## Task\n${task}`);

  return sections.join("\n\n");
}

function parseTriageOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return Array.from(new Set(roles.filter((role) => VALID_ROLES.has(role))));
}

export class TriageRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "triage", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = typeof input === "string"
      ? input
      : input?.task || this.context?.task || "";

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({ task, instructions: this.instructions });
    const result = await agent.runTask({ prompt, role: "triage" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Triage failed",
          provider
        },
        summary: `Triage failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseTriageOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: {
            level: "medium",
            roles: ["reviewer"],
            reasoning: "Unstructured output, using safe defaults.",
            provider,
            raw: result.output
          },
          summary: "Triage complete (fallback defaults)",
          usage: result.usage
        };
      }

      const level = VALID_LEVELS.has(parsed.level) ? parsed.level : "medium";
      const roles = normalizeRoles(parsed.roles);
      const reasoning = String(parsed.reasoning || "").trim() || "No reasoning provided.";

      return {
        ok: true,
        result: {
          level,
          roles,
          reasoning,
          provider
        },
        summary: `Triage: ${level} (${roles.length} role${roles.length === 1 ? "" : "s"})`,
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: {
          level: "medium",
          roles: ["reviewer"],
          reasoning: "Failed to parse triage output, using safe defaults.",
          provider,
          raw: result.output
        },
        summary: "Triage complete (fallback defaults)",
        usage: result.usage
      };
    }
  }
}
