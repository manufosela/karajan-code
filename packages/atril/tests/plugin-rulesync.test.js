// importCanonical: `rulesync import` runs on a throwaway copy in a throwaway directory; the runner is a fake.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCanonical } from "../src/plugin-rulesync.js";

let dir, plugin, calls;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-rulesync-"));
  plugin = join(dir, "plugin");
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kit", version: "1.0.0", userConfig: { TOKEN: { title: "t", sensitive: true }, REGION: { title: "r" } } }));
  mkdirSync(join(dir, "project", ".rulesync"), { recursive: true });
  writeFileSync(join(dir, "project", ".rulesync", "mcp.json"), "{}\n");
  calls = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Like the import: .rulesync/mcp.json under --output-root.
const fake = (mcp, { fail } = {}) => (cmd, args, cwd) => {
  calls.push({ args, cwd });
  if (args.includes("--version")) return "1.0.0";
  if (fail) throw new Error("boom");
  const root = args[args.indexOf("--output-root") + 1];
  mkdirSync(join(root, ".rulesync"), { recursive: true });
  writeFileSync(join(root, ".rulesync", "mcp.json"), JSON.stringify(mcp));
};

describe("importCanonical", () => {
  it("reads the canonical result and leaves the project's .rulesync and the plugin untouched", () => {
    const before = readFileSync(join(dir, "project", ".rulesync", "mcp.json"), "utf8");
    const result = importCanonical(plugin, { projectDir: join(dir, "project") }, fake({ mcpServers: { db: { command: "npx" } } }));
    expect(result).toEqual({ status: "imported", canonical: { mcp: { mcpServers: { db: { command: "npx" } } } } });
    expect(readFileSync(join(dir, "project", ".rulesync", "mcp.json"), "utf8")).toBe(before);
    expect(existsSync(join(plugin, ".rulesync"))).toBe(false);
    expect(calls[1].args).toEqual(expect.arrayContaining(["import", "--targets", "claudecode-plugin", "--features", "mcp,hooks"]));
  });

  it("runs in a temporary directory that is removed, also when the import fails", () => {
    importCanonical(plugin, { projectDir: join(dir, "project") }, fake({ mcpServers: {} }));
    expect(calls[1].cwd.startsWith(tmpdir())).toBe(true);
    expect(existsSync(calls[1].cwd)).toBe(false);
    expect(() => importCanonical(plugin, { projectDir: join(dir, "project") }, fake({}, { fail: true }))).toThrow("rulesync import failed");
    expect(existsSync(calls[3].cwd)).toBe(false);
  });

  it("reports absent when rulesync does not answer", () => {
    const run = () => { throw new Error("not found"); };
    expect(importCanonical(plugin, { projectDir: join(dir, "project") }, run)).toEqual({ status: "absent" });
  });

  it("refers to a sensitive key as ${KEY} and leaves the others", () => {
    const mcp = { mcpServers: { db: { env: { A: "${user_config.TOKEN}", B: "${user_config.REGION}" } } } };
    const { canonical } = importCanonical(plugin, { projectDir: join(dir, "project") }, fake(mcp));
    expect(canonical.mcp.mcpServers.db.env).toEqual({ A: "${TOKEN}", B: "${user_config.REGION}" });
  });

  it("names the sensitive keys the entries refer to, and only those", () => {
    const mcp = { mcpServers: { db: { env: { A: "${user_config.TOKEN}" } } } };
    expect(importCanonical(plugin, { projectDir: join(dir, "project") }, fake(mcp)).needs).toEqual(["TOKEN"]);
    expect(importCanonical(plugin, { projectDir: join(dir, "project") }, fake({ mcpServers: { db: { command: "npx" } } }))).not.toHaveProperty("needs");
  });
});

