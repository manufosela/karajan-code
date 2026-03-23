import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

function resolveProvider(config) {
  return (
    config?.roles?.planner?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function resolvePlannerSilenceTimeoutMs(config) {
  const minutes = Number(config?.session?.max_agent_silence_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60 * 1000);
}

function resolvePlannerRuntimeTimeoutMs(config) {
  const minutes = Number(config?.session?.max_planner_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes * 60 * 1000);
}

function appendDecompositionSection(sections, triageDecomposition) {
  if (!triageDecomposition?.length) return;
  sections.push("## Triage decomposition recommendation", "The triage stage determined this task should be decomposed. Suggested subtasks:");
  for (let i = 0; i < triageDecomposition.length; i++) {
    sections.push(`${i + 1}. ${triageDecomposition[i]}`);
  }
  sections.push("", "Focus your plan on the FIRST subtask only. List the remaining subtasks as 'pending_subtasks' in your output for documentation.", "");
}

const RESEARCH_FIELDS = [
  { key: "affected_files", label: "Affected files" },
  { key: "patterns", label: "Patterns" },
  { key: "constraints", label: "Constraints" },
  { key: "risks", label: "Risks" },
  { key: "prior_decisions", label: "Prior decisions" }
];

function appendResearchSection(sections, research) {
  if (!research) return;
  sections.push("## Research findings");
  for (const { key, label } of RESEARCH_FIELDS) {
    if (research[key]?.length) {
      sections.push(`${label}: ${research[key].join(", ")}`);
    }
  }
  sections.push("");
}

function appendArchitectSection(sections, architectContext) {
  if (!architectContext) return;
  const arch = architectContext.architecture || {};
  sections.push("## Architecture context");
  if (arch.type) sections.push(`Type: ${arch.type}`);
  if (arch.layers?.length) sections.push(`Layers: ${arch.layers.join(", ")}`);
  if (arch.patterns?.length) sections.push(`Patterns: ${arch.patterns.join(", ")}`);
  if (arch.dataModel?.entities?.length) sections.push(`Data model entities: ${arch.dataModel.entities.join(", ")}`);
  if (arch.apiContracts?.length) sections.push(`API contracts: ${arch.apiContracts.join(", ")}`);
  if (arch.tradeoffs?.length) sections.push(`Tradeoffs: ${arch.tradeoffs.join(", ")}`);
  if (architectContext.summary) sections.push(`Summary: ${architectContext.summary}`);
  sections.push("");
}

function buildPrompt({ task, instructions, research, triageDecomposition, architectContext, productContext = null }) {
  const sections = [];

  if (instructions) {
    sections.push(instructions, "");
  }

  sections.push(
    "Create an implementation plan for this task.",
    "Return concise numbered steps focused on execution order and risk.",
    ""
  );

  if (productContext) {
    sections.push("## Product Context", productContext, "");
  }

  appendDecompositionSection(sections, triageDecomposition);
  appendArchitectSection(sections, architectContext);
  appendResearchSection(sections, research);

  sections.push("## Task", task);

  return sections.join("\n");
}

export class PlannerRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "planner", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, onOutput } = typeof input === "string"
      ? { task: input, onOutput: null }
      : { task: input?.task || input || "", onOutput: input?.onOutput || null };
    const taskStr = task || this.context?.task || "";
    const research = this.context?.research || null;
    const triageDecomposition = this.context?.triageDecomposition || null;
    const architectContext = this.context?.architecture || null;
    const provider = resolveProvider(this.config);

    const agent = this._createAgent(provider, this.config, this.logger);
    const prompt = buildPrompt({ task: taskStr, instructions: this.instructions, research, triageDecomposition, architectContext, productContext: this.config?.productContext || null });

    const runArgs = { prompt, role: "planner" };
    if (onOutput) runArgs.onOutput = onOutput;
    const silenceTimeoutMs = resolvePlannerSilenceTimeoutMs(this.config);
    if (silenceTimeoutMs) runArgs.silenceTimeoutMs = silenceTimeoutMs;
    const timeoutMs = resolvePlannerRuntimeTimeoutMs(this.config);
    if (timeoutMs) runArgs.timeoutMs = timeoutMs;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: { ...result, error: result.error || result.output || "Planner agent failed", plan: null },
        summary: `Planner failed: ${result.error || "unknown error"}`
      };
    }

    const plan = result.output?.trim() || "";
    return {
      ok: true,
      result: { ...result, plan, provider },
      summary: plan ? `Plan generated (${plan.split("\n").length} lines)` : "Empty plan generated"
    };
  }
}
