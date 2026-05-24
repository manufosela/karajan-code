// KJC-TSK-0434 (RAG Camino D) — pure-heuristic decisor.
import { describe, expect, it } from "vitest";
import { shouldPreloadRag } from "../../src/orchestrator/stages/rag-preload-decisor.js";

describe("shouldPreloadRag — Brain decisor heuristic", () => {
  describe("policy overrides", () => {
    it("policy=always always pulls", () => {
      const r = shouldPreloadRag({ task: "tiny", config: { rag: { preload: { policy: "always" } } } });
      expect(r).toEqual({ pull: true, reason: "policy:always" });
    });

    it("policy=never never pulls", () => {
      const r = shouldPreloadRag({
        task: "x".repeat(5000),
        triage: { shouldDecompose: true, level: "complex" },
        config: { rag: { preload: { policy: "never" } } },
      });
      expect(r).toEqual({ pull: false, reason: "policy:never" });
    });
  });

  describe("policy=auto (default)", () => {
    it("brownfield flag forces pull", () => {
      const r = shouldPreloadRag({
        task: "x",
        config: { rag: { preload: { brownfield: true } } },
      });
      expect(r.pull).toBe(true);
      expect(r.reason).toBe("auto:brownfield");
    });

    it("triage.shouldDecompose=true pulls", () => {
      const r = shouldPreloadRag({ task: "x", triage: { shouldDecompose: true } });
      expect(r).toEqual({ pull: true, reason: "auto:decompose" });
    });

    it("triage.level=complex pulls", () => {
      const r = shouldPreloadRag({ task: "x", triage: { level: "complex" } });
      expect(r).toEqual({ pull: true, reason: "auto:complex" });
    });

    it("triage.level=high pulls (alias)", () => {
      const r = shouldPreloadRag({ task: "x", triage: { level: "HIGH" } });
      expect(r).toEqual({ pull: true, reason: "auto:complex" });
    });

    it("long task body pulls", () => {
      const r = shouldPreloadRag({ task: "x".repeat(250) });
      expect(r).toEqual({ pull: true, reason: "auto:long-task" });
    });

    it("short task + no signals → skip", () => {
      const r = shouldPreloadRag({ task: "fix typo", triage: { level: "trivial" } });
      expect(r).toEqual({ pull: false, reason: "auto:low-value" });
    });

    it("no triage and short task → skip", () => {
      const r = shouldPreloadRag({ task: "rename file" });
      expect(r).toEqual({ pull: false, reason: "auto:low-value" });
    });

    it("defaults to auto when config missing", () => {
      const r = shouldPreloadRag({ task: "tiny" });
      expect(r.pull).toBe(false);
      expect(r.reason).toBe("auto:low-value");
    });
  });

  describe("precedence", () => {
    it("policy:always wins over auto signals", () => {
      const r = shouldPreloadRag({
        task: "tiny",
        triage: { level: "trivial" },
        config: { rag: { preload: { policy: "always" } } },
      });
      expect(r.reason).toBe("policy:always");
    });

    it("policy:never wins over brownfield/decompose/complex", () => {
      const r = shouldPreloadRag({
        task: "x".repeat(500),
        triage: { shouldDecompose: true, level: "complex" },
        config: { rag: { preload: { policy: "never", brownfield: true } } },
      });
      expect(r.reason).toBe("policy:never");
    });

    it("brownfield wins over no-other-signals when policy=auto", () => {
      const r = shouldPreloadRag({
        task: "x",
        triage: { level: "trivial" },
        config: { rag: { preload: { brownfield: true } } },
      });
      expect(r.reason).toBe("auto:brownfield");
    });
  });
});
