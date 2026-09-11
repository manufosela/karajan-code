// KJC-BUG-0171 — kj doctor must SEE a karajan-mcp registration in
// ~/.claude.json whose server path no longer exists (the CONNECTION_CLOSED a
// temp-prefix verify install leaves behind) and repair it: re-point to this
// install's server, or drop a dead entry when the standalone binary has none.
import { describe, expect, it } from "vitest";

import { karajanMcpServerPath, repairKarajanMcpPath } from "../../src/checks/config-files.js";

describe("karajanMcpServerPath (KJC-BUG-0171)", () => {
  it("returns the registered mcp server path", () => {
    const cfg = { mcpServers: { "karajan-mcp": { command: "node", args: ["/tmp/x/src/mcp/server.js"], cwd: "/tmp/x" } } };
    expect(karajanMcpServerPath(cfg)).toBe("/tmp/x/src/mcp/server.js");
  });

  it("returns null when karajan-mcp is not registered or config is empty", () => {
    expect(karajanMcpServerPath({ mcpServers: { other: { args: ["/a/b.js"] } } })).toBeNull();
    expect(karajanMcpServerPath({})).toBeNull();
    expect(karajanMcpServerPath(null)).toBeNull();
  });
});

describe("repairKarajanMcpPath (KJC-BUG-0171)", () => {
  it("re-points a stale entry to the current server, preserving command/env", () => {
    const cfg = {
      mcpServers: { "karajan-mcp": { command: "node", args: ["/tmp/gone/src/mcp/server.js"], cwd: "/tmp/gone", env: { KJ_HOME: "/h" } } },
    };
    const action = repairKarajanMcpPath(cfg, "/opt/kj/src/mcp/server.js", (p) => p === "/opt/kj/src/mcp/server.js");
    expect(action).toBe("repointed");
    expect(cfg.mcpServers["karajan-mcp"].args).toEqual(["/opt/kj/src/mcp/server.js"]);
    expect(cfg.mcpServers["karajan-mcp"].cwd).toBe("/opt/kj");
    expect(cfg.mcpServers["karajan-mcp"].command).toBe("node");
    expect(cfg.mcpServers["karajan-mcp"].env).toEqual({ KJ_HOME: "/h" });
  });

  it("removes the dead entry when this install has no bundled server", () => {
    const cfg = { mcpServers: { "karajan-mcp": { args: ["/tmp/gone/src/mcp/server.js"] }, keep: { args: [] } } };
    const action = repairKarajanMcpPath(cfg, null, () => false);
    expect(action).toBe("removed");
    expect(cfg.mcpServers["karajan-mcp"]).toBeUndefined();
    expect(cfg.mcpServers.keep).toBeDefined();
  });

  it("returns null when there is nothing to repair", () => {
    expect(repairKarajanMcpPath({ mcpServers: {} }, "/x/src/mcp/server.js", () => true)).toBeNull();
  });
});
