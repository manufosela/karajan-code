import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STATUS, STRATEGY } from "../src/checks/types.js";
import { __test } from "../src/commands/doctor.js";

// KJC-TSK v2.18 — the doctor's human printer should suggest
// `kj install-tools` whenever one or more external audit tools are
// missing (semgrep / osv-scanner / lighthouse). This test exercises the
// pure renderer (no mocked pipeline) by feeding it synthetic reports.

const { printHuman } = __test;

function makeReport(checks) {
  return {
    checks,
    overrides: {},
    summary: { ok: checks.filter((c) => c.status === STATUS.OK).length, fixed: 0, warn: checks.filter((c) => c.status === STATUS.WARN).length, fail: 0, skipped: 0, timeout: 0 },
    totalMs: 1,
  };
}

let logs;

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => { logs.push(args.join(" ")); });
});

afterEach(() => { vi.restoreAllMocks(); });

describe("printHuman — install-tools tip", () => {
  it("emits a single-tool tip with --only when ONE audit tool is missing", () => {
    printHuman(
      makeReport([
        { name: "audit-tool:semgrep", label: "Semgrep", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not found", fix: "Run kj install-tools…", extra: { tool: "semgrep" }, runMs: 1 },
      ]),
      { verbose: false },
    );
    const out = logs.join("\n");
    expect(out).toContain("kj install-tools --only semgrep");
    expect(out).toContain("install: semgrep");
  });

  it("emits a multi-tool tip without --only when TWO+ audit tools are missing", () => {
    printHuman(
      makeReport([
        { name: "audit-tool:semgrep", label: "Semgrep", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not found", fix: "x", extra: { tool: "semgrep" }, runMs: 1 },
        { name: "audit-tool:osv-scanner", label: "OSV", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not found", fix: "y", extra: { tool: "osv-scanner" }, runMs: 1 },
      ]),
      { verbose: false },
    );
    const out = logs.join("\n");
    // No --only flag when multiple tools are listed.
    expect(out).toMatch(/kj install-tools(?!.*--only)/);
    expect(out).toContain("semgrep");
    expect(out).toContain("osv-scanner");
  });

  it("does NOT emit the tip when all audit tools are OK", () => {
    printHuman(
      makeReport([
        { name: "audit-tool:semgrep", label: "Semgrep", status: STATUS.OK, strategy: STRATEGY.MANUAL, detail: "1.0.0", runMs: 1 },
        { name: "git", label: "git", status: STATUS.OK, strategy: STRATEGY.MANUAL, detail: "git 2.45", runMs: 1 },
      ]),
      { verbose: false },
    );
    const out = logs.join("\n");
    expect(out).not.toContain("kj install-tools");
  });

  it("ignores non-audit-tool warnings (no false positives)", () => {
    printHuman(
      makeReport([
        { name: "sonar:reachable", label: "Sonar", status: STATUS.WARN, strategy: STRATEGY.MANUAL, detail: "Not reachable", fix: "Start docker", runMs: 1 },
      ]),
      { verbose: false },
    );
    const out = logs.join("\n");
    expect(out).not.toContain("kj install-tools");
  });
});
