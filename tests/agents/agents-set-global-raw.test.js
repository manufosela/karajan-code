// HU-4643: `kj agents set --global` inside a repo wrote the merged config (defaults, the global
// file and the repo's own) into ~/.karajan/kj.config.yml, so every repo without its own panel
// inherited that repo's settings. It must write the global file's own keys plus the new role.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { setAgent } from "../../src/commands/agents.js";

describe("kj agents set --global writes only the global file", () => {
  const saved = { home: process.env.KARAJAN_HOME, cwd: process.cwd() };
  let home;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "kj-home-"));
    writeFileSync(join(home, "kj.config.yml"), "coder: claude\nreviewer: agy\n");
    const repo = mkdtempSync(join(tmpdir(), "kj-repo-"));
    mkdirSync(join(repo, ".karajan"));
    writeFileSync(join(repo, ".karajan", "kj.config.yml"), "reviewer: codex\nmax_iterations: 9\n");
    process.env.KARAJAN_HOME = home;
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(saved.cwd);
    if (saved.home === undefined) delete process.env.KARAJAN_HOME;
    else process.env.KARAJAN_HOME = saved.home;
  });

  it("keeps the repo's settings out of ~/.karajan/kj.config.yml", async () => {
    await setAgent("solomon", "agy", { global: true });
    const written = yaml.load(readFileSync(join(home, "kj.config.yml"), "utf8"));
    expect(written).toEqual({ coder: "claude", reviewer: "agy", roles: { solomon: { provider: "agy" } } });
  });
});