describe("importCanonical: plugin paths", () => {
  const SHIPPED = ["scripts/x.sh", "scripts/hook.js", "scripts/check.js", "dist/h.js", "dist/server.js", "servers/x", "bin/tool", "ok.sh", "a.js", "x.sh"];
  const importWith = (canonical, root = ".karajan") => {
    for (const file of SHIPPED) {
      mkdirSync(dirname(join(plugin, file)), { recursive: true });
      writeFileSync(join(plugin, file), "");
    }
    const fakeBoth = (cmd, args) => {
      if (args.includes("--version")) return "1.0.0";
      const out = join(args[args.indexOf("--output-root") + 1], ".rulesync");
      mkdirSync(out, { recursive: true });
      for (const [kind, doc] of Object.entries(canonical)) writeFileSync(join(out, `${kind}.json`), JSON.stringify(doc));
    };
    const projectDir = join(dir, "project");
    return importCanonical(plugin, { projectDir, pluginCopy: join(projectDir, root, "plugins", "kit", "1.0.0") }, fakeBoth);
  };
  const hook = (command) => ({ hooks: { PreToolUse: [{ type: "command", command }] } });

  it("points a hook script and a runner script to the plugin copy in the store", () => {
    const first = importWith({ hooks: hook("./scripts/x.sh") });
    expect(first.canonical.hooks.hooks.PreToolUse[0].command).toBe("./.karajan/plugins/kit/1.0.0/scripts/x.sh");
    expect(first.rewritten).toBe(true);
    const second = importWith({ hooks: hook("node ./dist/h.js --flag ./keep") });
    expect(second.canonical.hooks.hooks.PreToolUse[0].command).toBe("node ./.karajan/plugins/kit/1.0.0/dist/h.js --flag ./keep");
  });

  it("points an MCP command and its runner script argument to the store, taking the root from the option", () => {
    const { canonical } = importWith({ mcp: { mcpServers: { a: { command: "./servers/x" }, b: { command: "node", args: ["./dist/server.js", "./data"] } } } }, "store");
    expect(canonical.mcp.mcpServers.a.command).toBe("./store/plugins/kit/1.0.0/servers/x");
    expect(canonical.mcp.mcpServers.b.args).toEqual(["./store/plugins/kit/1.0.0/dist/server.js", "./data"]);
  });

  it("leaves other arguments, absolute, home, parent and URL paths and variables as they are, and reports no rewrite", () => {
    const hooks = ["npx prettier --write ./src", "/usr/bin/x ./y", "~/bin/x", "../x/run.sh", "${HOME}/run.sh", "node ../x.js", "node https://h/x.js"].map((command) => ({ type: "command", command }));
    const mcp = { mcpServers: { s: { command: "npx", args: ["-y", "./pkg"] }, u: { url: "https://h/mcp" } } };
    const result = importWith({ hooks: { hooks: { Stop: hooks } }, mcp });
    expect(result.canonical.hooks.hooks.Stop).toEqual(hooks);
    expect(result.canonical.mcp).toEqual(mcp);
    expect(result.rewritten).toBeUndefined();
  });

  it.each(["python3 -W ignore ./server.py", "bash -o pipefail ./hook.sh", "node --require ./r.js ./main.js"])("skips %s, as hook and as MCP server, and keeps the rest", (command) => {
    const reason = `this command cannot be pointed to the store: ${command}; write it without options before the script`;
    const [runner, ...args] = command.split(" ");
    const result = importWith({ hooks: { hooks: { PreToolUse: [{ command }, { command: "./ok.sh" }] } }, mcp: { mcpServers: { s: { command: runner, args }, t: { command: "npx" } } } });
    expect(result.canonical.hooks.hooks.PreToolUse.map((h) => h.command)).toEqual(["./.karajan/plugins/kit/1.0.0/ok.sh"]);
    expect(Object.keys(result.canonical.mcp.mcpServers)).toEqual(["t"]);
    expect(result.skipped).toEqual([{ kind: "hook", name: `PreToolUse: ${command}`, reason }, { kind: "mcp", name: "s", reason }]);
  });

  it.each(["VAR=1 ./x.sh", "cd ./a && ./x.sh", "./a.sh && ./b.sh", "./x.sh | tee out", "./a.sh; ./b.sh", "./a.sh || true", "sh -c \"./x.sh\"", "bash -c './x.sh'"])("skips the compound or prefixed %s instead of leaving ./ paths", (command) => {
    const result = importWith({ hooks: hook(command) });
    expect(result.canonical.hooks).toBeUndefined();
    expect(result.skipped).toEqual([{ kind: "hook", name: `PreToolUse: ${command}`, reason: expect.stringContaining("shell syntax") }]);
    expect(result.rewritten).toBeUndefined();
  });

  it("never skips a command with no ./ path, however compound", () => {
    const commands = ["echo a && echo b", "VAR=1 npx x", "sh -c \"echo hi\"", "../a.sh && ../b.sh"];
    const result = importWith({ hooks: { hooks: { Stop: commands.map((command) => ({ command })) } } });
    expect(result.canonical.hooks.hooks.Stop.map((h) => h.command)).toEqual(commands);
    expect(result.skipped).toBeUndefined();
  });

  it("leaves a runner given a bare script or only non-path words as it is", () => {
    const { canonical } = importWith({ hooks: { hooks: { Stop: [{ command: "node server.js ./data" }, { command: "bash -x run.sh" }] } } });
    expect(canonical.hooks.hooks.Stop.map(({ command }) => command)).toEqual(["node server.js ./data", "bash -x run.sh"]);
  });

  it("keeps the quotes of a quoted script and refuses a store path the shell would split", () => {
    const quoted = importWith({ hooks: hook("node \"./scripts/hook.js\"") });
    expect(quoted.canonical.hooks.hooks.PreToolUse[0].command).toBe("node \"./.karajan/plugins/kit/1.0.0/scripts/hook.js\"");
    expect(importWith({ hooks: hook("node \t ./a.js  ./b") }).canonical.hooks.hooks.PreToolUse[0].command).toBe("node \t ./.karajan/plugins/kit/1.0.0/a.js  ./b");
    expect(importWith({ hooks: hook("./x.sh") }, "my store").skipped[0].reason).toMatch(/needs shell quoting/);
  });

  it("rewrites a ./ path only if the plugin ships it, and names each one it leaves to the project", () => {
    const hooks = ["npx prettier --write ./src", "node ./scripts/check.js", "./bin/tool --fast", "./missing.sh", "node ./missing.js"].map((command) => ({ command }));
    const mcp = { mcpServers: { tool: { command: "./bin/tool" }, gone: { command: "node", args: ["./nope.js", "./scripts/x.sh"] } } };
    const result = importWith({ hooks: { hooks: { Stop: hooks } }, mcp });
    expect(result.canonical.hooks.hooks.Stop.map((h) => h.command)).toEqual(["npx prettier --write ./src", "node ./.karajan/plugins/kit/1.0.0/scripts/check.js", "./.karajan/plugins/kit/1.0.0/bin/tool --fast", "./missing.sh", "node ./missing.js"]);
    expect(result.canonical.mcp.mcpServers).toEqual({ tool: { command: "./.karajan/plugins/kit/1.0.0/bin/tool" }, gone: { command: "node", args: ["./nope.js", "./scripts/x.sh"] } });
    expect(result.kept).toEqual([{ kind: "hook", name: "Stop: ./missing.sh", path: "./missing.sh" }, { kind: "hook", name: "Stop: node ./missing.js", path: "./missing.js" }, { kind: "mcp", name: "gone", path: "./nope.js" }]);
    expect(result.rewritten).toBe(true);
  });

  it("reports no kept path, and no rewrite, when every ./ path is the project's", () => {
    const result = importWith({ hooks: hook("./only-mine.sh") });
    expect(result.kept).toEqual([{ kind: "hook", name: "PreToolUse: ./only-mine.sh", path: "./only-mine.sh" }]);
    expect(result.rewritten).toBeUndefined();
    expect(importWith({ hooks: hook("./scripts/x.sh") })).not.toHaveProperty("kept");
  });

  it("does not name a kept path of an entry that is then skipped", () => {
    const result = importWith({ hooks: hook("node ./missing.js ./a.js && ./b.sh") });
    expect(result).not.toHaveProperty("kept");
  });

  it("skips a path that escapes the plugin copy with ..", () => {
    expect(importWith({ hooks: hook("./a/../../x.sh") }).skipped[0].reason).toMatch(/escapes the plugin/);
    expect(importWith({ mcp: { mcpServers: { s: { command: "node", args: ["./../x.js"] } } } }).skipped[0]).toMatchObject({ kind: "mcp", name: "s" });
  });

  describe("cwd of an MCP server", () => {
    const withCwd = (cwd) => importWith({ mcp: { mcpServers: { s: { command: "npx", ...(cwd !== undefined && { cwd }) } } } });
    const cwdOf = (result) => result.canonical.mcp.mcpServers.s.cwd;
    const COPY = "./.karajan/plugins/kit/1.0.0";

    it.each([["./servers", `${COPY}/servers`], ["servers", `${COPY}/servers`], ["./servers/", `${COPY}/servers`], ["servers/", `${COPY}/servers`]])("points the cwd %s to the store copy when the plugin ships it", (cwd, expected) => {
      const result = withCwd(cwd);
      expect(cwdOf(result)).toBe(expected);
      expect(result.rewritten).toBe(true);
      expect(result).not.toHaveProperty("kept");
    });

    it.each(["./nowhere", "nowhere/"])("leaves the cwd %s as the project's and names it, when the plugin does not ship it", (cwd) => {
      const result = withCwd(cwd);
      expect(cwdOf(result)).toBe(cwd);
      expect(result.kept).toEqual([{ kind: "mcp", name: "s", path: cwd }]);
      expect(result.rewritten).toBeUndefined();
    });

    it.each(["/opt/server", "~/server", "${HOME}/server", "C:\\server"])("leaves the absolute cwd %s alone with no line", (cwd) => {
      const result = withCwd(cwd);
      expect(cwdOf(result)).toBe(cwd);
      expect(result).not.toHaveProperty("kept");
      expect(result.rewritten).toBeUndefined();
    });

    it.each(["../servers", "./servers/../../x", "servers/.."])("skips the server whose cwd %s climbs out with .., before looking at the disk", (cwd) => {
      const result = withCwd(cwd);
      expect(result.skipped).toEqual([{ kind: "mcp", name: "s", reason: expect.stringMatching(/escapes the plugin/) }]);
      expect(result.canonical.mcp).toBeUndefined();
    });

    it("writes the command and script paths relative to the rewritten cwd, so they still name the plugin's file", () => {
      const server = (cwd) => importWith({ mcp: { mcpServers: { s: { command: "node", args: ["./dist/server.js", "./data"], cwd } } } }).canonical.mcp.mcpServers.s;
      expect(server("./servers")).toEqual({ command: "node", args: ["../dist/server.js", "./data"], cwd: `${COPY}/servers` });
      expect(server("./servers/x/")).toMatchObject({ args: ["../../dist/server.js", "./data"], cwd: `${COPY}/servers/x` });
      expect(server("./")).toEqual({ command: "node", args: ["./dist/server.js", "./data"], cwd: COPY });
    });

    it("leaves a server with no cwd unchanged", () => {
      const result = withCwd();
      expect(result.canonical.mcp.mcpServers.s).toEqual({ command: "npx" });
      expect(result.rewritten).toBeUndefined();
    });
  });
});
