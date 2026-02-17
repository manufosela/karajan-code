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
  const claudeSettings = path.join(fakeHome, ".claude", "settings.json");
  const codexConfig = path.join(fakeHome, ".codex", "config.toml");

  beforeEach(async () => {
    await fs.mkdir(path.join(fakeHome, ".claude"), { recursive: true });
    await fs.mkdir(path.join(fakeHome, ".codex"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers MCP in Claude settings.json", async () => {
    // Pre-create an empty settings file
    await fs.writeFile(claudeSettings, "{}", "utf8");

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const settings = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
    expect(settings.mcpServers).toBeDefined();
    expect(settings.mcpServers["karajan-mcp"]).toBeDefined();
    expect(settings.mcpServers["karajan-mcp"].command).toBe("node");
    expect(settings.mcpServers["karajan-mcp"].args[0]).toContain("src/mcp/server.js");
    expect(settings.mcpServers["karajan-mcp"].env.KJ_HOME).toBe("/tmp/kj-test-home");
  });

  it("preserves existing MCP servers in Claude settings", async () => {
    const existing = {
      mcpServers: {
        "other-mcp": { command: "node", args: ["/other/server.js"] }
      }
    };
    await fs.writeFile(claudeSettings, JSON.stringify(existing), "utf8");

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const settings = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
    expect(settings.mcpServers["other-mcp"]).toBeDefined();
    expect(settings.mcpServers["karajan-mcp"]).toBeDefined();
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
    await fs.writeFile(claudeSettings, "{}", "utf8");

    await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });

    const settings = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
    const mcpKeys = Object.keys(settings.mcpServers);
    const karajanEntries = mcpKeys.filter((k) => k === "karajan-mcp");
    expect(karajanEntries).toHaveLength(1);

    const toml = await fs.readFile(codexConfig, "utf8");
    const beginCount = (toml.match(/# BEGIN karajan-mcp/g) || []).length;
    expect(beginCount).toBe(1);
  });

  it("creates Claude settings.json if it does not exist", async () => {
    // Remove the pre-created .claude dir
    await fs.rm(path.join(fakeHome, ".claude"), { recursive: true, force: true });

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);

    const settings = JSON.parse(await fs.readFile(claudeSettings, "utf8"));
    expect(settings.mcpServers["karajan-mcp"]).toBeDefined();
  });

  it("exits 0 even if writing fails", async () => {
    // Make .claude a file instead of directory to cause write failure
    await fs.rm(path.join(fakeHome, ".claude"), { recursive: true, force: true });
    await fs.writeFile(path.join(fakeHome, ".claude"), "not-a-dir", "utf8");

    const { code } = await runScript({ HOME: fakeHome, KJ_HOME: "/tmp/kj-test-home" });
    expect(code).toBe(0);
  });
});
