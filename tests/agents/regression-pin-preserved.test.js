// kept-because: translates the Gherkin acceptance scenario for the
// tests/agents diet pass — guards against future passes stripping the
// `// regression-for:` annotation that pins
// claude-agent.test.js's JSON-array payload regression test.
// regression-for: tests/agents diet-pass acceptance
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// regression-for: tests/agents diet-pass acceptance
describe("tests/agents diet pass — regression-pin preservation", () => {
  // regression-for: tests/agents diet-pass acceptance
  it("keeps the // regression-for: annotation in claude-agent.test.js intact", () => {
    const file = readFileSync(
      resolve(here, "claude-agent.test.js"),
      "utf8"
    );
    expect(file).toMatch(/\/\/\s*regression-for:/);
    // The annotation must precede the regression `it(...)` it pins; verify
    // the pinned test still exists by name.
    expect(file).toMatch(
      /extracts result text from a JSON array payload \(regression\)/
    );
    // And the comment must appear before the test it pins.
    const annotationIdx = file.indexOf("// regression-for:");
    const testIdx = file.indexOf(
      "extracts result text from a JSON array payload (regression)"
    );
    expect(annotationIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(-1);
    expect(annotationIdx).toBeLessThan(testIdx);
  });
});
