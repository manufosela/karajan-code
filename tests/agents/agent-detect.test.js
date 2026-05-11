import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn()
}));

vi.mock("../src/agents/resolve-bin.js", () => ({
  resolveBin: vi.fn((name) => `/usr/bin/${name}`)
}));

describe("agent-detect", () => {
  let checkBinary, detectAvailableAgents, KNOWN_AGENTS;
  let runCommand;

  beforeEach(async () => {
    vi.resetModules();
    ({ runCommand } = await import("../src/utils/process.js"));
    ({ checkBinary, detectAvailableAgents, KNOWN_AGENTS } = await import("../src/utils/agent-detect.js"));
  });

  it("checkBinary returns ok=true when command succeeds", async () => {
    runCommand.mockResolvedValue({ exitCode: 0, stdout: "claude 1.0.0", stderr: "" });

    const result = await checkBinary("claude");
    expect(result.ok).toBe(true);
    expect(result.version).toBe("claude 1.0.0");
  });

  it("checkBinary returns ok=false when command fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 127, stdout: "", stderr: "not found" });

    const result = await checkBinary("codex");
    expect(result.ok).toBe(false);
  });

  it("detectAvailableAgents checks all known agents", async () => {
    runCommand.mockImplementation((_cmd, _args) => {
      if (_cmd.includes("claude")) return Promise.resolve({ exitCode: 0, stdout: "claude 2.0", stderr: "" });
      if (_cmd.includes("codex")) return Promise.resolve({ exitCode: 0, stdout: "codex 1.0", stderr: "" });
      return Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
    });

    const agents = await detectAvailableAgents();
    expect(agents).toHaveLength(KNOWN_AGENTS.length);

    const claude = agents.find((a) => a.name === "claude");
    expect(claude.available).toBe(true);
    expect(claude.version).toBe("claude 2.0");

    const gemini = agents.find((a) => a.name === "gemini");
    expect(gemini.available).toBe(false);
    expect(gemini.version).toBeNull();
  });

  it("KNOWN_AGENTS contains claude, codex, gemini, aider", () => {
    const names = KNOWN_AGENTS.map((a) => a.name);
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(names).toContain("gemini");
    expect(names).toContain("aider");
  });
});
