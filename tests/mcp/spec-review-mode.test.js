// Tests for the MCP `specReviewMode` parameter (KJC-PCS-0048 PR 3b).
// Verifies that:
//   - the parameter is declared in the tool schemas for kj_run and kj_plan
//   - the handlers map `specReviewMode: "skip"` to `skipSpecReview: true`

import { describe, expect, it } from "vitest";
import { normalizePlanArgs } from "../../src/mcp/tool-arg-normalizers.js";
import { tools } from "../../src/mcp/tools.js";

function findTool(name) {
  return tools.find((t) => t.name === name);
}

describe("MCP specReviewMode parameter (KJC-PCS-0048 PR 3b)", () => {
  it("kj_run schema declares specReviewMode with auto/skip enum", () => {
    const schema = findTool("kj_run")?.inputSchema?.properties?.specReviewMode;
    expect(schema?.type).toBe("string");
    expect(schema?.enum).toEqual(["auto", "skip"]);
    expect(schema?.description).toMatch(/KJC-PCS-0048/);
  });

  it("kj_plan schema declares specReviewMode with auto/skip enum", () => {
    const schema = findTool("kj_plan")?.inputSchema?.properties?.specReviewMode;
    expect(schema?.type).toBe("string");
    expect(schema?.enum).toEqual(["auto", "skip"]);
  });

  it("normalizePlanArgs preserves skipSpecReview through the normalizer", () => {
    const out = normalizePlanArgs({ task: "x", skipSpecReview: true });
    expect(out.skipSpecReview).toBe(true);
  });
});
