import { describe, expect, it } from "vitest";
import { applyRunOverrides } from "../src/config.js";

describe("config quiet/verbose flags", () => {
  const baseConfig = {
    coder: "claude",
    reviewer: "codex",
    review_mode: "standard",
    max_iterations: 5,
    development: { methodology: "tdd", require_test_changes: true, require_green_suite: false },
    output: { report_dir: "./.reviews", log_level: "info", quiet: true },
    roles: {},
    pipeline: {},
    session: {},
    git: {},
    sonarqube: {},
    budget: {}
  };

  it("defaults to quiet=true", () => {
    const result = applyRunOverrides(baseConfig, {});
    expect(result.output.quiet).toBe(true);
  });

  it("--verbose sets quiet=false", () => {
    const result = applyRunOverrides(baseConfig, { verbose: true });
    expect(result.output.quiet).toBe(false);
  });

  it("--quiet explicitly sets quiet=true", () => {
    const startConfig = { ...baseConfig, output: { ...baseConfig.output, quiet: false } };
    const result = applyRunOverrides(startConfig, { quiet: true });
    expect(result.output.quiet).toBe(true);
  });

  it("--verbose overrides default quiet", () => {
    const result = applyRunOverrides(baseConfig, { verbose: true });
    expect(result.output.quiet).toBe(false);
  });
});
