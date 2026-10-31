// KJC-TSK-1344: kj doctor checks the codex config of the account CODEX_HOME selects.
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexConfigCheck } from "../../src/checks/config-files.js";

let dir;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe("agent-config:codex", () => {
  it("reads $CODEX_HOME/config.toml and names it", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-codexcfg-"));
    fs.writeFileSync(path.join(dir, "config.toml"), '[mcp_servers.kj]\ncommand = "a"\n[mcp_servers.kj]\ncommand = "b"\n');
    const check = createCodexConfigCheck({ env: { CODEX_HOME: dir }, home: "/nowhere" });
    expect(check.label).toContain(path.join(dir, "config.toml"));
    const res = await check.detect();
    expect(res.ok).toBe(false);
    expect(res.fix).toContain(path.join(dir, "config.toml"));
  });

  it("without CODEX_HOME it reads ~/.codex/config.toml", () => {
    expect(createCodexConfigCheck({ env: {}, home: "/home/u" }).label).toContain("/home/u/.codex/config.toml");
  });
});
