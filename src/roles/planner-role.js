import { AgentRole } from "./agent-role.js";
import { withBrainRecovery } from "../brain/with-brain-recovery.js";

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
    // Tests-first planning (v2.7.5):
    // The planner MUST emit structured acceptance tests for every step.
    // These are the contract the coder is handed (phase 2 of the
    // tests-first flow); the tester role later runs them as the
    // pass/fail gate. Without them the coder has no executable spec.
    sections.push(
      "Create an implementation plan for this task as structured JSON.",
      "",
      "Output MUST be a JSON object with this exact shape:",
      "",
      "```json",
      "{",
      '  "approach": "<2-3 sentence high-level plan>",',
      '  "risks": ["<risk 1>", "<risk 2>"],',
      '  "outOfScope": ["<excluded item>"],',
      '  "steps": [',
      "    {",
      '      "description": "<what this step achieves, one sentence>",',
      '      "spec_section": "<short reference to the SPEC section this implements, e.g. \\"5.3\\" or \\"§5 Initial Scope\\". Optional but strongly preferred.>",',
      '      "acceptance_tests": [',
      '        { "type": "gherkin", "content": "Given <ctx>\\nWhen <action>\\nThen <outcome>" },',
      '        { "type": "shell", "content": "<bash command that must exit 0>" }',
      "      ]",
      "    }",
      "  ]",
      "}",
      "```",
      "",
      "Rules for acceptance_tests (CRITICAL — this is the contract the coder must satisfy):",
      '- EVERY step MUST have at least one acceptance_test. No empty arrays.',
      '- "gherkin" tests describe observable behaviour in natural language. Use them for end-to-end or user-facing assertions.',
      '- "shell" tests are bash commands that exit 0 on success. Use them for concrete verifications (file exists, lint passes, specific exit code, HTTP status).',
      '- Write tests BEFORE the step is implemented — they should fail until the step is done, pass afterwards.',
      '- Prefer 2-4 tests per step: one happy-path, at least one edge case / failure path.',
      '- Do NOT use the generic fallback "npx vitest run" (pre-v2.7.5 placeholder). Each test must assert something specific to the step.',
      "",
      "spec_section: when the task includes a structured SPEC (numbered headings like '## 5. Initial Scope'), every step MUST cite the section it implements. Becomes traceability metadata for the coder and reviewer.",
      "",
      "Steps must be ordered so that each depends only on previous steps (the first step has no prerequisites).",
      "Return ONLY the JSON — no prose, no markdown fences around it.",
      ""
    );
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

    // KJC-TSK-0413 step C: PlannerRole tiene execute() custom (no usa el de
    // AgentRole). Wrap aquí también.
    const result = await withBrainRecovery({
      agent, taskArgs: runArgs, role: "planner", provider,
      emitter: this.emitter, logger: this.logger,
    });

    if (!result.ok) {
      const recoveryNote = result.recovery?.class ? ` [${result.recovery.class}]` : "";
      return {
        ok: false,
        result: { ...result, error: result.error || result.output || `Planner agent failed${recoveryNote}`, plan: null, recovery: result.recovery, action: result.action },
        summary: `Planner failed${recoveryNote}: ${result.recovery?.message || result.error || "unknown error"}`
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
