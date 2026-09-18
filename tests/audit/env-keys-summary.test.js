// KJC-TSK-0845 part B — the env/config key findings render in the deterministic
// summary of `kj audit` with every site, and count as findings for the LLM gate.
import { describe, it, expect } from "vitest";
import { formatDeterministicSummary, deterministicContextHasFindings } from "../../src/audit/deterministic-summary.js";

const envKeys = {
  available: true, scanned: 42,
  incomplete: [{ key: "KJ_HOME", successor: "KARAJAN_HOME", file: "packages/hu-board/src/preflight.js", line: 149 }],
  divergent: [{ key: "KARAJAN_HOME", kind: "env", rules: [
    { rule: 'KARAJAN_HOME || process.env.KJ_HOME || join(homedir(),".karajan")', sites: ["src/harden/sentinel-hooks.js:286"] },
    { rule: 'KARAJAN_HOME || path.join(os.homedir(),".karajan")', sites: ["src/utils/home-migration.js:50"] },
  ] }],
};

describe("formatDeterministicSummary — env/config key block", () => {
  it("names the incomplete migration and every rule of a divergent key with its sites", () => {
    const md = formatDeterministicSummary({ envKeys });
    expect(md).toContain("### Env/config key resolution");
    expect(md).toContain("- Files scanned: 42");
    expect(md).toContain("- Incomplete migrations: 1 · keys resolved with divergent rules: 1");
    expect(md).toContain("HIGH packages/hu-board/src/preflight.js:149 reads `KJ_HOME` and never `KARAJAN_HOME`");
    expect(md).toContain("MEDIUM [env] `KARAJAN_HOME` resolved 2 ways:");
    expect(md).toContain('`KARAJAN_HOME || path.join(os.homedir(),".karajan")` ← src/utils/home-migration.js:50');
  });

  it("says when the scan was not available, and renders nothing without the block", () => {
    expect(formatDeterministicSummary({ envKeys: { available: false, reason: "projectDir not provided" } })).toContain("not available — projectDir not provided");
    expect(formatDeterministicSummary({})).not.toContain("Env/config key");
  });

  it("counts as findings for the LLM gate only when something was found", () => {
    expect(deterministicContextHasFindings({ envKeys })).toBe(true);
    expect(deterministicContextHasFindings({ envKeys: { available: true, scanned: 3, divergent: [], incomplete: [] } })).toBe(false);
    expect(deterministicContextHasFindings({ envKeys: { available: false } })).toBe(false);
  });
});
