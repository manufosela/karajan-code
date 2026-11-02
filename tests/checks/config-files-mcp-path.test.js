// KJC-BUG-0171 — kj doctor must SEE a karajan-mcp registration in
// ~/.claude.json whose server path no longer exists (the CONNECTION_CLOSED a
// temp-prefix verify install leaves behind) and repair it: re-point to this
// install's server, or drop a dead entry when the standalone binary has none.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getConfigFileChecks, inLinkedWorktree, karajanMcpServerPath, repairKarajanMcpPath } from "../../src/checks/config-files.js";
import { STRATEGY } from "../../src/checks/types.js";

describe("stale karajan-mcp path check (KJC-BUG-0172)", () => {
  // The runner never remediates a WARN check whose strategy is PROMPT
  // (runner.js: WARN && PROMPT => don't remediate), so the repair was inert
  // under `kj doctor -y`. Re-pointing a dead entry to the current server is
  // deterministic and reversible, so the check must be AUTO to actually heal.
  it("is registered with strategy AUTO so kj doctor applies the repair", () => {
    const check = getConfigFileChecks().find((c) => c.name === "agent-config:karajan-mcp-path");
    expect(check).toBeDefined();
    expect(check.strategy).toBe(STRATEGY.AUTO);
    expect(typeof check.remediate).toBe("function");
  });
});

// KJC-BUG-0474 (#3128): a registration that points into a lane (a git worktree) works until the
// lane is removed, and meanwhile runs the lane's code in every session.
describe("inLinkedWorktree (KJC-BUG-0474)", () => {
  it("tells a file under a git worktree (its .git is a file) from one under a normal checkout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kj-mcp-lane-"));
    try {
      const lane = path.join(root, "repo", ".kj", "worktrees", "HU-1-x");
      fs.mkdirSync(path.join(root, "repo", ".git"), { recursive: true });
      fs.mkdirSync(path.join(lane, "src", "mcp"), { recursive: true });
      fs.writeFileSync(path.join(lane, ".git"), "gitdir: ../../../.git/worktrees/HU-1-x\n");
      expect(inLinkedWorktree(path.join(lane, "src", "mcp", "server.js"))).toBe(true);
      expect(inLinkedWorktree(path.join(root, "repo", "src", "mcp", "server.js"))).toBe(false);
      expect(inLinkedWorktree(path.join(root, "elsewhere", "server.js"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

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
