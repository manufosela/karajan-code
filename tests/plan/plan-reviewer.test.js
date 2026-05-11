import { describe, expect, it, vi } from "vitest";
import { buildReviewerPrompt, reviewPlan, findingsCount } from "../../src/plan/plan-reviewer.js";

describe("buildReviewerPrompt", () => {
  it("constrains the LLM to five closed-ended questions, no free-form suggestions", () => {
    const p = buildReviewerPrompt({
      task: "build it",
      hus: [{ id: "h1", title: "do x", scope: "x scope", blocked_by: [] }],
    });
    expect(p).toMatch(/missing_hus/);
    expect(p).toMatch(/missing_dependencies/);
    expect(p).toMatch(/scope_overlaps/);
    expect(p).toMatch(/parallelisable_groups/);
    expect(p).toMatch(/order_issues/);
    // Anti-scope-creep nudges
    expect(p).toMatch(/DO NOT propose new features/i);
    expect(p).toMatch(/DO NOT propose tests/i);
    expect(p).toMatch(/DO NOT suggest renames/i);
  });

  it("renders each HU with id + title + scope + blocked_by + spec_section", () => {
    const p = buildReviewerPrompt({
      task: "x",
      hus: [
        { id: "h1", title: "first", scope: "do x", blocked_by: [], spec_section: "1.1" },
        { id: "h2", title: "second", scope: "do y", blocked_by: ["h1"] },
      ],
    });
    expect(p).toMatch(/h1 \[§1\.1\]: first/);
    expect(p).toMatch(/scope: do x/);
    expect(p).toMatch(/h2: second ← blocked_by: h1/);
  });

  it("requires JSON-only output", () => {
    const p = buildReviewerPrompt({ task: "x", hus: [{ id: "h1" }] });
    expect(p).toMatch(/Return ONLY the JSON/);
  });

  it("caps suggestions at 5 per array to keep findings actionable", () => {
    const p = buildReviewerPrompt({ task: "x", hus: [{ id: "h1" }] });
    expect(p).toMatch(/at MOST 5 entries per array/);
  });
});

describe("reviewPlan", () => {
  it("short-circuits when there are no HUs to review", async () => {
    const agent = { runTask: vi.fn() };
    const result = await reviewPlan({ agent, task: "x", hus: [] });
    expect(result.ok).toBe(true);
    expect(result.findings.summary).toMatch(/no HUs to review/i);
    expect(agent.runTask).not.toHaveBeenCalled();
  });

  it("parses the LLM's structured response into normalised findings", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({
          missing_hus: [{ spec_section: "5.4", rationale: "calendar sync not covered" }],
          missing_dependencies: [{ from: "h3", on: "h2", rationale: "h3 reads schema h2 creates" }],
          scope_overlaps: [{ between: ["h4", "h5"], rationale: "both touch the file mover" }],
          parallelisable_groups: [{ hus: ["h6", "h7"], rationale: "no shared deps" }],
          order_issues: [{ hus: ["h8"], issue: "wrong order", rationale: "depends on h9 but listed before it" }],
          summary: "Looks solid; 1 missing HU, 1 dep gap.",
        }),
      }),
    };
    const result = await reviewPlan({ agent, task: "x", hus: [{ id: "h1" }] });
    expect(result.ok).toBe(true);
    expect(result.findings.missing_hus).toHaveLength(1);
    expect(result.findings.missing_hus[0].spec_section).toBe("5.4");
    expect(result.findings.missing_dependencies[0].from).toBe("h3");
    expect(result.findings.scope_overlaps[0].between).toEqual(["h4", "h5"]);
    expect(result.findings.parallelisable_groups[0].hus).toEqual(["h6", "h7"]);
    expect(result.findings.order_issues[0].issue).toBe("wrong order");
    expect(result.findings.summary).toMatch(/Looks solid/);
  });

  it("filters out malformed entries (missing required fields)", async () => {
    const agent = {
      runTask: vi.fn().mockResolvedValue({
        ok: true,
        output: JSON.stringify({
          missing_hus: [
            { spec_section: "5.4", rationale: "ok" },
            { rationale: "no section" },             // dropped
            { spec_section: "5.5" },                  // dropped (no rationale)
          ],
          missing_dependencies: [
            { from: "h1", on: "h2", rationale: "ok" },
            { from: "h3" },                           // dropped
          ],
          scope_overlaps: [
            { between: ["h1", "h2"], rationale: "ok" },
            { between: ["only-one"], rationale: "single-element" },  // dropped
          ],
          order_issues: [
            { hus: [], issue: "x" },                  // dropped (no hus)
            { hus: ["h1"], issue: "ok" },
          ],
          parallelisable_groups: [
            { hus: ["h1", "h2"] },
            { hus: ["alone"] },                       // dropped
          ],
        }),
      }),
    };
    const result = await reviewPlan({ agent, task: "x", hus: [{ id: "h1" }] });
    expect(result.findings.missing_hus).toHaveLength(1);
    expect(result.findings.missing_dependencies).toHaveLength(1);
    expect(result.findings.scope_overlaps).toHaveLength(1);
    expect(result.findings.order_issues).toHaveLength(1);
    expect(result.findings.parallelisable_groups).toHaveLength(1);
  });

  it("returns ok:false on agent failure", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: false, error: "rate limited" }) };
    const result = await reviewPlan({ agent, task: "x", hus: [{ id: "h1" }] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rate limited/);
  });

  it("returns ok:false on non-JSON output", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "free-form prose" }) };
    const result = await reviewPlan({ agent, task: "x", hus: [{ id: "h1" }] });
    expect(result.ok).toBe(false);
  });

  it("forwards onOutput / silenceTimeoutMs / timeoutMs to the agent", async () => {
    const agent = { runTask: vi.fn().mockResolvedValue({ ok: true, output: "{}" }) };
    const onOutput = vi.fn();
    await reviewPlan({
      agent, task: "x", hus: [{ id: "h1" }],
      onOutput, silenceTimeoutMs: 9999, timeoutMs: 12345,
    });
    const args = agent.runTask.mock.calls[0][0];
    expect(args.onOutput).toBe(onOutput);
    expect(args.silenceTimeoutMs).toBe(9999);
    expect(args.timeoutMs).toBe(12345);
  });
});

describe("findingsCount", () => {
  it("sums up actionable items only (parallelisable_groups is informational, not counted)", () => {
    expect(findingsCount({
      missing_hus: [1, 2],
      missing_dependencies: [1],
      scope_overlaps: [1, 2, 3],
      order_issues: [1],
      parallelisable_groups: [1, 2, 3, 4, 5],     // ignored
    })).toBe(7);
  });

  it("returns 0 for empty / null findings", () => {
    expect(findingsCount(null)).toBe(0);
    expect(findingsCount({})).toBe(0);
    expect(findingsCount({ missing_hus: [] })).toBe(0);
  });
});
