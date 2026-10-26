// KJC-TSK-1232 (ADR 0032): the project's kj.config.yml is the team's; a member's preferences
// go into .karajan/kj.config.local.yml, which git ignores and which wins over the project's.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocalConfigPath, loadConfig } from "../src/config.js";

let tmpDir;
let savedHome;
const write = async (rel, text) => {
  await fs.mkdir(path.dirname(path.join(tmpDir, rel)), { recursive: true });
  await fs.writeFile(path.join(tmpDir, rel), text, "utf8");
};
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-config-local-"));
  savedHome = process.env.KJ_HOME;
  process.env.KJ_HOME = path.join(tmpDir, "home");
  await write("home/kj.config.yml", "coder: claude\nroles:\n  coder:\n    provider: claude\n  reviewer:\n    provider: codex\n");
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env.KJ_HOME;
  else process.env.KJ_HOME = savedHome;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("kj.config.local.yml", () => {
  it("lives next to the project config", () => {
    expect(getLocalConfigPath(tmpDir)).toBe(path.join(tmpDir, ".karajan", "kj.config.local.yml"));
  });

  it("wins field by field over the project config, which wins over the global one", async () => {
    await write(".karajan/kj.config.yml", "roles:\n  coder:\n    provider: gemini\n  reviewer:\n    provider: claude\n");
    await write(".karajan/kj.config.local.yml", "roles:\n  coder:\n    provider: codex\n");
    const { config } = await loadConfig(tmpDir);
    expect(config.roles.coder.provider).toBe("codex");
    expect(config.roles.reviewer.provider).toBe("claude");
  });

  it("works without a project config, and changes nothing when absent", async () => {
    await write(".karajan/kj.config.local.yml", "roles:\n  reviewer:\n    provider: gemini\n");
    expect((await loadConfig(tmpDir)).config.roles.reviewer.provider).toBe("gemini");
    await fs.rm(path.join(tmpDir, ".karajan", "kj.config.local.yml"));
    expect((await loadConfig(tmpDir)).config.roles.reviewer.provider).toBe("codex");
  });

  it("fails naming the file when it is not valid YAML", async () => {
    await write(".karajan/kj.config.local.yml", "roles: [unclosed\n");
    await expect(loadConfig(tmpDir)).rejects.toThrow(/kj\.config\.local\.yml/);
  });
});
