import { describe, expect, it } from "vitest";
import { tools } from "../../src/mcp/tools.js";

describe("MCP tools schema", () => {
  it("exposes sessionId and format fields for kj_report", () => {
    const reportTool = tools.find((tool) => tool.name === "kj_report");

    expect(reportTool).toBeDefined();
    expect(reportTool.inputSchema?.properties?.sessionId?.type).toBe("string");
    expect(reportTool.inputSchema?.properties?.format?.enum).toEqual(["text", "json"]);
  });

  it("exposes kj_clean with dry-run-by-default + nuke + retention knobs", () => {
    // Garbage collector surfaced through MCP so Claude Desktop / Cursor can
    // drive `kj clean` without shelling out. Dogfood feedback that motivated
    // it: "quiero limpiar tooooodo lo que haya ahora mismo".
    const cleanTool = tools.find((tool) => tool.name === "kj_clean");

    expect(cleanTool).toBeDefined();
    const props = cleanTool.inputSchema?.properties || {};
    expect(props.yes?.type).toBe("boolean");
    expect(props.nuke?.type).toBe("boolean");
    for (const knob of ["planDays", "draftDays", "sessionDays", "huDays"]) {
      expect(props[knob]?.type).toBe("number");
    }
    // Dry-run by default — no required fields.
    expect(cleanTool.inputSchema?.required || []).toEqual([]);
  });
});
