import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  getConfigPath: vi.fn().mockReturnValue("/fake/.karajan/kj.config.yml"),
  getProjectConfigPath: vi.fn().mockReturnValue("/fake/project/.karajan/kj.config.yml"),
  loadConfig: vi.fn(),
  writeConfig: vi.fn()
}));

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn().mockReturnValue("/fake/.karajan"),
  getSessionRoot: vi.fn().mockReturnValue("/fake/.karajan/sessions"),
  getSonarComposePath: vi.fn().mockReturnValue("/fake/.karajan/docker-compose.sonar.yml"),
  getOllamaComposePath: vi.fn().mockReturnValue("/fake/.karajan/docker-compose.ollama.yml")
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  checkVmMaxMapCount: vi.fn().mockResolvedValue({ ok: true })
}));

// KJC-TSK-0436 — keep init under test from spawning real Docker / curl.
vi.mock("../src/rag/ollama-manager.js", () => ({
  ollamaUp: async () => ({ exitCode: 1, stdout: "", stderr: "mocked-skip" }),
  waitForOllamaReady: async () => false,
  normalizeOllamaConfig: () => ({ host: "http://localhost:11434", timeouts: { readyMs: 1000 } }),
}));
vi.mock("../src/rag/ollama-capability.js", () => ({
  checkOllamaCapability: async () => ({ capable: false, reasons: ["docker:not-installed"] }),
  pullOllamaModel: async () => ({ exitCode: 0 }),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error("not found")),
    appendFile: vi.fn().mockResolvedValue(undefined)
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

vi.mock("../src/utils/rtk-detect.js", () => ({
  detectRtk: vi.fn().mockResolvedValue({ available: true, version: "rtk 0.31.0" })
}));

vi.mock("../src/utils/rtk-install.js", () => ({
  installRtk: vi.fn().mockResolvedValue({ ok: true, version: "rtk 0.31.0", error: null })
}));

vi.mock("../src/utils/squeezr-detect.js", () => ({
  detectSqueezr: vi.fn().mockResolvedValue({ available: true, version: "squeezr 1.46.3" })
}));

vi.mock("../src/utils/squeezr-install.js", () => ({
  installSqueezr: vi.fn().mockResolvedValue({ ok: true, version: "squeezr 1.46.3", error: null })
}));

// initCommand runs in the test process cwd (the repo). Mock the harness so it
// never hardens the real working tree during unit tests.
vi.mock("../src/commands/harden.js", () => ({
  hardenCommand: vi.fn().mockResolvedValue({ ok: true })
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

    // Re-set RTK mocks after resetAllMocks clears them
    const { detectRtk } = await import("../src/utils/rtk-detect.js");
    detectRtk.mockResolvedValue({ available: true, version: "rtk 0.31.0" });
    const { installRtk } = await import("../src/utils/rtk-install.js");
    installRtk.mockResolvedValue({ ok: true, version: "rtk 0.31.0", error: null });

    // Re-set Squeezr mocks after resetAllMocks clears them
    const { detectSqueezr } = await import("../src/utils/squeezr-detect.js");
    detectSqueezr.mockResolvedValue({ available: true, version: "squeezr 1.46.3" });
    const { installSqueezr } = await import("../src/utils/squeezr-install.js");
    installSqueezr.mockResolvedValue({ ok: true, version: "squeezr 1.46.3", error: null });
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

  it("installs the quality harness via the shared harden engine", async () => {
    isTTY.mockReturnValue(true);
    loadConfig.mockResolvedValue({
      config: { coder: "claude", reviewer: "codex", roles: { coder: {}, reviewer: {} }, pipeline: {}, sonarqube: { enabled: false }, development: { methodology: "tdd" } },
      exists: false
    });
    const { hardenCommand } = await import("../src/commands/harden.js");
    await initCommand({ logger, flags: { noInteractive: true } });
    expect(hardenCommand).toHaveBeenCalled();
  });

  it("skips the harness with --no-harden", async () => {
    isTTY.mockReturnValue(true);
    loadConfig.mockResolvedValue({
      config: { coder: "claude", reviewer: "codex", roles: { coder: {}, reviewer: {} }, pipeline: {}, sonarqube: { enabled: false }, development: { methodology: "tdd" } },
      exists: false
    });
    const { hardenCommand } = await import("../src/commands/harden.js");
    await initCommand({ logger, flags: { noInteractive: true, harden: false } });
    expect(hardenCommand).not.toHaveBeenCalled();
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
      ask: vi.fn().mockResolvedValue(""),  // branch_prefix only asked if auto_commit
      confirm: vi.fn().mockResolvedValue(false),
      select: vi.fn()
        // KJC-BUG-0087: first run (no global config) no longer asks scope.
        // KJC-TSK-0571: advanced agent routing is off by default (confirm→false),
        // so the 10 per-role provider questions are skipped on a first run.
        .mockResolvedValueOnce("codex")        // coder
        .mockResolvedValueOnce("claude")       // reviewer
        .mockResolvedValueOnce("tdd")          // methodology
        .mockResolvedValueOnce("en")           // pipeline language
        .mockResolvedValueOnce("en"),          // HU language
      close: vi.fn()
    };
    createWizard.mockReturnValue(mockWizard);

    await initCommand({ logger, flags: {} });

    expect(detectAvailableAgents).toHaveBeenCalled();
    // KJC-BUG-0087 + KJC-TSK-0571: no scope question, no per-role questions by
    // default. 2 (agents) + 3 (methodology/pipelineLang/huLang) = 5
    expect(mockWizard.select).toHaveBeenCalledTimes(5);
    // per-role providers stay null (inherit) when advanced routing is declined
    expect(writeConfig.mock.calls[0][1].roles.tester.provider).toBeNull();
    expect(writeConfig).toHaveBeenCalled();
    const writtenConfig = writeConfig.mock.calls[0][1];
    expect(writtenConfig.coder).toBe("codex");
    expect(writtenConfig.reviewer).toBe("claude");
    expect(writtenConfig.language).toBe("en");
    expect(writtenConfig.hu_language).toBe("en");
    // KJC-TSK-0367: per-role providers default to null (inherit at runtime)
    expect(writtenConfig.roles.tester.provider).toBeNull();
    expect(writtenConfig.roles.solomon.provider).toBeNull();
    // git automation defaults to false when user accepts defaults
    expect(writtenConfig.git.auto_commit).toBe(false);
    expect(writtenConfig.git.auto_push).toBe(false);
    expect(writtenConfig.git.auto_pr).toBe(false);
    mockWizard.close();
  });

  it("asks to reconfigure when a config exists at the chosen scope path", async () => {
    isTTY.mockReturnValue(true);
    // KJC-BUG-0087: the prompt now keys off existence AT THE CHOSEN PATH.
    // exists() true means the config file at configPath is present. --global
    // pins the scope so no scope question is asked.
    const { exists } = await import("../src/utils/fs.js");
    exists.mockResolvedValue(true);
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

    await initCommand({ logger, flags: { global: true } });

    expect(mockWizard.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Reconfigure"),
      false
    );
  });

  it("uses single agent for all roles when only one is available but still asks config questions", async () => {
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
      confirm: vi.fn().mockResolvedValue(false),
      select: vi.fn().mockResolvedValue("tdd"),
      close: vi.fn()
    };
    createWizard.mockReturnValue(mockWizard);

    await initCommand({ logger, flags: {} });

    const writtenConfig = writeConfig.mock.calls[0][1];
    expect(writtenConfig.coder).toBe("claude");
    expect(writtenConfig.reviewer).toBe("claude");
    // No agent select calls, but triage/sonar/methodology are still asked
    expect(mockWizard.confirm).toHaveBeenCalledWith(expect.stringContaining("triage"), false);
    expect(mockWizard.confirm).toHaveBeenCalledWith(expect.stringContaining("SonarQube"), true);
    expect(mockWizard.select).toHaveBeenCalledWith(expect.stringContaining("methodology"), expect.any(Array));
  });
});

// =====================================================================
// KJC-TSK-0367 — direct unit tests for the new wizard sub-functions.
// We exercise them via the internal `__test__` export so we don't need
// to drive the whole initCommand pipeline for each scenario.
// =====================================================================
describe("askPerRoleProviders (KJC-TSK-0367)", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function makeBlankConfig() {
    return {
      coder: "claude",
      reviewer: "codex",
      roles: {
        planner: {}, researcher: {}, architect: {}, refactorer: {}, coder: {},
        reviewer: {}, tester: {}, security: {}, solomon: {}, impeccable: {},
        triage: {}, discover: {}, architect2: {}, hu_reviewer: {}, perf: {},
      },
      pipeline: {
        planner: { enabled: false }, researcher: { enabled: false },
        architect: { enabled: false }, refactorer: { enabled: false },
        tester: { enabled: false }, security: { enabled: false },
        solomon: { enabled: false }, impeccable: { enabled: false },
        perf: { enabled: false }, hu_reviewer: { enabled: false },
      },
    };
  }

  it("noop when only one agent is available", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = makeBlankConfig();
    const wizard = { select: vi.fn() };
    await __test__.askPerRoleProviders(wizard, [{ name: "claude" }], config, { coder: "claude", reviewer: "claude" }, logger);
    expect(wizard.select).not.toHaveBeenCalled();
  });

  it("answering '__default__' for every role leaves provider null and enables the pipeline flag", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = makeBlankConfig();
    const wizard = { select: vi.fn().mockResolvedValue("__default__") };

    await __test__.askPerRoleProviders(
      wizard,
      [{ name: "claude" }, { name: "codex" }],
      config,
      { coder: "claude", reviewer: "codex" },
      logger,
    );

    // 10 selects: one per non-coder/non-reviewer role we ask about.
    expect(wizard.select).toHaveBeenCalledTimes(10);
    // Spot-check several roles
    expect(config.roles.tester.provider).toBeNull();
    expect(config.roles.security.provider).toBeNull();
    expect(config.roles.solomon.provider).toBeNull();
    expect(config.pipeline.tester.enabled).toBe(true);
    expect(config.pipeline.solomon.enabled).toBe(true);
  });

  it("answering '__disabled__' on a disable-allowed role flips its pipeline flag off", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = makeBlankConfig();
    config.pipeline.researcher.enabled = true;  // pretend it was on
    const wizard = {
      select: vi.fn(),
    };
    // PER_ROLE_QUESTIONS: planner(disable-allowed), researcher(disable-allowed), architect, tester(no-disable), ...
    // Rather than tracking exact order, return __disabled__ first time, __default__ otherwise.
    let call = 0;
    wizard.select.mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? "__disabled__" : "__default__");
    });

    await __test__.askPerRoleProviders(
      wizard,
      [{ name: "claude" }, { name: "codex" }],
      config,
      { coder: "claude", reviewer: "codex" },
      logger,
    );

    // First role asked is planner — should now be disabled.
    expect(config.pipeline.planner.enabled).toBe(false);
  });

  it("answering with an explicit CLI name persists provider correctly", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = makeBlankConfig();
    const wizard = {
      select: vi.fn().mockResolvedValue("gemini"),
    };

    await __test__.askPerRoleProviders(
      wizard,
      [{ name: "claude" }, { name: "codex" }, { name: "gemini" }],
      config,
      { coder: "claude", reviewer: "codex" },
      logger,
    );

    expect(config.roles.tester.provider).toBe("gemini");
    expect(config.roles.solomon.provider).toBe("gemini");
  });
});

