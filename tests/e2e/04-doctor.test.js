/**
 * E2E #13 — `kj doctor` runs end-to-end and emits a recognisable
 * report. No LLM call. We don't assert specific check outcomes
 * (that depends on the host) — only that doctor RUNS, exits with a
 * valid code, and produces structured output.
 */

import { afterEach, describe, expect, it } from "vitest";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

describe("e2e/13 — kj doctor", () => {
  let proj;
  afterEach(() => proj?.cleanup());

  it("kj doctor runs and exits with a defined code (0=ok, 1=fixable, 2=blocking)", () => {
    proj = makeTmpProject();
    const r = runKj(["doctor", "--check-only"], { cwd: proj.projectDir, timeoutMs: 60_000 });
    // Exit code is one of 0/1/2 — never crashes (negative or undefined).
    expect([0, 1, 2]).toContain(r.exitCode);
  });

  it("kj doctor --json emits parseable JSON", () => {
    proj = makeTmpProject();
    const r = runKj(["doctor", "--check-only", "--json"], { cwd: proj.projectDir, timeoutMs: 60_000 });
    expect([0, 1, 2]).toContain(r.exitCode);
    // Find the JSON object in stdout (doctor prints other stuff around it).
    const m = r.stdout.match(/\{[\s\S]+\}/);
    expect(m, `no JSON found in stdout:\n${r.stdout}`).not.toBeNull();
    const parsed = JSON.parse(m[0]);
    expect(parsed).toHaveProperty("checks");
    expect(Array.isArray(parsed.checks)).toBe(true);
  });
});
