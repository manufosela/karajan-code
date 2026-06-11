import { describe, expect, it } from "vitest";
import {
  STABLE,
  VOLATILE,
  section,
  buildPromptLayout,
  joinLayout,
} from "../../src/prompts/prompt-layout.js";

describe("prompts/prompt-layout", () => {
  describe("section", () => {
    it("tags content with the given stability", () => {
      expect(section("rules", STABLE)).toEqual({ content: "rules", stability: STABLE });
      expect(section("task", VOLATILE)).toEqual({ content: "task", stability: VOLATILE });
    });

    it("defaults to volatile when stability is omitted", () => {
      expect(section("diff")).toEqual({ content: "diff", stability: VOLATILE });
    });

    it("returns null for empty or non-string content", () => {
      expect(section("")).toBeNull();
      expect(section(null)).toBeNull();
      expect(section(undefined)).toBeNull();
    });
  });

  describe("buildPromptLayout", () => {
    it("separates buckets preserving insertion order within each", () => {
      const layout = buildPromptLayout([
        section("preamble", STABLE),
        section("task body", VOLATILE),
        section("coder rules", STABLE),
        section("reviewer feedback", VOLATILE),
        section("skills", STABLE),
      ]);
      expect(layout.stable).toBe("preamble\n\ncoder rules\n\nskills");
      expect(layout.volatile).toBe("task body\n\nreviewer feedback");
    });

    it("produces a byte-identical stable block across calls with different volatile content", () => {
      const stableSections = () => [
        section("preamble", STABLE),
        section("rules", STABLE),
        section("skills", STABLE),
      ];
      const a = buildPromptLayout([...stableSections(), section("task A", VOLATILE)]);
      const b = buildPromptLayout([section("task B", VOLATILE), ...stableSections()]);
      expect(a.stable).toBe(b.stable);
      expect(a.volatile).not.toBe(b.volatile);
    });

    it("loses no content: every section appears exactly once across both buckets", () => {
      const contents = ["alpha", "beta", "gamma", "delta"];
      const layout = buildPromptLayout([
        section("alpha", STABLE),
        section("beta", VOLATILE),
        section("gamma", STABLE),
        section("delta", VOLATILE),
      ]);
      const full = joinLayout(layout);
      for (const c of contents) {
        expect(full.split(c).length - 1).toBe(1);
      }
    });

    it("skips null and undefined entries (pattern: conditional sections)", () => {
      const layout = buildPromptLayout([
        section("preamble", STABLE),
        null,
        undefined,
        section("", STABLE),
        section("task", VOLATILE),
      ]);
      expect(layout.stable).toBe("preamble");
      expect(layout.volatile).toBe("task");
    });

    it("throws on entries without a valid stability tag (no silent fallback)", () => {
      expect(() => buildPromptLayout([{ content: "x", stability: "sometimes" }])).toThrow(/stability/);
      expect(() => buildPromptLayout(["bare string"])).toThrow(/stability/);
    });

    it("returns empty strings for empty buckets", () => {
      expect(buildPromptLayout([section("only stable", STABLE)])).toEqual({
        stable: "only stable",
        volatile: "",
      });
      expect(buildPromptLayout([])).toEqual({ stable: "", volatile: "" });
    });
  });

  describe("joinLayout", () => {
    it("joins stable before volatile with a blank-line separator", () => {
      expect(joinLayout({ stable: "A\n\nB", volatile: "C" })).toBe("A\n\nB\n\nC");
    });

    it("omits the separator when a bucket is empty", () => {
      expect(joinLayout({ stable: "A", volatile: "" })).toBe("A");
      expect(joinLayout({ stable: "", volatile: "C" })).toBe("C");
      expect(joinLayout({ stable: "", volatile: "" })).toBe("");
    });
  });
});