describe("askGitAutomation (KJC-TSK-0367)", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it("persists three booleans + branch_prefix when auto_commit is on", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = {};
    const wizard = {
      confirm: vi.fn()
        .mockResolvedValueOnce(true)   // auto_commit
        .mockResolvedValueOnce(true)   // auto_push
        .mockResolvedValueOnce(false), // auto_pr
      ask: vi.fn().mockResolvedValue("kj/"),
    };

    await __test__.askGitAutomation(wizard, config, logger);

    expect(config.git.auto_commit).toBe(true);
    expect(config.git.auto_push).toBe(true);
    expect(config.git.auto_pr).toBe(false);
    expect(config.git.branch_prefix).toBe("kj/");
  });

  it("skips branch_prefix when auto_commit is off", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = {};
    const wizard = {
      confirm: vi.fn().mockResolvedValue(false),
      ask: vi.fn(),
    };

    await __test__.askGitAutomation(wizard, config, logger);

    expect(config.git.auto_commit).toBe(false);
    expect(wizard.ask).not.toHaveBeenCalled();
    expect(config.git.branch_prefix).toBeUndefined();
  });

  it("falls back to feat/ when user submits an empty branch prefix", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = {};
    const wizard = {
      confirm: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
      ask: vi.fn().mockResolvedValue(""),  // empty input → default
    };

    await __test__.askGitAutomation(wizard, config, logger);

    expect(config.git.branch_prefix).toBe("feat/");
  });
});

