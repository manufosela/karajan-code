import { describe, it, expect, vi, beforeEach } from "vitest";

// KJC-TSK v2.18 — `kj install-tools` command.

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(async () => ({ ok: false, version: null, path: null })),
}));

vi.mock("../../src/utils/install-hints.js", () => ({
  detectPackageManagers: vi.fn(async () => ({
    pipx: true, brew: false, go: false, npm: true, pip: false, apt: false, dnf: false, choco: false, scoop: false, docker: true,
  })),
  getInstallHint: vi.fn(async (tool) => {
    const mapping = {
      semgrep: { command: "pipx install semgrep", manager: "pipx", manualUrl: "https://semgrep.dev" },
      "osv-scanner": { command: null, manager: null, manualUrl: "https://google.github.io/osv-scanner" },
      lighthouse: { command: "npm install -g lighthouse", manager: "npm", manualUrl: "https://lighthouse" },
    };
    return mapping[tool] || { command: null, manager: null, manualUrl: "x" };
  }),
  appliesToStack: vi.fn((tool, stack) => {
    if (tool === "lighthouse") return Boolean(stack?.isFrontend || stack?.isFullstack);
    return true;
  }),
}));

vi.mock("../../src/utils/stack-detect.js", () => ({
  detectProjectStack: vi.fn(async () => ({ isBackend: true, isFrontend: false, isFullstack: false })),
}));

vi.mock("../../src/utils/tool-installer.js", () => ({
  downloadBinary: vi.fn(async ({ name }) => ({ ok: true, dest: `/home/u/.local/bin/${name}` })),
  binDir: vi.fn(() => "/home/u/.local/bin"),
}));

// Skip child_process exec entirely for these tests — we never want to
// actually install anything during the test run.
vi.mock("node:child_process", async (orig) => {
  const real = await orig();
  return {
    ...real,
    execFile: vi.fn((bin, args, _opts, cb) => {
      // sonar's checkSonarRunning uses execFile("docker", ["ps"...]) — return empty
      // so we treat sonar as not running and runInstall fails cleanly.
      if (cb) cb(new Error("mocked execFile failure"), { stdout: "", stderr: "" });
      return { unref: () => {} };
    }),
  };
});

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("kj install-tools — dry-run", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("plans installs without running anything (semgrep + osv-scanner + docker + sonar; lighthouse skipped on backend stack)", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { results, exitCode } = await installToolsCommand({ dryRun: true, logger: silentLogger });

    expect(exitCode).toBe(0);
    expect(results.find((r) => r.tool === "semgrep").action).toBe("dry-run");
    expect(results.find((r) => r.tool === "semgrep").command).toBe("pipx install semgrep");
    // osv-scanner has no package manager here, but a static-binary route exists.
    expect(results.find((r) => r.tool === "osv-scanner").action).toBe("dry-run");
    expect(results.find((r) => r.tool === "lighthouse").action).toBe("skipped");
    expect(results.find((r) => r.tool === "docker").action).toBe("manual");
    expect(results.find((r) => r.tool === "sonar").action).toBe("dry-run");
  });

  it("--only semgrep limits the run to one tool", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { results } = await installToolsCommand({ dryRun: true, only: "semgrep", logger: silentLogger });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("semgrep");
  });

  it("--only lighthouse bypasses stack gating", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { results } = await installToolsCommand({ dryRun: true, only: "lighthouse", logger: silentLogger });
    expect(results).toHaveLength(1);
    expect(results[0].tool).toBe("lighthouse");
    // With explicit --only, we should NOT skip even on backend stacks.
    expect(results[0].action).not.toBe("skipped");
  });

  it("rejects unknown tools in --only", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    await expect(installToolsCommand({ only: "ghost-tool", logger: silentLogger })).rejects.toThrow(/ghost-tool/);
  });

  it("skips tools that are already installed", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { checkBinary } = await import("../../src/utils/agent-detect.js");
    checkBinary.mockResolvedValueOnce({ ok: true, version: "1.0.0", path: "/usr/bin/semgrep" });
    const { results } = await installToolsCommand({ dryRun: true, only: "semgrep", logger: silentLogger });
    expect(results[0].action).toBe("already-installed");
  });

  it("offers osv-scanner via static binary when no package manager is available", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { results } = await installToolsCommand({ dryRun: true, only: "osv-scanner", logger: silentLogger });
    expect(results[0].action).toBe("dry-run");
    expect(results[0].via).toBe("binary");
    expect(results[0].command).toMatch(/osv-scanner_/);
  });

  it("downloads the osv-scanner binary when accepted (yes)", async () => {
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { downloadBinary } = await import("../../src/utils/tool-installer.js");
    const { results } = await installToolsCommand({ yes: true, only: "osv-scanner", logger: silentLogger });
    expect(downloadBinary).toHaveBeenCalledOnce();
    expect(results[0].action).toBe("installed");
    expect(results[0].via).toBe("binary");
  });
});

describe("kj install-tools — stack-aware lighthouse", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does NOT skip lighthouse on frontend stacks", async () => {
    const { detectProjectStack } = await import("../../src/utils/stack-detect.js");
    detectProjectStack.mockResolvedValueOnce({ isFrontend: true, isFullstack: false, isBackend: false });
    const { installToolsCommand } = await import("../../src/commands/install-tools.js");
    const { results } = await installToolsCommand({ dryRun: true, logger: silentLogger });
    const lh = results.find((r) => r.tool === "lighthouse");
    expect(lh.action).toBe("dry-run");
    expect(lh.command).toBe("npm install -g lighthouse");
  });
});

describe("parseOnlyList", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("accepts a comma-separated subset of valid tools", async () => {
    const { __test } = await import("../../src/commands/install-tools.js");
    expect(__test.parseOnlyList("semgrep,osv-scanner")).toEqual(["semgrep", "osv-scanner"]);
  });

  it("returns null when input is empty / undefined", async () => {
    const { __test } = await import("../../src/commands/install-tools.js");
    expect(__test.parseOnlyList(undefined)).toBeNull();
    expect(__test.parseOnlyList("")).toBeNull();
  });

  it("throws on unknown tool name", async () => {
    const { __test } = await import("../../src/commands/install-tools.js");
    expect(() => __test.parseOnlyList("foo,semgrep")).toThrow(/Unknown tool/);
  });
});
