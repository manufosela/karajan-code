import { describe, it, expect } from "vitest";
import { printResumeHint } from "../../src/utils/display/resume-hint.js";

// Phase 1 (PR 3+4/4) of the resilience audit: when a `kj run` / `kj plan`
// stops, the LAST thing printed must be the exact command to resume it.

function capture(result) {
  const lines = [];
  printResumeHint(result, { print: (l) => lines.push(l) });
  return lines.join("\n");
}

describe("printResumeHint", () => {
  it("hibernated → 'kj standby resume <id>'", () => {
    expect(capture({ hibernated: true, sessionId: "s_2026" }))
      .toContain("kj standby resume s_2026");
  });

  it("hibernated without id → placeholder + 'kj standby list' pointer", () => {
    const out = capture({ hibernated: true });
    expect(out).toContain("kj standby resume <session-id>");
    expect(out).toContain("kj standby list");
  });

  it("paused → 'kj resume <id> --answer'", () => {
    expect(capture({ paused: true, sessionId: "s_x" }))
      .toContain('kj resume s_x --answer');
  });

  it("stopped/failed with a sessionId → 'kj resume <id>'", () => {
    expect(capture({ approved: false, sessionId: "s_fail" }))
      .toContain("kj resume s_fail");
  });

  it("a successful run prints nothing", () => {
    expect(capture({ approved: true, sessionId: "s_ok" })).toBe("");
  });

  it("a failure with no session id prints nothing (nothing to resume blindly)", () => {
    expect(capture({ approved: false })).toBe("");
  });

  it("tolerates a null / non-object result", () => {
    expect(capture(null)).toBe("");
    expect(capture(undefined)).toBe("");
  });
});
