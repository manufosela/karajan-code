import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/agents/index.js", () => ({
  createAgent: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  resolveRole: vi.fn(),
}));

describe("skills/semantic-detector", () => {
  let refineSkillsSemantically, resolveSkillsMode, SEMANTIC_CATALOG;
  let createAgent, resolveRole;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ refineSkillsSemantically, resolveSkillsMode, SEMANTIC_CATALOG } =
      await import("../../src/skills/semantic-detector.js"));
    ({ createAgent } = await import("../../src/agents/index.js"));
    ({ resolveRole } = await import("../../src/config.js"));
  });

  describe("resolveSkillsMode", () => {
    it("defaults to auto when config.testHarness.defaultSkillsMode is absent", () => {
      // Production contract: no testHarness means "auto" fallback.
      expect(resolveSkillsMode({})).toBe("auto");
      expect(resolveSkillsMode({}, {})).toBe("auto");
    });

    it("respects config.testHarness.defaultSkillsMode (test-harness path)", () => {
      // Post-v2.7.5 the test harness override flows through the config object,
      // not globalThis. Production code no longer reads globalThis directly —
      // the config loader resolves tests/setup.js's globalThis.__KJ_DEFAULT_SKILLS_MODE
      // into config.testHarness.defaultSkillsMode once, at load time.
      expect(resolveSkillsMode({ testHarness: { defaultSkillsMode: "regex" } })).toBe("regex");
    });

    it("reads from flags.skillsMode first", () => {
      expect(resolveSkillsMode({ skills: { mode: "none" } }, { skillsMode: "semantic" })).toBe("semantic");
    });

    it("falls back to config.skills.mode", () => {
      expect(resolveSkillsMode({ skills: { mode: "regex" } })).toBe("regex");
    });

    it("clamps unknown values to auto", () => {
      expect(resolveSkillsMode({}, { skillsMode: "bogus" })).toBe("auto");
    });

    it("accepts all 4 documented modes", () => {
      for (const mode of ["auto", "regex", "semantic", "none"]) {
        expect(resolveSkillsMode({}, { skillsMode: mode })).toBe(mode);
      }
    });
  });

  describe("refineSkillsSemantically", () => {
    it("returns [] when no triage/planner provider is configured", async () => {
      resolveRole.mockReturnValue({ provider: null });
      const logger = { debug: vi.fn() };
      const out = await refineSkillsSemantically({ task: "build X", config: {}, logger });
      expect(out).toEqual([]);
      expect(createAgent).not.toHaveBeenCalled();
    });

    it("returns [] when the agent fails to create", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockImplementation(() => { throw new Error("no API key"); });
      const logger = { debug: vi.fn() };
      const out = await refineSkillsSemantically({ task: "build X", config: {}, logger });
      expect(out).toEqual([]);
    });

    it("returns [] when agent.runTask returns not-ok", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockReturnValue({
        runTask: vi.fn().mockResolvedValue({ ok: false }),
      });
      const logger = { debug: vi.fn() };
      const out = await refineSkillsSemantically({ task: "x", config: {}, logger });
      expect(out).toEqual([]);
    });

    it("returns parsed skills, filtered to the catalog and excluding already-detected", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockReturnValue({
        runTask: vi.fn().mockResolvedValue({
          ok: true,
          output: '["sql-analysis","hallucinated-skill","owasp-top-10","prisma"]',
        }),
      });
      const out = await refineSkillsSemantically({
        task: "add migration tracking",
        alreadyDetected: ["prisma"],
        config: {},
        logger: { debug: vi.fn(), warn: vi.fn() },
      });
      expect(out).toContain("sql-analysis");
      expect(out).toContain("owasp-top-10");
      expect(out).not.toContain("hallucinated-skill"); // not in catalog
      expect(out).not.toContain("prisma"); // already detected
    });

    it("limits results to 5 suggestions", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockReturnValue({
        runTask: vi.fn().mockResolvedValue({
          ok: true,
          output: JSON.stringify(SEMANTIC_CATALOG.slice(0, 10)),
        }),
      });
      const out = await refineSkillsSemantically({ task: "x", config: {}, logger: { debug: vi.fn() } });
      expect(out.length).toBeLessThanOrEqual(5);
    });

    it("returns [] on malformed classifier output", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockReturnValue({
        runTask: vi.fn().mockResolvedValue({ ok: true, output: "nope, no JSON here" }),
      });
      const out = await refineSkillsSemantically({ task: "x", config: {}, logger: { debug: vi.fn() } });
      expect(out).toEqual([]);
    });

    it("returns [] on classifier throw", async () => {
      resolveRole.mockImplementation((_, role) => role === "triage" ? { provider: "claude" } : { provider: null });
      createAgent.mockReturnValue({
        runTask: vi.fn().mockRejectedValue(new Error("network")),
      });
      const logger = { warn: vi.fn(), debug: vi.fn() };
      const out = await refineSkillsSemantically({ task: "x", config: {}, logger });
      expect(out).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns [] when task is empty", async () => {
      const out = await refineSkillsSemantically({ task: "", config: {} });
      expect(out).toEqual([]);
      expect(createAgent).not.toHaveBeenCalled();
    });
  });
});
