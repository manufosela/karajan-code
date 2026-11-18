import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { addAccount, assignAccounts, setPace } from "../../src/accounts/store.js";
import { projectKey } from "../../src/accounts/project-key.js";
import { withKarajanHome } from "../../src/utils/paths.js";
import { createNoopLogger } from "../_fixtures/loggers.js";

let home;
let login;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kj-home-"));
  login = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(login, { recursive: true, force: true });
});

const spawnEnv = async (name, options) => {
  const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
  const agent = new BaseAgent(name, {}, createNoopLogger(), { runner: { run } });
  await withKarajanHome(home, () => agent.runCommand(name, ["-p"], options));
  return run.mock.calls[0][2].env;
};

describe("BaseAgent.runCommand and the default account (HU-4587)", () => {
  it("leaves the inherited login alone while no account is added", async () => {
    const env = await spawnEnv("claude", { env: { PATH: "/bin", CLAUDE_CONFIG_DIR: "/inherited" } });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/inherited");
  });

  it("launches claude with its default account, over the inherited one", async () => {
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    const env = await spawnEnv("claude", { env: { PATH: "/bin", CLAUDE_CONFIG_DIR: "/inherited" } });
    expect(env.CLAUDE_CONFIG_DIR).toBe(login);
  });

  it("launches the first account of the project's order, from any of its worktrees (HU-4588)", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "kj-login-"));
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    addAccount({ id: "alt", provider: "claude", dir: other }, { home });
    assignAccounts(projectKey(process.cwd()), "claude", ["alt", "work"], { home });
    const env = await spawnEnv("claude", { env: { PATH: "/bin" } });
    expect(env.CLAUDE_CONFIG_DIR).toBe(other);
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("paces the call only when the account has a pace (HU-4591)", async () => {
    addAccount({ id: "work", provider: "claude", dir: login }, { home });
    setPace("work", { maxConcurrent: 1 }, { home });
    let active = 0;
    let peak = 0;
    const run = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const agent = new BaseAgent("claude", {}, createNoopLogger(), { runner: { run } });
    await withKarajanHome(home, () => Promise.all([1, 2, 3].map(() => agent.runCommand("claude", ["-p"], { env: { PATH: "/bin" } }))));
    expect(run).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
  });

  it("gives codex its CODEX_HOME and leaves other agents untouched", async () => {
    addAccount({ id: "ci", provider: "codex", dir: login }, { home });
    expect((await spawnEnv("codex", {})).CODEX_HOME).toBe(login);
    expect((await spawnEnv("gemini", { env: { PATH: "/bin" } })).CODEX_HOME).toBeUndefined();
  });
});
