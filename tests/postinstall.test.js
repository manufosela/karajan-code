import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { tomlPath } from "../scripts/toml-value.js";

const ROOT_DIR = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT_DIR, "scripts", "postinstall.js");

// A `null` value UNSETS the variable for the child (the machine running the
// suite may carry KARAJAN_HOME / KJ_HOME in its own env).
function runScript(env = {}) {
  return new Promise((resolve) => {
    const merged = { ...process.env, KARAJAN_HOME: null, KJ_HOME: null, ...env };
    for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
    const child = spawn("node", [SCRIPT], {
      cwd: ROOT_DIR,
      env: merged
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
    // The deprecated KJ_HOME input is honoured but written under the current name.
    expect(config.mcpServers["karajan-mcp"].env.KARAJAN_HOME).toBe("/tmp/kj-test-home");
    expect(config.mcpServers["karajan-mcp"].env.KJ_HOME).toBeUndefined();
  });

  // KJC-BUG-0179 (#1730): after every `kj update` the registration pointed at
  // <package>/.karajan (wiped on reinstall) and dropped the user's env.
  describe("home resolution — KJC-BUG-0179", () => {
    it("defaults to ~/.karajan, never the package dir, and writes KARAJAN_HOME", async () => {
      await fs.writeFile(claudeJson, "{}", "utf8");

      const { code } = await runScript({ HOME: fakeHome });
      expect(code).toBe(0);

      const entry = JSON.parse(await fs.readFile(claudeJson, "utf8")).mcpServers["karajan-mcp"];
      expect(entry.env.KARAJAN_HOME).toBe(path.join(fakeHome, ".karajan"));
      expect(entry.env.KJ_HOME).toBeUndefined();
      const toml = await fs.readFile(codexConfig, "utf8");
      expect(toml).toContain(`KARAJAN_HOME = ${tomlPath(path.join(fakeHome, ".karajan"))}`);
      expect(toml).not.toContain("KJ_HOME");
    });

    it("honours KARAJAN_HOME from the environment", async () => {
      const { code } = await runScript({ HOME: fakeHome, KARAJAN_HOME: "/tmp/kj-env-home" });
      expect(code).toBe(0);

      const entry = JSON.parse(await fs.readFile(claudeJson, "utf8")).mcpServers["karajan-mcp"];
      expect(entry.env.KARAJAN_HOME).toBe("/tmp/kj-env-home");
    });

    it("keeps the home and the other env keys the user set on the existing entry", async () => {
      await fs.writeFile(claudeJson, JSON.stringify({
        mcpServers: {
          "karajan-mcp": {
            type: "stdio", command: "node", args: ["/old/install/src/mcp/server.js"],
            env: { KARAJAN_HOME: "/home/someone/.karajan", KJ_SONAR_TOKEN: "keep-me" }
          }
        }
      }), "utf8");

      const { code } = await runScript({ HOME: fakeHome });
      expect(code).toBe(0);

      const entry = JSON.parse(await fs.readFile(claudeJson, "utf8")).mcpServers["karajan-mcp"];
      expect(entry.env).toEqual({ KARAJAN_HOME: "/home/someone/.karajan", KJ_SONAR_TOKEN: "keep-me" });
      expect(entry.args[0]).toBe(path.join(ROOT_DIR, "src", "mcp", "server.js"));
    });

    it("replaces a stale self-inflicted package-dir KJ_HOME with ~/.karajan", async () => {
      await fs.writeFile(claudeJson, JSON.stringify({
        mcpServers: {
          "karajan-mcp": { command: "node", args: ["/usr/lib/node_modules/karajan-code/src/mcp/server.js"],
            env: { KJ_HOME: "/usr/lib/node_modules/karajan-code/.karajan" } }
        }
      }), "utf8");

      const { code } = await runScript({ HOME: fakeHome });
      expect(code).toBe(0);

      const entry = JSON.parse(await fs.readFile(claudeJson, "utf8")).mcpServers["karajan-mcp"];
      expect(entry.env).toEqual({ KARAJAN_HOME: path.join(fakeHome, ".karajan") });
    });
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
