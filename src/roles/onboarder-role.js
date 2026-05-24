// KJC-TSK-0384 PR 2 — Onboarder role. Wraps collectors bundle + LLM
// synthesis into a Markdown Architecture Brief.
import { AgentRole } from "./agent-role.js";

const FENCE_RE = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/;

export class OnboarderRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "onboarder" });
  }

  extractInput(input) {
    if (typeof input === "string") return { bundle: { projectDir: input } };
    return { bundle: input?.bundle || input || { projectDir: "" } };
  }

  async buildPrompt({ bundle }) {
    const instructions = this.instructions || "";
    const prompt = [
      instructions,
      "",
      "## Bundle (deterministic collectors output)",
      "",
      "```json",
      JSON.stringify(bundle, null, 2),
      "```",
      "",
      "Produce the Architecture Brief now.",
    ].join("\n");
    return { prompt };
  }

  parseOutput(raw) {
    if (!raw || typeof raw !== "string") return { brief: "" };
    const trimmed = raw.trim();
    const fenced = trimmed.match(FENCE_RE);
    return { brief: fenced ? fenced[1].trim() : trimmed };
  }

  buildSuccessResult(parsed, provider) {
    return { brief: parsed.brief, provider };
  }

  buildSummary(parsed) {
    const lines = (parsed.brief || "").split("\n").length;
    return `Architecture brief composed (${lines} line${lines === 1 ? "" : "s"})`;
  }

  handleParseNull(agentResult, provider) {
    return {
      ok: true,
      result: { brief: agentResult.output || "", provider },
      summary: "Architecture brief composed (raw)",
      usage: agentResult.usage,
    };
  }

  handleParseError(_err, agentResult, provider) {
    return this.handleParseNull(agentResult, provider);
  }
}
