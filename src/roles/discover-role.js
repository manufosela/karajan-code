import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildDiscoverPrompt, parseDiscoverOutput } from "../prompts/discover.js";

function resolveProvider(config) {
  return (
    config?.roles?.discover?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function collectModeParts(parsed, mode, gapCount) {
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
  return parts;
}

function buildSummary(parsed, mode) {
  const gapCount = parsed.gaps?.length || 0;
  const parts = collectModeParts(parsed, mode, gapCount);
  if (parts.length === 0) return "Discovery complete: task is ready";
  return `Discovery complete: ${parts.join(", ")} (verdict: ${parsed.verdict})`;
}

function resolveInput(input, context) {
  if (typeof input === "string") {
    return { task: input, onOutput: null, mode: "gaps", context: null };
  }
  return {
    task: input?.task || context?.task || "",
    onOutput: input?.onOutput || null,
    mode: input?.mode || "gaps",
    context: input?.context || null
  };
}

function buildUnstructuredResult(output, mode, provider, usage) {
  return {
    ok: true,
    result: { verdict: "ready", gaps: [], mode, raw: output, provider },
    summary: "Discovery complete (unstructured output)",
    usage
  };
}

const MODE_FIELDS = {
  momtest: { key: "momTestQuestions", fallback: [] },
  wendel: { key: "wendelChecklist", fallback: [] },
  classify: { key: "classification", fallback: null },
  jtbd: { key: "jtbds", fallback: [] }
};

function buildResultFromParsed(parsed, mode, provider) {
  const resultObj = { verdict: parsed.verdict, gaps: parsed.gaps, mode, provider };
  const fieldDef = MODE_FIELDS[mode];
  if (fieldDef) {
    resultObj[fieldDef.key] = parsed[fieldDef.key] ?? fieldDef.fallback;
  }
  return resultObj;
}

export class DiscoverRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "discover", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const { task, onOutput, mode, context } = resolveInput(input, this.context);
    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

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
      if (!parsed) return buildUnstructuredResult(result.output, mode, provider, result.usage);

      return {
        ok: true,
        result: buildResultFromParsed(parsed, mode, provider),
        summary: buildSummary(parsed, mode),
        usage: result.usage
      };
    } catch { /* agent output is not structured JSON */
      return buildUnstructuredResult(result.output, mode, provider, result.usage);
    }
  }
}