describe("askBoardSecurity (KJC-TSK-0367)", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  it("noop when HU board is disabled", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = { hu_board: { enabled: false } };
    const wizard = { select: vi.fn(), ask: vi.fn() };

    await __test__.askBoardSecurity(wizard, config, logger);

    expect(wizard.select).not.toHaveBeenCalled();
    expect(wizard.ask).not.toHaveBeenCalled();
  });

  it("default loopback bind + default port", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = { hu_board: { enabled: true } };
    const wizard = {
      select: vi.fn().mockResolvedValue("127.0.0.1"),
      ask: vi.fn().mockResolvedValue(""),  // empty port → default
    };

    await __test__.askBoardSecurity(wizard, config, logger);

    expect(config.hu_board.bind).toBe("127.0.0.1");
    expect(config.hu_board.port).toBe(4000);
  });

  it("LAN bind + custom port", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = { hu_board: { enabled: true } };
    const wizard = {
      select: vi.fn().mockResolvedValue("0.0.0.0"),
      ask: vi.fn().mockResolvedValue("5050"),
    };

    await __test__.askBoardSecurity(wizard, config, logger);

    expect(config.hu_board.bind).toBe("0.0.0.0");
    expect(config.hu_board.port).toBe(5050);
  });

  it("falls back to 4000 when user provides invalid port", async () => {
    const { __test__ } = await import("../src/commands/init.js");
    const config = { hu_board: { enabled: true } };
    const wizard = {
      select: vi.fn().mockResolvedValue("127.0.0.1"),
      ask: vi.fn().mockResolvedValue("not-a-number"),
    };

    await __test__.askBoardSecurity(wizard, config, logger);

    expect(config.hu_board.port).toBe(4000);
  });
});

