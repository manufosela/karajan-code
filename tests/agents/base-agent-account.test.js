import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { addAccount } from "../../src/accounts/store.js";
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

  it("gives codex its CODEX_HOME and leaves other agents untouched", async () => {
    addAccount({ id: "ci", provider: "codex", dir: login }, { home });
    expect((await spawnEnv("codex", {})).CODEX_HOME).toBe(login);
    expect((await spawnEnv("gemini", { env: { PATH: "/bin" } })).CODEX_HOME).toBeUndefined();
  });
});
