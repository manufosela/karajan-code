import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT_DIR, "scripts", "postinstall.js");

function runScript(env = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [SCRIPT], {
      cwd: ROOT_DIR,
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("postinstall", () => {
  const tmpDir = path.join(os.tmpdir(), `kj-postinstall-test-${Date.now()}`);
  const fakeHome = path.join(tmpDir, "home");
  const claudeJson = path.join(fakeHome, ".claude.json");
  const codexConfig = path.join(fakeHome, ".codex", "config.toml");

  beforeEach(async () => {
    await fs.mkdir(fakeHome, { recursive: true });
    await fs.mkdir(path.join(fakeHome, ".codex"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers MCP in ~/.claude.json", async () => {
    await fs.writeFile(claudeJson, "{}", "utf8");

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const config = JSON.parse(await fs.readFile(claudeJson, "utf8"));
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers["karajan-mcp"]).toBeDefined();
    expect(config.mcpServers["karajan-mcp"].command).toBe("node");
    expect(config.mcpServers["karajan-mcp"].args[0]).toContain("src/mcp/server.js");
    expect(config.mcpServers["karajan-mcp"].env.KJ_HOME).toBe("/tmp/kj-test-home");
  });

  it("preserves existing MCP servers in ~/.claude.json", async () => {
    const existing = {
      mcpServers: {
        "other-mcp": { command: "node", args: ["/other/server.js"] }
      }
    };
    await fs.writeFile(claudeJson, JSON.stringify(existing), "utf8");

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const config = JSON.parse(await fs.readFile(claudeJson, "utf8"));
    expect(config.mcpServers["other-mcp"]).toBeDefined();
    expect(config.mcpServers["karajan-mcp"]).toBeDefined();
  });

  it("registers MCP in Codex config.toml", async () => {
    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const toml = await fs.readFile(codexConfig, "utf8");
    expect(toml).toContain("# BEGIN karajan-mcp");
    expect(toml).toContain("# END karajan-mcp");
    expect(toml).toContain('[mcp_servers."karajan-mcp"]');
    expect(toml).toContain("src/mcp/server.js");
  });

  it("is idempotent — running twice does not duplicate entries", async () => {
    await fs.writeFile(claudeJson, "{}", "utf8");

    await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });

    const config = JSON.parse(await fs.readFile(claudeJson, "utf8"));
    const mcpKeys = Object.keys(config.mcpServers);
    const karajanEntries = mcpKeys.filter((k) => k === "karajan-mcp");
    expect(karajanEntries).toHaveLength(1);

    const toml = await fs.readFile(codexConfig, "utf8");
    const beginCount = (toml.match(/# BEGIN karajan-mcp/g) || []).length;
    expect(beginCount).toBe(1);
  });

  it("creates ~/.claude.json if it does not exist", async () => {
    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const config = JSON.parse(await fs.readFile(claudeJson, "utf8"));
    expect(config.mcpServers["karajan-mcp"]).toBeDefined();
  });

  it("exits 0 even if writing fails", async () => {
    // Make .claude.json a directory to cause write failure
    await fs.mkdir(claudeJson, { recursive: true });

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);
  });
});
