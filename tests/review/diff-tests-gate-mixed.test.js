// HU-4918 (KJC-BUG-0670): a diff whose packages use different runners, or none kj knows,
// gets one note that says what ran and what did not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTestsGate } from "../../src/review/diff-tests-gate.js";

let root;
const seed = (rel) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), "{}");
};
const green = () => vi.fn(async () => ({ exitCode: 0, stdout: "passed", stderr: "" }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-diff-tests-mixed-"));
  seed("package.json");
  seed("packages/a/package.json");
  seed("packages/b/package.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("diffTestsGate with mixed runners (HU-4918)", () => {
  it("names every runner that ran in the green note", async () => {
    const detect = async (dir) => ({ framework: dir.endsWith("/a") ? "vitest" : "jest", language: "javascript" });
    const out = await diffTestsGate({ projectDir: root, liveFiles: ["packages/a/x.test.js", "packages/b/y.test.js"], detect, run: green() });
    expect(out.note).toBe("2 test file(s) of the diff passed with vitest, jest");
  });

  it("says which files ran and which had no runner, in one line", async () => {
    const detect = async (dir) => ({ framework: dir.endsWith("/a") ? "vitest" : "go", language: "javascript" });
    const run = green();
    const out = await diffTestsGate({ projectDir: root, liveFiles: ["packages/a/x.test.js", "packages/b/y.test.js"], detect, run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.rejection).toBeNull();
    expect(out.note).toBe("1 test file(s) of the diff passed with vitest; 1 test file(s) in the diff not run: no runner kj knows for go");
  });

  it("detects the root once even when several packages fall back to it", async () => {
    const detect = vi.fn(async (dir) => (dir === root ? { framework: "vitest", language: "javascript" } : null));
    await diffTestsGate({ projectDir: root, liveFiles: ["tests/r.test.js", "packages/a/x.test.js", "packages/b/y.test.js"], detect, run: green() });
    expect(detect.mock.calls.filter(([dir]) => dir === root)).toHaveLength(1);
  });
});
