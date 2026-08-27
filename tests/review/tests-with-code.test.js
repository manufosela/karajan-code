// KJC-TSK-0687 (MG-B, épica KJC-PCS-0068) — the verifiable half of TDD is
// deterministic: a staged diff that touches source code without touching
// any test warns (or blocks, by config). Test-FIRST stays with the
// reviewer; test-PRESENT belongs to the gate.

import { describe, it, expect } from "vitest";
import { checkTestsWithCode } from "../../src/review/tests-with-code.js";

const run = (files, cfg = {}, env = {}) => checkTestsWithCode({ config: cfg, stagedFiles: files, env });

describe("checkTestsWithCode", () => {
  it("warns by default when sources change without any test change", () => {
    const r = run(["src/commands/foo.js", "src/utils/bar.js"]);
    expect(r).toMatchObject({ ok: true, mode: "warn" });
    expect(r.sources).toEqual(["src/commands/foo.js", "src/utils/bar.js"]);
  });

  it("passes when a test accompanies the code (any configured pattern)", () => {
    for (const test of ["tests/foo.test.js", "src/__tests__/bar.js", "lib/x.spec.ts"]) {
      expect(run(["src/foo.js", test]).mode).toBe("pass");
    }
  });

  it("docs/config-only diffs pass silently — no source extensions touched", () => {
    expect(run(["README.md", "kj.config.yml", "docs/guide.md"]).mode).toBe("pass");
  });

  it("block via method_gates.tests_with_code; KJ_ALLOW_NO_TESTS=1 is the escape", () => {
    const blocked = run(["src/foo.py"], { method_gates: { tests_with_code: "block" } });
    expect(blocked).toMatchObject({ ok: false, mode: "block" });
    const escaped = run(["src/foo.py"], { method_gates: { tests_with_code: "block" } }, { KJ_ALLOW_NO_TESTS: "1" });
    expect(escaped).toMatchObject({ ok: true, mode: "exempt" });
  });

  // KJC-TSK-0795 AC1 (epic KJC-PCS-0082) — measured in GREBLA: the gate fired
  // on both cleanup PRs. Deleting code adds no behavior to test; asking for a
  // test there is the false positive that teaches people to skip the gate.
  it("a diff that only REMOVES source lines is exempt, even in block mode", () => {
    const r = checkTestsWithCode({
      config: { method_gates: { tests_with_code: "block" } },
      stagedFiles: ["src/dead.js", "src/old.js"],
      numstat: [{ file: "src/dead.js", added: 0, removed: 40 }, { file: "src/old.js", added: 0, removed: 7 }],
      env: {},
    });
    expect(r).toMatchObject({ ok: true, mode: "delete-only" });
  });

  it("one added line in any source keeps the gate armed", () => {
    const r = checkTestsWithCode({
      config: {}, env: {},
      stagedFiles: ["src/a.js", "src/b.js"],
      numstat: [{ file: "src/a.js", added: 0, removed: 4 }, { file: "src/b.js", added: 1, removed: 0 }],
    });
    expect(r.mode).toBe("warn");
  });

  it("without numstat the behavior is unchanged — callers that only know names", () => {
    expect(run(["src/a.js"]).mode).toBe("warn");
  });

  it("respects the project's own patterns from development.*", () => {
    const cfg = { development: { test_file_patterns: ["/checks/"], source_file_extensions: [".go"] } };
    expect(run(["main.go", "checks/main_check.go"], cfg).mode).toBe("pass");
    expect(run(["main.go"], cfg).mode).toBe("warn");
    expect(run(["src/app.js"], cfg).mode).toBe("pass"); // .js not a source ext here
  });
});
