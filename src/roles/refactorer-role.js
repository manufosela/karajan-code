import { AgentRole } from "./agent-role.js";

export class RefactorerRole extends AgentRole {
  constructor(opts) {
    super({ ...opts, name: "refactorer" });
  }

  resolveProvider() {
    return this.config?.roles?.refactorer?.provider || this.config?.roles?.coder?.provider || "claude";
  }

  async buildPrompt({ task }) {
    const sections = [];
    if (this.instructions) sections.push(this.instructions, "");
    sections.push(
      "Refactor the current changes for clarity and maintainability without changing behavior.",
      "Do not expand scope and keep tests green.",
      "",
      "## Task context",
      task
    );
    return { prompt: sections.join("\n") };
  }

  buildSuccessResult(parsed, provider, agentResult) {
    return { ...agentResult, output: (agentResult.output || "").trim(), provider };
  }

  buildSummary() { return "Refactoring applied"; }
}
