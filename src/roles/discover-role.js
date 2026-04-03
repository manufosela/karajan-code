import { AgentRole } from "./agent-role.js";
import { buildDiscoverPrompt, parseDiscoverOutput } from "../prompts/discover.js";

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const MODE_FIELDS = {
  momtest: { key: "momTestQuestions", fallback: [] },
  wendel: { key: "wendelChecklist", fallback: [] },
  classify: { key: "classification", fallback: null },
  jtbd: { key: "jtbds", fallback: [] }
};

function buildSummary(parsed, mode) {
  const gapCount = parsed.gaps?.length || 0;
  const parts = [];
  if (gapCount > 0) parts.push(`${pluralize(gapCount, "gap", "gaps")} found`);
  if (mode === "momtest") {
    const qCount = parsed.momTestQuestions?.length || 0;
    if (qCount > 0) parts.push(`${pluralize(qCount, "Mom Test question", "Mom Test questions")}`);
  }
  if (mode === "wendel") {
    const failCount = (parsed.wendelChecklist || []).filter(c => c.status === "fail").length;
    if (failCount > 0) parts.push(`${pluralize(failCount, "Wendel condition", "Wendel conditions")} failed`);
  }
  if (mode === "classify" && parsed.classification) {
    parts.push(`type: ${parsed.classification.type}, risk: ${parsed.classification.adoptionRisk}`);
  }
  if (mode === "jtbd") {
    const jCount = parsed.jtbds?.length || 0;
    if (jCount > 0) parts.push(`${pluralize(jCount, "JTBD", "JTBDs")} generated`);
  }
  if (parts.length === 0) return "Discovery complete: task is ready";
  return `Discovery complete: ${parts.join(", ")} (verdict: ${parsed.verdict})`;
}

export class DiscoverRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "discover" });
  }

  async execute(input) {
    const task = typeof input === "string" ? input : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;
    const mode = typeof input === "object" ? input?.mode || "gaps" : "gaps";
    const context = typeof input === "object" ? input?.context || null : null;

    const provider = this.resolveProvider();
    const agent = this.createAgentInstance(provider);

    const prompt = buildDiscoverPrompt({ task, instructions: this.instructions, mode, context });
    const runArgs = { prompt, role: "discover" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: { error: result.error || result.output || "Discovery failed", provider, mode },
        summary: `Discovery failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseDiscoverOutput(result.output);
      if (!parsed) {
        return { ok: true, result: { verdict: "ready", gaps: [], mode, raw: result.output, provider }, summary: "Discovery complete (unstructured output)", usage: result.usage };
      }

      const resultObj = { verdict: parsed.verdict, gaps: parsed.gaps, mode, provider };
      const fieldDef = MODE_FIELDS[mode];
      if (fieldDef) resultObj[fieldDef.key] = parsed[fieldDef.key] ?? fieldDef.fallback;

      return { ok: true, result: resultObj, summary: buildSummary(parsed, mode), usage: result.usage };
    } catch {
      return { ok: true, result: { verdict: "ready", gaps: [], mode, raw: result.output, provider }, summary: "Discovery complete (unstructured output)", usage: result.usage };
    }
  }
}
