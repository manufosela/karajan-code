import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

function resolveProvider(config) {
  return (
    config?.roles?.planner?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, instructions, research }) {
  const sections = [];

  if (instructions) {
    sections.push(instructions);
    sections.push("");
  }

  sections.push("Create an implementation plan for this task.");
  sections.push("Return concise numbered steps focused on execution order and risk.");
  sections.push("");

  if (research) {
    sections.push("## Research findings");
    if (research.affected_files?.length) {
      sections.push(`Affected files: ${research.affected_files.join(", ")}`);
    }
    if (research.patterns?.length) {
      sections.push(`Patterns: ${research.patterns.join(", ")}`);
    }
    if (research.constraints?.length) {
      sections.push(`Constraints: ${research.constraints.join(", ")}`);
    }
    if (research.risks?.length) {
      sections.push(`Risks: ${research.risks.join(", ")}`);
    }
    if (research.prior_decisions?.length) {
      sections.push(`Prior decisions: ${research.prior_decisions.join(", ")}`);
    }
    sections.push("");
  }

  sections.push("## Task");
  sections.push(task);

  return sections.join("\n");
}

export class PlannerRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "planner", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = input || this.context?.task || "";
    const research = this.context?.research || null;
    const provider = resolveProvider(this.config);

    const agent = this._createAgent(provider, this.config, this.logger);
    const prompt = buildPrompt({ task, instructions: this.instructions, research });

    const result = await agent.runTask({ prompt, role: "planner" });

    if (!result.ok) {
      return {
        ok: false,
        result: { error: result.error || result.output || "Planner agent failed", plan: null },
        summary: `Planner failed: ${result.error || "unknown error"}`
      };
    }

    const plan = result.output?.trim() || "";
    return {
      ok: true,
      result: { plan, provider },
      summary: plan ? `Plan generated (${plan.split("\n").length} lines)` : "Empty plan generated"
    };
  }
}
