import { describe, expect, it } from "vitest";
import { tools } from "../src/mcp/tools.js";

describe("MCP tools schema", () => {
  it("keeps legacy coder aliases in kj_plan input schema", () => {
    const planTool = tools.find((tool) => tool.name === "kj_plan");

    expect(planTool).toBeDefined();
    expect(planTool.inputSchema?.properties?.coder?.type).toBe("string");
    expect(planTool.inputSchema?.properties?.coderModel?.type).toBe("string");
  });
});
