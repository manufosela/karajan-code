import { BaseRole } from "./base-role.js";
import { createAgent as defaultCreateAgent } from "../agents/index.js";

function resolveProvider(config) {
  return (
    config?.roles?.refactorer?.provider ||
    config?.roles?.coder?.provider ||
    "claude"
  );
}

function buildPrompt({ task, instructions }) {
  const sections = [];

  if (instructions) {
    sections.push(instructions);
    sections.push("");
  }

  sections.push("Refactor the current changes for clarity and maintainability without changing behavior.");
  sections.push("Do not expand scope and keep tests green.");
  sections.push("");
  sections.push("## Task context");
  sections.push(task);

  return sections.join("\n");
}

export class RefactorerRole extends BaseRole {
  constructor({ config, logger, emitter = null, createAgentFn = null }) {
    super({ name: "refactorer", config, logger, emitter });
    this._createAgent = createAgentFn || defaultCreateAgent;
  }

  async execute(input) {
    const task = typeof input === "string"
      ? input
      : input?.task || this.context?.task || "";

    const provider = resolveProvider(this.config);
    const agent = this._createAgent(provider, this.config, this.logger);

    const prompt = buildPrompt({ task, instructions: this.instructions });
    const result = await agent.runTask({ prompt, role: "refactorer" });

    if (!result.ok) {
      return {
        ok: false,
        result: {
          error: result.error || result.output || "Refactorer failed",
          provider
        },
        summary: `Refactorer failed: ${result.error || "unknown error"}`
      };
    }

    return {
      ok: true,
      result: {
        output: result.output?.trim() || "",
        provider
      },
      summary: "Refactoring applied"
    };
  }
}
