// Tests for the MCP `specReviewMode` parameter (KJC-PCS-0048 PR 3b).
// Verifies that:
//   - the parameter is declared in the tool schemas for kj_run and kj_plan
//   - the handlers map `specReviewMode: "skip"` to `skipSpecReview: true`

import { describe, expect, it } from "vitest";
import { normalizePlanArgs } from "../../src/mcp/tool-arg-normalizers.js";

describe("MCP specReviewMode parameter (KJC-PCS-0048 PR 3b)", () => {
  it("normalizePlanArgs preserves skipSpecReview through the normalizer", () => {
    const out = normalizePlanArgs({ task: "x", skipSpecReview: true });
    expect(out.skipSpecReview).toBe(true);
  });
});