// =====================================================================
// KJC-BUG-0034 / KJC-BUG-0036 — `writeInitConfig` is now a thin alias
// for `writeConfig`. The actual stripping of runtime-only keys
// (sonarqube.enabled + the loader-synthesised `_deprecated` block)
// lives inside `writeConfig` so EVERY caller benefits, not just init.
// The end-to-end strip behaviour is exercised in
// tests/config-loader-strip.test.js against the real writer.
//
// This block stays here as a contract-level test: writeInitConfig must
// delegate to writeConfig with the same arguments, and must NOT mutate
// the caller's config object.
// =====================================================================
describe("writeInitConfig — delegates to writeConfig (KJC-BUG-0034 / 0036)", () => {
  let writeInitConfig;
  let writeConfig;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ writeConfig } = await import("../src/config.js"));
    ({ writeInitConfig } = await import("../src/commands/init.js"));
  });

  it("forwards path + config to writeConfig untouched", async () => {
    const config = {
      coder: "claude",
      sonarqube: { enabled: true, host: "http://localhost:9000", token: "abc" },
    };
    await writeInitConfig("/tmp/kj.config.yml", config);
    expect(writeConfig).toHaveBeenCalledTimes(1);
    expect(writeConfig).toHaveBeenCalledWith("/tmp/kj.config.yml", config);
  });

  it("does not mutate the caller's config object (purity)", async () => {
    const config = { sonarqube: { enabled: false, host: "http://localhost:9000" } };
    await writeInitConfig("/tmp/kj.config.yml", config);
    expect(config.sonarqube.enabled).toBe(false);
    expect(config.sonarqube.host).toBe("http://localhost:9000");
  });
});

describe("resolveConfigScope (KJC-BUG-0087)", () => {
  let resolveConfigScope, exists, createWizard;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ resolveConfigScope } = await import("../src/commands/init.js"));
    ({ exists } = await import("../src/utils/fs.js"));
    ({ createWizard } = await import("../src/utils/wizard.js"));
  });

  it("honours explicit --global / --local without asking", async () => {
    expect((await resolveConfigScope({ flags: { global: true }, interactive: true })).scope).toBe("global");
    expect((await resolveConfigScope({ flags: { local: true }, interactive: true })).scope).toBe("local");
    expect(createWizard).not.toHaveBeenCalled();
  });

  it("on a true first run (no global config) defaults to global WITHOUT a cold question", async () => {
    exists.mockResolvedValue(false); // no global config yet
    const res = await resolveConfigScope({ flags: {}, interactive: true });
    expect(res.scope).toBe("global");
    expect(createWizard).not.toHaveBeenCalled();
  });

  it("only asks the scope question when a global config already exists", async () => {
    exists.mockResolvedValue(true); // global exists → override-for-this-project is a real choice
    const select = vi.fn().mockResolvedValue("local");
    createWizard.mockReturnValue({ select, close: vi.fn() });
    const res = await resolveConfigScope({ flags: {}, interactive: true });
    expect(createWizard).toHaveBeenCalled();
    expect(res.scope).toBe("local");
  });
});

describe("askPerRoleProviders advanced gate (KJC-TSK-0571)", () => {
  let askPerRoleProviders;
  const logger = { info: vi.fn() };
  const available = [
    { name: "claude", available: true },
    { name: "codex", available: true },
  ];

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ askPerRoleProviders } = (await import("../src/commands/init.js")).__test__);
  });

  it("ask=false initialises roles to inherit (provider null) WITHOUT asking", async () => {
    const wizard = { select: vi.fn() };
    const config = {};
    await askPerRoleProviders(wizard, available, config, { coder: "claude", reviewer: "codex" }, logger, false);
    expect(wizard.select).not.toHaveBeenCalled();
    expect(config.roles.tester.provider).toBeNull();
    expect(config.roles.architect.provider).toBeNull();
  });

  it("ask=true asks one question per role", async () => {
    const wizard = { select: vi.fn().mockResolvedValue("__default__") };
    const config = {};
    await askPerRoleProviders(wizard, available, config, { coder: "claude", reviewer: "codex" }, logger, true);
    expect(wizard.select).toHaveBeenCalledTimes(10);
  });
});
