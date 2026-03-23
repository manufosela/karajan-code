import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";
import { buildArchitectPrompt, parseArchitectOutput } from "../prompts/architect.js";

function resolveProvider(config) {
  return (
    config?.roles?.architect?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildSummary(parsed) {
  const parts = [];
  const arch = parsed.architecture;

  if (arch.type) parts.push(arch.type);

  const layers = arch.layers?.length || 0;
  if (layers) parts.push(`${layers} layer${layers === 1 ? "" : "s"}`);

  const patterns = arch.patterns?.length || 0;
  if (patterns) parts.push(`${patterns} pattern${patterns === 1 ? "" : "s"}`);

  const entities = arch.dataModel?.entities?.length || 0;
  if (entities) parts.push(`${entities} entit${entities === 1 ? "y" : "ies"}`);

  const questions = parsed.questions?.length || 0;
  if (questions) parts.push(`${questions} question${questions === 1 ? "" : "s"}`);

  return parts.length
    ? `Architecture complete: ${parts.join(", ")} (verdict: ${parsed.verdict})`
    : "Architecture complete";
}

const EMPTY_ARCHITECTURE = {
  type: "",
  layers: [],
  patterns: [],
  dataModel: { entities: [] },
  apiContracts: [],
  dependencies: [],
  tradeoffs: []
};

export class ArchitectRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "architect", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = typeof input === "string"
      ? input
      : input?.task || this.context?.task || "";
    const onOutput = typeof input === "string" ? null : input?.onOutput || null;
    const researchContext = typeof input === "object" ? input?.researchContext || null : null;

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildArchitectPrompt({ task, instructions: this.instructions, researchContext, productContext: this.config?.productContext || null });
    const runArgs = { prompt, role: "architect" };
    if (onOutput) runArgs.onOutput = onOutput;
    const result = await agent.runTask(runArgs);

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Architect failed",
          provider
        },
        summary: `Architect failed: ${result.error || "unknown error"}`,
        usage: result.usage
      };
    }

    try {
      const parsed = parseArchitectOutput(result.output);
      if (!parsed) {
        return {
          ok: true,
          result: {
            verdict: "needs_clarification",
            architecture: { ...EMPTY_ARCHITECTURE },
            questions: [],
            raw: result.output,
            provider
          },
          summary: "Architecture complete (unstructured output)",
          usage: result.usage
        };
      }

      return {
        ok: true,
        result: {
          verdict: parsed.verdict,
          architecture: parsed.architecture,
          questions: parsed.questions,
          provider
        },
        summary: buildSummary(parsed),
        usage: result.usage
      };
    } catch {
      return {
        ok: true,
        result: {
          verdict: "needs_clarification",
          architecture: { ...EMPTY_ARCHITECTURE },
          questions: [],
          raw: result.output,
          provider
        },
        summary: "Architecture complete (unstructured output)",
        usage: result.usage
      };
    }
  }
}
