import { describe, it, expect } from "vitest";
import { tools } from "../../src/mcp/tools.js";
import { handleToolCall } from "../../src/mcp/server-handlers.js";
import { retiredMessage } from "../../src/cli/retired-commands.js";

// KJC-TSK-1318: the MCP tools of the kj run pipeline, retired in 5.0 with
// their commands, answer with the same notice and never start an agent.
const RETIRED = {
  kj_run: "run", kj_resume: "resume", kj_plan: "plan generate", kj_status: "status", kj_undo: "undo",
  kj_triage: "triage", kj_researcher: "researcher", kj_architect: "architect", kj_review: "review",
};

describe("retired MCP tools (KJC-TSK-1318)", () => {
  it.each(Object.entries(RETIRED))("%s fails with the CLI's retirement notice", async (tool, command) => {
    const r = await handleToolCall(tool, { task: "add a login form", projectDir: "/nonexistent" });
    expect(r).toEqual({ ok: false, error: retiredMessage(command) });
    expect(r.error).toContain("MIGRATION-v5.md");
  });

  it("no longer lists them, and keeps the method's tools", () => {
    const names = tools.map((t) => t.name);
    for (const tool of Object.keys(RETIRED)) expect(names).not.toContain(tool);
    expect(names).toEqual(expect.arrayContaining(["kj_code", "kj_audit", "kj_discover", "kj_board", "kj_hu", "kj_rag_query"]));
  });
});
