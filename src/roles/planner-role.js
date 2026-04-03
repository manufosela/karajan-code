import { AgentRole } from "./agent-role.js";

const RESEARCH_FIELDS = [
  { key: "affected_files", label: "Affected files" },
  { key: "patterns", label: "Patterns" },
  { key: "constraints", label: "Constraints" },
  { key: "risks", label: "Risks" },
  { key: "prior_decisions", label: "Prior decisions" }
];

function appendDecompositionSection(sections, triageDecomposition) {
  if (!triageDecomposition?.length) return;
  sections.push("## Triage decomposition recommendation", "The triage stage determined this task should be decomposed. Suggested subtasks:");
  for (let i = 0; i < triageDecomposition.length; i++) sections.push(`${i + 1}. ${triageDecomposition[i]}`);
  sections.push("", "Focus your plan on the FIRST subtask only. List the remaining subtasks as 'pending_subtasks' in your output for documentation.", "");
}

function appendResearchSection(sections, research) {
  if (!research) return;
  sections.push("## Research findings");
  for (const { key, label } of RESEARCH_FIELDS) {
    if (research[key]?.length) sections.push(`${label}: ${research[key].join(", ")}`);
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

function resolveSilenceTimeoutMs(config) {
  const minutes = Number(config?.session?.max_agent_silence_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60 * 1000) : null;
}

function resolveRuntimeTimeoutMs(config) {
  const minutes = Number(config?.session?.max_planner_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60 * 1000) : null;
}

export class PlannerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "planner" });
  }

  async execute(input) {
    const { task: rawTask, onOutput } = typeof input === "string"
      ? { task: input, onOutput: null }
      : { task: input?.task || input || "", onOutput: input?.onOutput || null };

    const task = rawTask || this.context?.task || "";
    const research = this.context?.research || null;
    const triageDecomposition = this.context?.triageDecomposition || null;
    const architectContext = this.context?.architecture || null;

    const sections = [];
    if (this.instructions) sections.push(this.instructions, "");
    sections.push("Create an implementation plan for this task.", "Return concise numbered steps focused on execution order and risk.", "");
    if (this.config?.productContext) sections.push("## Product Context", this.config.productContext, "");
    if (this.config?.domainContext) sections.push("## Domain Context", this.config.domainContext, "");
    appendDecompositionSection(sections, triageDecomposition);
    appendArchitectSection(sections, architectContext);
    appendResearchSection(sections, research);
    sections.push("## Task", task);

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);
    const runArgs = { prompt: sections.join("\n"), role: "planner" };
    if (onOutput) runArgs.onOutput = onOutput;

    const silenceMs = resolveSilenceTimeoutMs(this.config);
    if (silenceMs) runArgs.silenceTimeoutMs = silenceMs;
    const timeoutMs = resolveRuntimeTimeoutMs(this.config);
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
