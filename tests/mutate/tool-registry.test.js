import { describe, expect, it } from "vitest";
import {
  getMutationTool,
  listSupportedLanguages,
} from "../../src/mutate/tool-registry.js";

describe("getMutationTool", () => {
  it("maps javascript and typescript to Stryker", () => {
    const js = getMutationTool("javascript");
    const ts = getMutationTool("typescript");
    expect(js.supported).toBe(true);
    expect(js.id).toBe("stryker");
    expect(ts.id).toBe("stryker");
    expect(js.binary).toBe("stryker");
  });

  it("maps python to mutmut", () => {
    const tool = getMutationTool("python");
    expect(tool.supported).toBe(true);
    expect(tool.id).toBe("mutmut");
    expect(tool.installHint).toContain("mutmut");
  });

  it("maps php to Infection", () => {
    const tool = getMutationTool("php");
    expect(tool.supported).toBe(true);
    expect(tool.id).toBe("infection");
    expect(tool.installHint).toContain("infection");
  });

  it("maps go to go-mutesting", () => {
    const tool = getMutationTool("go");
    expect(tool.supported).toBe(true);
    expect(tool.id).toBe("go-mutesting");
  });

  it("maps java to PIT", () => {
    const tool = getMutationTool("java");
    expect(tool.supported).toBe(true);
    expect(tool.id).toBe("pitest");
  });

  it("every supported tool exposes a scope and json report format", () => {
    for (const language of listSupportedLanguages()) {
      const tool = getMutationTool(language);
      expect(tool.scope).toBeTypeOf("object");
      expect(tool.scope.flag).toBeTypeOf("string");
      expect(tool.reportFormat).toBe("json");
      expect(tool.installHint.length).toBeGreaterThan(0);
    }
  });

  it("returns explicit unsupported for native mobile languages", () => {
    for (const language of ["swift", "kotlin"]) {
      const tool = getMutationTool(language);
      expect(tool.supported).toBe(false);
      expect(tool.reason.length).toBeGreaterThan(0);
    }
  });

  it("returns explicit unsupported (never a silent fallback) for unknown languages", () => {
    const tool = getMutationTool("cobol");
    expect(tool.supported).toBe(false);
    expect(tool.reason.length).toBeGreaterThan(0);
  });

  it("normalizes casing and whitespace", () => {
    expect(getMutationTool("  JavaScript ").id).toBe("stryker");
  });

  it("returns unsupported for empty or non-string input", () => {
    expect(getMutationTool("").supported).toBe(false);
    expect(getMutationTool(null).supported).toBe(false);
    expect(getMutationTool(undefined).supported).toBe(false);
  });
});
