import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STATUS, STRATEGY } from "../src/checks/types.js";
import { __test } from "../src/commands/doctor.js";

// KJC-TSK-0599 — the binary bundles no toolchain, so `kj doctor` prints a
// Prerequisites block that separates what is required to run kj at all
// (git + at least one agent CLI) from what is optional. The verdict is
// derived from the checks already collected, not re-probed.

const { printPrerequisites } = __test;

function makeReport(checks) {
  return { checks, overrides: {}, summary: {}, totalMs: 1 };
}

let logs;

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("printPrerequisites", () => {
  it("marks required OK when git and at least one agent are present", () => {
    printPrerequisites(makeReport([
      { name: "git", label: "git", status: STATUS.OK, strategy: STRATEGY.MANUAL, detail: "git 2.45", runMs: 1 },
      { name: "agent:codex", label: "Agent: codex", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not found", runMs: 1 },
      { name: "agent:claude", label: "Agent: claude", status: STATUS.OK, strategy: STRATEGY.MANUAL, detail: "2.0", runMs: 1 },
    ]));
    const out = logs.join("\n");
    expect(out).toContain("Required: git OK");
    expect(out).toContain("agent CLI OK (claude)");
    expect(out).toContain("Optional: Docker");
  });

  it("flags git and agent as MISSING when neither is present", () => {
    printPrerequisites(makeReport([
      { name: "git", label: "git", status: STATUS.FAIL, strategy: STRATEGY.MANUAL, detail: "Not found", runMs: 1 },
      { name: "agent:claude", label: "Agent: claude", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not found", runMs: 1 },
    ]));
    const out = logs.join("\n");
    expect(out).toContain("git MISSING");
    expect(out).toContain("agent CLI MISSING — install Claude Code, Codex or Gemini");
  });
});
