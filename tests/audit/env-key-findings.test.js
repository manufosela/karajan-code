// KJC-TSK-0845 — one key, two resolution rules in two modules = a migration
// left half-way (KJ_HOME → KARAJAN_HOME reached the runtime, not the
// installer). The collector says WHERE and HOW each side resolves it.
// The tree-level collector is covered in env-key-findings-collector.test.js.
import { describe, it, expect } from "vitest";
import { fallbackChain, readsIn } from "../../src/audit/env-key-findings.js";

describe("readsIn / fallbackChain", () => {
  it("extracts env and config subjects with their fallback chain, skipping comments and plain reads", () => {
    const text = [
      "// process.env.IGNORED || 1",
      'const home = process.env.KARAJAN_HOME || process.env.KJ_HOME || path.join(os.homedir(), ".karajan");',
      'const port = process.env["KJ_BOARD_PORT"] ?? "4000";',
      'const base = config?.base_branch || "main";',
      "if (process.env.CI) run();",
    ].join("\n");
    expect(readsIn(text)).toEqual([
      { key: "KARAJAN_HOME", kind: "env", line: 2, chain: ["|| process.env.KJ_HOME", "|| path.join(os.homedir(),\".karajan\")"] },
      { key: "KJ_HOME", kind: "env", line: 2, chain: ["|| path.join(os.homedir(),\".karajan\")"] },
      { key: "KJ_BOARD_PORT", kind: "env", line: 3, chain: ['?? "4000"'] },
      { key: "base_branch", kind: "config", line: 4, chain: ['|| "main"'] },
      { key: "CI", kind: "env", line: 5, chain: [] },
    ]);
    // The operator is part of the rule: `||` and `??` resolve an empty string differently.
    expect(fallbackChain(' || "a" ?? b.c || 3')).toEqual(['|| "a"', "?? b.c", "|| 3"]);
    expect(readsIn("const p = config?.audit?.harness ?? {};")).toEqual([{ key: "audit.harness", kind: "config", line: 1, chain: ["?? {}"] }]);
  });
});

