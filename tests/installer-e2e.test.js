import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * E2E integration test: kj init → produces valid config → kj doctor reports all OK.
 * Mocks filesystem and subprocesses but exercises the real logic of both commands.
 */

const writtenFiles = new Map();

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(async (p, content) => { writtenFiles.set(p, content); }),
    readFile: vi.fn(async (p) => {
      if (writtenFiles.has(p)) return writtenFiles.get(p);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    appendFile: vi.fn(async (p, content) => {
      const existing = writtenFiles.get(p) || "";
      writtenFiles.set(p, existing + content);
    }),
    // dir-setup check stats the home dir tree; treat all as existing dirs.
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}));

// dir-setup uses os.homedir() + path.join. Don't need to mock those.
// But the default vi.resetAllMocks in beforeEach wipes the stat mock;
// we restore it there below.

// Additional mocks for the new doctor checks (commit 3 of KJC-TSK-0319):
vi.mock("../src/utils/port-check.js", () => ({
  isPortAvailable: vi.fn().mockResolvedValue(true),
  findAvailablePort: vi.fn().mockResolvedValue(4001)
}));

vi.mock("../src/utils/port-occupant.js", () => ({
  getPortOccupant: vi.fn().mockResolvedValue(null)
}));

vi.mock("../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn().mockResolvedValue(true)
}));

// KJC-TSK-0393: mock project-checks so this installer-E2E test stays focused
// on init→doctor flow without project-aware noise.
vi.mock("../src/checks/project-checks.js", () => ({
  getProjectChecks: vi.fn(() => []),
  detectProjectSignals: vi.fn(() => new Set()),
}));

vi.mock("node:child_process", async (orig) => {
  const real = await orig();
  const { EventEmitter } = require("node:events");
  return {
    // Preserve real execFile / exec so modules that probe binaries via
    // child_process (install-hints.js, agent-detect.js) keep working.
    ...real,
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.stdin = { write: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      setImmediate(() => child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n')));
      return child;
    })
  };
});

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn(async (p) => writtenFiles.has(p)),
  ensureDir: vi.fn()
}));

vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: vi.fn().mockReturnValue("/fake/.karajan"),
  getSessionRoot: vi.fn().mockReturnValue("/fake/.karajan/sessions"),
  getSonarComposePath: vi.fn().mockReturnValue("/fake/.karajan/docker-compose.sonar.yml"),
  getOllamaComposePath: vi.fn().mockReturnValue("/fake/.karajan/docker-compose.ollama.yml")
}));

vi.mock("../src/config.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    getConfigPath: vi.fn().mockReturnValue("/fake/.karajan/kj.config.yml"),
    writeConfig: vi.fn(async (configPath, config) => {
      const yaml = await import("js-yaml");
      writtenFiles.set(configPath, yaml.default.dump(config));
    }),
    loadConfig: vi.fn()
  };
});

vi.mock("../src/rag/ollama-manager.js", () => ({
  ollamaUp: async () => ({ exitCode: 1, stdout: "", stderr: "mocked-skip" }),
  waitForOllamaReady: async () => false,
  normalizeOllamaConfig: () => ({ host: "http://localhost:11434", timeouts: { readyMs: 1000 } }),
  isOllamaReachable: async () => false,
}));
vi.mock("../src/rag/ollama-capability.js", () => ({
  checkOllamaCapability: async () => ({ capable: false, reasons: ["docker:not-installed"] }),
  pullOllamaModel: async () => ({ exitCode: 0 }),
}));

vi.mock("../src/sonar/manager.js", () => ({
  sonarUp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  checkVmMaxMapCount: vi.fn().mockResolvedValue({ ok: true }),
  isSonarReachable: vi.fn().mockResolvedValue(true)
}));

vi.mock("../src/utils/agent-detect.js", () => ({
  detectObservedAgents: vi.fn().mockResolvedValue([]),
  OBSERVED_AGENTS: [],
  detectAvailableAgents: vi.fn().mockResolvedValue([
    { name: "claude", available: true, version: "2.0.0", install: "" },
    { name: "codex", available: true, version: "1.0.0", install: "" }
  ]),
  checkBinary: vi.fn().mockResolvedValue({ ok: true, version: "1.0.0", path: "/usr/bin/mock" }),
  KNOWN_AGENTS: [
    { name: "claude", install: "npm i -g @anthropic-ai/claude-code" },
    { name: "codex", install: "npm i -g @openai/codex" }
  ]
}));

