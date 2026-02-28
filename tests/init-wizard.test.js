import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  getConfigPath: vi.fn().mockReturnValue("/fake/.karajan/kj.config.yml"),
  loadConfig: vi.fn(),
  writeConfig: vi.fn()
}));

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn().mockReturnValue("/fake/.karajan"),
  getSessionRoot: vi.fn().mockReturnValue("/fake/.karajan/sessions")
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  checkVmMaxMapCount: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error("not found"))
  }
}));

vi.mock("../src/utils/agent-detect.js", () => ({
  detectAvailableAgents: vi.fn(),
  checkBinary: vi.fn(),
  KNOWN_AGENTS: [
    { name: "claude", install: "npm i -g @anthropic-ai/claude-code" },
    { name: "codex", install: "npm i -g @openai/codex" }
  ]
}));

vi.mock("../src/utils/wizard.js", () => ({
  createWizard: vi.fn(),
  isTTY: vi.fn()
}));

describe("initCommand", () => {
  let initCommand;
  let loadConfig, writeConfig;
  let detectAvailableAgents;
  let createWizard, isTTY;

  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ loadConfig, writeConfig } = await import("../src/config.js"));
    ({ detectAvailableAgents } = await import("../src/utils/agent-detect.js"));
    ({ createWizard, isTTY } = await import("../src/utils/wizard.js"));
    ({ initCommand } = await import("../src/commands/init.js"));
  });

  it("runs non-interactive mode when --no-interactive is set", async () => {
    isTTY.mockReturnValue(true);
    loadConfig.mockResolvedValue({
      config: {
        coder: "claude",
        reviewer: "codex",
        roles: { coder: {}, reviewer: {} },
        pipeline: {},
        sonarqube: { enabled: false },
        development: { methodology: "tdd" }
      },
      exists: false
    });

    await initCommand({ logger, flags: { noInteractive: true } });

    expect(writeConfig).toHaveBeenCalled();
    expect(createWizard).not.toHaveBeenCalled();
  });

  it("runs non-interactive mode when stdin is not a TTY", async () => {
    isTTY.mockReturnValue(false);
    loadConfig.mockResolvedValue({
      config: {
        coder: "claude",
        reviewer: "codex",
        roles: { coder: {}, reviewer: {} },
        pipeline: {},
        sonarqube: { enabled: false },
        development: { methodology: "tdd" }
      },
      exists: false
    });

    await initCommand({ logger, flags: {} });

    expect(writeConfig).toHaveBeenCalled();
    expect(createWizard).not.toHaveBeenCalled();
  });

  it("runs wizard when interactive and config does not exist", async () => {
    isTTY.mockReturnValue(true);
    const mockConfig = {
      coder: "claude",
      reviewer: "codex",
      roles: { coder: { provider: null }, reviewer: { provider: null } },
      pipeline: { triage: {} },
      sonarqube: { enabled: true },
      development: { methodology: "tdd", require_test_changes: true }
    };
    loadConfig.mockResolvedValue({ config: mockConfig, exists: false });

    detectAvailableAgents.mockResolvedValue([
      { name: "claude", available: true, version: "2.0.0", install: "" },
      { name: "codex", available: true, version: "1.0.0", install: "" }
    ]);

    const mockWizard = {
      ask: vi.fn(),
      confirm: vi.fn().mockResolvedValue(false),
      select: vi.fn()
        .mockResolvedValueOnce("codex")  // coder
        .mockResolvedValueOnce("claude") // reviewer
        .mockResolvedValueOnce("tdd"),   // methodology
      close: vi.fn()
    };
    createWizard.mockReturnValue(mockWizard);

    await initCommand({ logger, flags: {} });

    expect(detectAvailableAgents).toHaveBeenCalled();
    expect(mockWizard.select).toHaveBeenCalledTimes(3);
    expect(writeConfig).toHaveBeenCalled();
    const writtenConfig = writeConfig.mock.calls[0][1];
    expect(writtenConfig.coder).toBe("codex");
    expect(writtenConfig.reviewer).toBe("claude");
    mockWizard.close();
  });

  it("asks to reconfigure when config already exists", async () => {
    isTTY.mockReturnValue(true);
    loadConfig.mockResolvedValue({
      config: {
        coder: "claude",
        reviewer: "codex",
        roles: { coder: {}, reviewer: {} },
        pipeline: {},
        sonarqube: { enabled: false },
        development: { methodology: "tdd" }
      },
      exists: true
    });

    const mockWizard = {
      ask: vi.fn(),
      confirm: vi.fn().mockResolvedValue(false),
      select: vi.fn(),
      close: vi.fn()
    };
    createWizard.mockReturnValue(mockWizard);

    await initCommand({ logger, flags: {} });

    expect(mockWizard.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Reconfigure"),
      false
    );
  });

  it("uses single agent for all roles when only one is available", async () => {
    isTTY.mockReturnValue(true);
    loadConfig.mockResolvedValue({
      config: {
        coder: "claude",
        reviewer: "codex",
        roles: { coder: { provider: null }, reviewer: { provider: null } },
        pipeline: { triage: {} },
        sonarqube: { enabled: false },
        development: { methodology: "tdd" }
      },
      exists: false
    });

    detectAvailableAgents.mockResolvedValue([
      { name: "claude", available: true, version: "2.0.0", install: "" },
      { name: "codex", available: false, version: null, install: "npm i codex" }
    ]);

    const mockWizard = {
      ask: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      close: vi.fn()
    };
    createWizard.mockReturnValue(mockWizard);

    await initCommand({ logger, flags: {} });

    const writtenConfig = writeConfig.mock.calls[0][1];
    expect(writtenConfig.coder).toBe("claude");
    expect(writtenConfig.reviewer).toBe("claude");
    // No select calls needed when only one agent
    expect(mockWizard.select).not.toHaveBeenCalled();
  });
});
