import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildTriagePrompt } from "../prompts/triage.js";
import { VALID_TASK_TYPES } from "../guards/policy-resolver.js";

const VALID_LEVELS = new Set(["trivial", "simple", "medium", "complex"]);
const VALID_ROLES = new Set(["planner", "researcher", "refactorer", "reviewer", "tester", "security", "impeccable"]);
const FALLBACK_TASK_TYPE = "sw";

function resolveProvider(config) {
  return (
    config?.roles?.triage?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function parseTriageOutput(raw) {
  const text = raw?.trim() || "";
  const jsonMatch = /\{[\s\S]*\}/.exec(text);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[0]);
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return Array.from(new Set(roles.filter((role) => VALID_ROLES.has(role))));
}

function normalizeSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  return subtasks
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
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
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildTriagePrompt({ task, instructions: this.instructions });
    const runArgs = { prompt, role: "triage" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

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
            taskType: FALLBACK_TASK_TYPE,
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
      const shouldDecompose = Boolean(parsed.shouldDecompose);
      const subtasks = normalizeSubtasks(parsed.subtasks);
      const taskType = VALID_TASK_TYPES.has(parsed.taskType) ? parsed.taskType : FALLBACK_TASK_TYPE;

      const triageResult = {
        level,
        roles,
        reasoning,
        taskType,
        provider
      };

      if (shouldDecompose && subtasks.length > 0) {
        triageResult.shouldDecompose = true;
        triageResult.subtasks = subtasks;
      } else {
        triageResult.shouldDecompose = false;
      }

      const decomposeNote = shouldDecompose ? " — decomposition recommended" : "";
      return {
        ok: true,
        result: triageResult,
        summary: `Triage: ${level} (${roles.length} role${roles.length === 1 ? "" : "s"})${decomposeNote}`,
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: {
          level: "medium",
          roles: ["reviewer"],
          reasoning: "Failed to parse triage output, using safe defaults.",
          taskType: FALLBACK_TASK_TYPE,
          provider,
          raw: result.output
        },
        summary: "Triage complete (fallback defaults)",
        usage: result.usage
      };
    }
  }
}