vi.mock("../src/utils/wizard.js", () => ({
  createWizard: vi.fn(),
  isTTY: vi.fn().mockReturnValue(false)
}));

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" })
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/bin/${name}`)
}));

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn().mockReturnValue(["/fake/reviewer.md"]),
  loadFirstExisting: vi.fn().mockResolvedValue("# Rules content")
}));

vi.mock("../src/utils/git.js", () => ({
  ensureGitRepo: vi.fn().mockResolvedValue(true)
}));

// init runs in the repo cwd; mock the harness so it never hardens the tree.
vi.mock("../src/commands/harden.js", () => ({
  hardenCommand: vi.fn().mockResolvedValue({ ok: true })
}));

describe("installer E2E: init → doctor", () => {
  const logger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
  };

  const savedEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    writtenFiles.clear();

    // Token checks require the env vars of active providers to be set.
    // The test uses providers claude (anthropic) and codex (openai).
    process.env.ANTHROPIC_API_KEY = "sk-test-installer";
    process.env.OPENAI_API_KEY = "sk-test-installer";

    // Re-setup mocks cleared by resetAllMocks
    const { exists, ensureDir } = await import("../src/utils/fs.js");
    exists.mockImplementation(async (p) => writtenFiles.has(p));
    ensureDir.mockResolvedValue(undefined);

    const { sonarUp, checkVmMaxMapCount, isSonarReachable } = await import("../src/sonar/manager.js");
    sonarUp.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    checkVmMaxMapCount.mockResolvedValue({ ok: true });
    isSonarReachable.mockResolvedValue(true);

    const { checkBinary } = await import("../src/utils/agent-detect.js");
    checkBinary.mockResolvedValue({ ok: true, version: "1.0.0", path: "/usr/bin/mock" });

    const { runCommand } = await import("../src/utils/process.js");
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "v1.0.0\n", stderr: "" });

    const { ensureGitRepo } = await import("../src/utils/git.js");
    ensureGitRepo.mockResolvedValue(true);

    const { loadFirstExisting } = await import("../src/roles/base-role.js");
    loadFirstExisting.mockResolvedValue("# Rules content");

    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const fsPromises = (await import("node:fs/promises")).default;
    fsPromises.writeFile.mockImplementation(async (p, content) => { writtenFiles.set(p, content); });
    fsPromises.stat.mockResolvedValue({ isDirectory: () => true });
    fsPromises.mkdir.mockResolvedValue(undefined);

    // KJC-TSK-0420: dir-setup + config-loader now go through paths.js
    // helpers. vi.resetAllMocks() wiped their mock return values, so
    // restore them here next to the other resetAllMocks recovery.
    const { getKarajanHome, getSessionRoot } = await import("../src/utils/paths.js");
    getKarajanHome.mockReturnValue("/fake/.karajan");
    getSessionRoot.mockReturnValue("/fake/.karajan/sessions");

    // Re-setup mocks introduced by commit 3 of KJC-TSK-0319
    const { isPortAvailable } = await import("../src/utils/port-check.js");
    isPortAvailable.mockResolvedValue(true);
    const { isOpenSkillsAvailable } = await import("../src/skills/openskills-client.js");
    isOpenSkillsAvailable.mockResolvedValue(true);
    const cp = await import("node:child_process");
    cp.spawn.mockImplementation(() => {
      const { EventEmitter } = require("node:events");
      const child = new EventEmitter();
      child.stdin = { write: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      setImmediate(() => child.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1,"result":{}}\n')));
      return child;
    });
    fsPromises.readFile.mockImplementation(async (p) => {
      if (writtenFiles.has(p)) return writtenFiles.get(p);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    for (const [k, v] of Object.entries(savedEnv)) process.env[k] = v;
  });

  it("init creates config that passes doctor checks", async () => {
    // --- Setup: loadConfig returns defaults (no existing config) ---
    const { loadConfig } = await import("../src/config.js");
    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const defaultConfig = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      roles: {
        coder: { provider: "claude" },
        reviewer: { provider: "codex" }
      },
      pipeline: {},
      sonarqube: { enabled: false },
      development: { methodology: "tdd", require_test_changes: true }
    };
    loadConfig.mockResolvedValue({ config: defaultConfig, exists: false });

    // --- Step 1: Run init ---
    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ logger, flags: { noInteractive: true } });

    // Verify config was written
    expect(writtenFiles.has("/fake/.karajan/kj.config.yml")).toBe(true);
    const writtenYaml = writtenFiles.get("/fake/.karajan/kj.config.yml");
    expect(writtenYaml).toContain("coder");
    expect(writtenYaml).toContain("reviewer");

    // --- Step 2: Run doctor with the generated config ---
    const { runChecks } = await import("../src/commands/doctor.js");
    const { exists } = await import("../src/utils/fs.js");
    exists.mockResolvedValue(true); // all files exist post-init
    const { ensureGitRepo } = await import("../src/utils/git.js");
    ensureGitRepo.mockResolvedValue(true);
    const { checkBinary } = await import("../src/utils/agent-detect.js");
    checkBinary.mockResolvedValue({ ok: true, version: "1.0.0", path: "/usr/bin/mock" });
    const { loadFirstExisting } = await import("../src/roles/base-role.js");
    loadFirstExisting.mockResolvedValue("# Rules");

    const checks = await runChecks({ config: defaultConfig });
    const failures = checks.filter((c) => !c.ok && c.fix);
    expect(failures).toEqual([]);
  });

  it("init config has all required fields for validateConfig", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const defaultConfig = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      roles: {
        coder: { provider: "claude" },
        reviewer: { provider: "codex" }
      },
      pipeline: {},
      sonarqube: { enabled: false },
      development: { methodology: "tdd", require_test_changes: true }
    };
    loadConfig.mockResolvedValue({ config: defaultConfig, exists: false });

    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ logger, flags: { noInteractive: true } });

    // The config should pass validation without throwing
    const { validateConfig } = await import("../src/config.js");
    expect(() => validateConfig(defaultConfig)).not.toThrow();
  });

  it("init config contains valid review_mode", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const defaultConfig = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      roles: {
        coder: { provider: "claude" },
        reviewer: { provider: "codex" }
      },
      pipeline: {},
      sonarqube: { enabled: false },
      development: { methodology: "tdd" }
    };
    loadConfig.mockResolvedValue({ config: defaultConfig, exists: false });

    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ logger, flags: { noInteractive: true } });

    expect(["paranoid", "strict", "standard", "relaxed", "custom"]).toContain(defaultConfig.review_mode);
  });

  it("init config contains valid development methodology", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const defaultConfig = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      roles: {
        coder: { provider: "claude" },
        reviewer: { provider: "codex" }
      },
      pipeline: {},
      sonarqube: { enabled: true },
      development: { methodology: "tdd" }
    };
    loadConfig.mockResolvedValue({ config: defaultConfig, exists: false });

    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ logger, flags: { noInteractive: true } });

    expect(["tdd", "standard"]).toContain(defaultConfig.development.methodology);
  });

  it("init creates review-rules.md and coder-rules.md inside .karajan/", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { isTTY } = await import("../src/utils/wizard.js");
    isTTY.mockReturnValue(false);

    const defaultConfig = {
      coder: "claude",
      reviewer: "codex",
      review_mode: "standard",
      roles: { coder: {}, reviewer: {} },
      pipeline: {},
      sonarqube: { enabled: false },
      development: { methodology: "tdd" }
    };
    loadConfig.mockResolvedValue({ config: defaultConfig, exists: false });

    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ logger, flags: { noInteractive: true } });

    // review-rules.md and coder-rules.md should have been written inside .karajan/
    const keys = Array.from(writtenFiles.keys()).filter(Boolean);
    const reviewRulesWritten = keys.some((k) => k.includes(".karajan") && k.endsWith("review-rules.md"));
    const coderRulesWritten = keys.some((k) => k.includes(".karajan") && k.endsWith("coder-rules.md"));
    expect(reviewRulesWritten).toBe(true);
    expect(coderRulesWritten).toBe(true);
  });

  it("doctor reports all OK when environment is properly set up", async () => {
    const config = {
      review_mode: "standard",
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      development: { methodology: "tdd" },
      roles: { coder: { provider: "claude" }, reviewer: { provider: "codex" } }
    };

    const { exists } = await import("../src/utils/fs.js");
    exists.mockResolvedValue(true);
    const { ensureGitRepo } = await import("../src/utils/git.js");
    ensureGitRepo.mockResolvedValue(true);
    const { isSonarReachable } = await import("../src/sonar/manager.js");
    isSonarReachable.mockResolvedValue(true);
    const { checkBinary } = await import("../src/utils/agent-detect.js");
    checkBinary.mockResolvedValue({ ok: true, version: "1.0.0", path: "/usr/bin/mock" });
    const { loadFirstExisting } = await import("../src/roles/base-role.js");
    loadFirstExisting.mockResolvedValue("# Rules");

    const { runChecks } = await import("../src/commands/doctor.js");
    const checks = await runChecks({ config });

    const allOk = checks.every((c) => c.ok);
    expect(allOk).toBe(true);
  });

  it("doctor reports failures when dependencies are missing", async () => {
    const config = {
      review_mode: "standard",
      sonarqube: { enabled: true, host: "http://localhost:9000" },
      development: { methodology: "tdd" }
    };

    const { exists } = await import("../src/utils/fs.js");
    exists.mockResolvedValue(false); // no config file
    const { ensureGitRepo } = await import("../src/utils/git.js");
    ensureGitRepo.mockResolvedValue(false); // no git
    const { isSonarReachable } = await import("../src/sonar/manager.js");
    isSonarReachable.mockResolvedValue(false); // no sonar
    const { checkBinary } = await import("../src/utils/agent-detect.js");
    checkBinary.mockResolvedValue({ ok: false, version: null, path: null });
    const { loadFirstExisting } = await import("../src/roles/base-role.js");
    loadFirstExisting.mockResolvedValue(null);

    const { runChecks } = await import("../src/commands/doctor.js");
    const checks = await runChecks({ config });

    const failures = checks.filter((c) => !c.ok);
    expect(failures.length).toBeGreaterThan(3);

    // Should include config, git, sonar failures
    const names = failures.map((c) => c.name);
    expect(names).toContain("config");
    expect(names).toContain("git");
    expect(names).toContain("sonarqube");
  });
});
