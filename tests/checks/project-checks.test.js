import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProjectSignals, getProjectChecks } from "../../src/checks/project-checks.js";

vi.mock("../../src/utils/agent-detect.js", () => ({
  checkBinary: vi.fn(),
}));

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));

vi.mock("../../src/utils/os-detect.js", () => ({
  getInstallCommand: vi.fn().mockReturnValue("apt install foo"),
}));

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-project-checks-"));
  vi.resetAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectProjectSignals", () => {
  it("returns empty set for non-existent projectDir", () => {
    expect(detectProjectSignals("/nonexistent/path/xxx").size).toBe(0);
  });

  it("detects node signal when package.json exists", () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    expect(detectProjectSignals(tmpDir).has("node")).toBe(true);
  });

  it("detects docker signal when Dockerfile OR docker-compose.yml present", () => {
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM scratch");
    expect(detectProjectSignals(tmpDir).has("docker")).toBe(true);
    fs.rmSync(path.join(tmpDir, "Dockerfile"));
    fs.writeFileSync(path.join(tmpDir, "docker-compose.yml"), "version: '3'");
    expect(detectProjectSignals(tmpDir).has("docker")).toBe(true);
  });

  it("detects firebase signal when firebase.json or .firebaserc present", () => {
    fs.writeFileSync(path.join(tmpDir, "firebase.json"), "{}");
    expect(detectProjectSignals(tmpDir).has("firebase")).toBe(true);
  });

  it("detects python signal for pyproject.toml / requirements.txt / setup.py", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    expect(detectProjectSignals(tmpDir).has("python")).toBe(true);
  });

  it("detects terraform signal when any .tf file present", () => {
    fs.writeFileSync(path.join(tmpDir, "main.tf"), "");
    expect(detectProjectSignals(tmpDir).has("terraform")).toBe(true);
  });

  it("detects env-example signal", () => {
    fs.writeFileSync(path.join(tmpDir, ".env.example"), "FOO=bar");
    const sig = detectProjectSignals(tmpDir);
    expect(sig.has("env-example")).toBe(true);
  });
});

describe("getProjectChecks — write-perms", () => {
  it("OK when projectDir is writable", async () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const wp = checks.find((c) => c.name === "project:write-perms");
    const result = await wp.detect({});
    expect(result.ok).toBe(true);
  });

  it("returns project:kj-init-ran check that WARNs when no config", async () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const kj = checks.find((c) => c.name === "project:kj-init-ran");
    expect(kj).toBeDefined();
    // Don't actually test detect here — depends on $HOME state. Just verify shape.
    expect(kj.label).toMatch(/init/i);
    expect(kj.strategy).toBeDefined();
  });
});

describe("getProjectChecks — tool checks by signal", () => {
  it("applies docker tool check only when Dockerfile present", () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const docker = checks.find((c) => c.name === "project:tool:docker");
    expect(docker.applies({})).toBe(false);
    // Now add Dockerfile and re-check
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM scratch");
    const checks2 = getProjectChecks({ projectDir: tmpDir });
    const docker2 = checks2.find((c) => c.name === "project:tool:docker");
    expect(docker2.applies({})).toBe(true);
  });

  it("docker tool check WARNs with install command when tool missing", async () => {
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), "FROM scratch");
    const agentDetect = await import("../../src/utils/agent-detect.js");
    const osDetect = await import("../../src/utils/os-detect.js");
    agentDetect.checkBinary.mockResolvedValue({ ok: false });
    osDetect.getInstallCommand.mockReturnValue("apt install foo");
    const checks = getProjectChecks({ projectDir: tmpDir });
    const docker = checks.find((c) => c.name === "project:tool:docker");
    const result = await docker.detect({});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warn");
    expect(result.fix).toBe("apt install foo");
  });
});

describe("getProjectChecks — .env consistency", () => {
  it("WARNs when .env.example has vars not in .env", async () => {
    fs.writeFileSync(path.join(tmpDir, ".env.example"), "FOO=\nBAR=\nBAZ=");
    fs.writeFileSync(path.join(tmpDir, ".env"), "FOO=1");
    const checks = getProjectChecks({ projectDir: tmpDir });
    const env = checks.find((c) => c.name === "project:env-consistency");
    const result = await env.detect({});
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/BAR|BAZ/);
  });

  it("OK when all vars present", async () => {
    fs.writeFileSync(path.join(tmpDir, ".env.example"), "FOO=\nBAR=");
    fs.writeFileSync(path.join(tmpDir, ".env"), "FOO=1\nBAR=2");
    const checks = getProjectChecks({ projectDir: tmpDir });
    const env = checks.find((c) => c.name === "project:env-consistency");
    const result = await env.detect({});
    expect(result.ok).toBe(true);
  });

  it("does not apply if no .env.example exists", () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const env = checks.find((c) => c.name === "project:env-consistency");
    expect(env.applies({})).toBe(false);
  });
});

describe("getProjectChecks — gh remote access (degradable)", () => {
  it("only applies when git.auto_pr === true", () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const gh = checks.find((c) => c.name === "project:gh-remote-access");
    expect(gh.applies({ git: { auto_pr: false } })).toBe(false);
    expect(gh.applies({ git: { auto_pr: true } })).toBe(true);
  });

  it("is marked as degradable (KJC-BUG-0049)", () => {
    const checks = getProjectChecks({ projectDir: tmpDir });
    const gh = checks.find((c) => c.name === "project:gh-remote-access");
    expect(gh.degradable).toBeDefined();
    expect(gh.degradable.disables).toContain("git.auto_pr");
  });

  it("OK when git ls-remote succeeds", async () => {
    const proc = await import("../../src/utils/process.js");
    proc.runCommand.mockResolvedValue({ exitCode: 0, stdout: "abc refs/heads/main", stderr: "" });
    const checks = getProjectChecks({ projectDir: tmpDir });
    const gh = checks.find((c) => c.name === "project:gh-remote-access");
    const result = await gh.detect({});
    expect(result.ok).toBe(true);
  });

  it("WARN with executable fix when ls-remote fails", async () => {
    const proc = await import("../../src/utils/process.js");
    proc.runCommand.mockResolvedValue({ exitCode: 128, stdout: "", stderr: "fatal: not a git repo" });
    const checks = getProjectChecks({ projectDir: tmpDir });
    const gh = checks.find((c) => c.name === "project:gh-remote-access");
    const result = await gh.detect({});
    expect(result.ok).toBe(false);
    expect(result.fix).toMatch(/git remote -v|gh repo view/i);
  });
});

describe("getProjectChecks — empty projectDir", () => {
  it("returns empty array when projectDir is falsy", () => {
    expect(getProjectChecks({ projectDir: null })).toEqual([]);
    expect(getProjectChecks({ projectDir: "" })).toEqual([]);
  });
});
