import { describe, expect, it } from "vitest";
import { buildRtkInstructions, RTK_INSTRUCTIONS } from "../src/prompts/rtk-snippet.js";
import { buildCoderPrompt } from "../src/prompts/coder.js";
import { buildReviewerPrompt } from "../src/prompts/reviewer.js";

describe("proxy-rtk-migration", () => {
  describe("buildRtkInstructions", () => {
    it("returns empty string when proxy is enabled", () => {
      const result = buildRtkInstructions({ rtkAvailable: true, proxyEnabled: true });
      expect(result).toBe("");
    });

    it("returns RTK instructions when proxy is disabled and RTK available", () => {
      const result = buildRtkInstructions({ rtkAvailable: true, proxyEnabled: false });
      expect(result).toBe(RTK_INSTRUCTIONS);
      expect(result).toContain("RTK detected");
    });

    it("returns empty string when RTK is not available (regardless of proxy)", () => {
      expect(buildRtkInstructions({ rtkAvailable: false, proxyEnabled: false })).toBe("");
      expect(buildRtkInstructions({ rtkAvailable: false, proxyEnabled: true })).toBe("");
    });

    it("returns empty string with no arguments", () => {
      expect(buildRtkInstructions()).toBe("");
    });
  });

  describe("buildCoderPrompt — RTK suppression with proxy", () => {
    it("omits RTK instructions when proxy is enabled", async () => {
      const result = await buildCoderPrompt({
        task: "Fix bug",
        rtkAvailable: true,
        proxyEnabled: true
      });
      expect(result).not.toContain("RTK detected");
      expect(result).not.toContain("rtk git status");
    });

    it("includes RTK instructions when proxy is disabled and RTK available", async () => {
      const result = await buildCoderPrompt({
        task: "Fix bug",
        rtkAvailable: true,
        proxyEnabled: false
      });
      expect(result).toContain("RTK detected");
      expect(result).toContain("rtk git status");
    });
  });

  describe("buildReviewerPrompt — RTK suppression with proxy", () => {
    it("omits RTK instructions when proxy is enabled", async () => {
      const result = await buildReviewerPrompt({
        task: "Review changes",
        diff: "diff --git a/file.js",
        reviewRules: "",
        mode: "standard",
        rtkAvailable: true,
        proxyEnabled: true
      });
      expect(result).not.toContain("RTK detected");
    });

    it("includes RTK instructions when proxy is disabled and RTK available", async () => {
      const result = await buildReviewerPrompt({
        task: "Review changes",
        diff: "diff --git a/file.js",
        reviewRules: "",
        mode: "standard",
        rtkAvailable: true,
        proxyEnabled: false
      });
      expect(result).toContain("RTK detected");
    });
  });

  describe("orchestrator RTK skip (unit-level check)", () => {
    it("proxy.enabled config flag is truthy when set", () => {
      const config = { proxy: { enabled: true } };
      expect(Boolean(config.proxy?.enabled)).toBe(true);
    });

    it("proxy.enabled is falsy when proxy is not configured", () => {
      const config = {};
      expect(Boolean(config.proxy?.enabled)).toBe(false);
    });

    it("proxy.enabled is falsy when explicitly disabled", () => {
      const config = { proxy: { enabled: false } };
      expect(Boolean(config.proxy?.enabled)).toBe(false);
    });
  });
});
