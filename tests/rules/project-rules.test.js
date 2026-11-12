/**
 * HU-3505: this repo's own compiled rules (.karajan/rules.yml) hold their
 * deny/allow examples, so a gate that stops denying what it names (the
 * interactive wizard run through npm exec, for one) fails the suite.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { rulesEval, rulesTest } from "../../src/commands/rules.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the project's compiled rules", () => {
  it("every deterministic rule denies its deny examples and allows its allow examples", () => {
    const result = rulesTest({ projectDir: repoRoot });
    expect(result.lines.filter((line) => line.startsWith("✗"))).toEqual([]);
    expect(result.code).toBe(0);
  });

  it.each([
    "npm exec create-next-app web",
    "npm exec -- create-vite my-app",
    "cd web && npm x --package=create-astro -- create-astro",
  ])("the interactive wizard guard denies %s", (command) => {
    const result = rulesEval({ projectDir: repoRoot, tool: "Bash", input: JSON.stringify({ command }) });
    expect(result.output.decision).toBe("deny");
  });

  it("the interactive wizard guard allows npm exec when --yes goes to the wizard", () => {
    const command = "npm exec -- create-vite my-app --yes";
    const result = rulesEval({ projectDir: repoRoot, tool: "Bash", input: JSON.stringify({ command }) });
    expect(result.output.decision).not.toBe("deny");
  });
});
