import { describe, it, expect } from "vitest";
import { formatAdvancedIndex } from "../../src/commands/advanced.js";
import { ADVANCED_GROUPS } from "../../src/cli/advanced-commands.js";

describe("formatAdvancedIndex (KJC-TSK-0582)", () => {
  const descriptions = {
    audit: "Analyze codebase health (read-only)",
    rag: "Retrieval-augmented search\nsecond line ignored",
  };

  it("renders every group title and command", () => {
    const text = formatAdvancedIndex(descriptions);
    for (const group of ADVANCED_GROUPS) {
      expect(text).toContain(`${group.title}:`);
      for (const name of group.commands) {
        expect(text).toContain(`kj ${name}`);
      }
    }
  });

  it("includes the one-line description next to the command", () => {
    const text = formatAdvancedIndex(descriptions);
    expect(text).toContain("Analyze codebase health (read-only)");
  });

  it("uses only the first line of a multi-line description", () => {
    const text = formatAdvancedIndex(descriptions);
    expect(text).toContain("Retrieval-augmented search");
    expect(text).not.toContain("second line ignored");
  });

  it("tolerates a missing description without crashing", () => {
    const text = formatAdvancedIndex({});
    expect(text).toContain("kj audit");
    expect(text).toContain("Usa 'kj <comando> --help'");
  });

  it("accepts a Map as well as a plain object", () => {
    const text = formatAdvancedIndex(new Map([["audit", "Health check"]]));
    expect(text).toContain("Health check");
  });
});
