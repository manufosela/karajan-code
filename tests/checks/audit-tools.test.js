import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBinaryChecks } from "../../src/checks/binaries.js";

// KJC-TSK v2.18 — doctor checks for audit-side tools (semgrep, osv-scanner,
// lighthouse). These are warn-severity: missing tools degrade audit
// dimensions but don't block.

vi.mock("../../src/utils/agent-detect.js", async (orig) => {
  const real = await orig();
  return {
    ...real,
    // Default: report tool as missing so we exercise the warn path. Each
    // test overrides per scenario.
    checkBinary: vi.fn(async (name) => ({ ok: false, version: null, path: null, install: name })),
  };
});

vi.mock("../../src/utils/install-hints.js", () => ({
  getInstallHint: vi.fn(async (tool) => ({
    command: `mock-install ${tool}`,
    manager: "mock-pm",
    manualUrl: `https://mock.example/${tool}`,
  })),
  appliesToStack: vi.fn((tool, stack) => {
    if (tool === "lighthouse") return Boolean(stack?.isFrontend || stack?.isFullstack);
    return true;
  }),
}));

vi.mock("../../src/utils/stack-detect.js", () => ({
  detectProjectStack: vi.fn(async () => ({ isBackend: true, isFrontend: false, isFullstack: false })),
}));

function findCheck(name) {
  return getBinaryChecks().find((c) => c.name === name);
}

describe("audit-tool checks — registered in getBinaryChecks", () => {
  it("includes semgrep, osv-scanner, lighthouse", () => {
    const names = getBinaryChecks().map((c) => c.name);
    expect(names).toContain("audit-tool:semgrep");
    expect(names).toContain("audit-tool:osv-scanner");
    expect(names).toContain("audit-tool:lighthouse");
  });
});

describe("audit-tool semgrep check", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("reports warn + install hint when missing", async () => {
    const check = findCheck("audit-tool:semgrep");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    expect(res.ok).toBe(false);
    expect(res.severity).toBe("warn");
    expect(res.fix).toMatch(/kj install-tools.*semgrep/);
    expect(res.fix).toMatch(/mock-install semgrep/);
    expect(res.extra.tool).toBe("semgrep");
    expect(res.extra.suggested).toBe("mock-install semgrep");
  });

  it("reports ok when binary present", async () => {
    const { checkBinary } = await import("../../src/utils/agent-detect.js");
    checkBinary.mockResolvedValueOnce({ ok: true, version: "1.0.0", path: "/usr/bin/semgrep" });
    const check = findCheck("audit-tool:semgrep");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    expect(res.ok).toBe(true);
    expect(res.detail).toBe("1.0.0");
  });
});

describe("audit-tool lighthouse check — stack gated", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("is a no-op on backend-only stacks", async () => {
    const { detectProjectStack } = await import("../../src/utils/stack-detect.js");
    detectProjectStack.mockResolvedValueOnce({ isBackend: true, isFrontend: false, isFullstack: false });

    const check = findCheck("audit-tool:lighthouse");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    expect(res.ok).toBe(true);
    expect(res.detail).toMatch(/n\/a/);
  });

  it("runs the binary check on frontend stacks", async () => {
    const { detectProjectStack } = await import("../../src/utils/stack-detect.js");
    detectProjectStack.mockResolvedValueOnce({ isFrontend: true, isFullstack: false, isBackend: false });

    const check = findCheck("audit-tool:lighthouse");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    expect(res.ok).toBe(false);
    expect(res.severity).toBe("warn");
    expect(res.fix).toMatch(/lighthouse/);
  });

  it("falls back to backend-treatment if stack detection throws", async () => {
    const { detectProjectStack } = await import("../../src/utils/stack-detect.js");
    detectProjectStack.mockRejectedValueOnce(new Error("boom"));

    const check = findCheck("audit-tool:lighthouse");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    // No frontend stack detected → no-op (ok:true)
    expect(res.ok).toBe(true);
  });
});

describe("audit-tool osv-scanner check", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("uses the suggested command in the fix line", async () => {
    const check = findCheck("audit-tool:osv-scanner");
    const res = await check.detect({ config: { projectDir: "/tmp" } });
    expect(res.fix).toMatch(/mock-install osv-scanner/);
    expect(res.extra.tool).toBe("osv-scanner");
  });
});
