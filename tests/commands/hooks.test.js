import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hooksCommand, hooksSetCommand, hooksUnsetCommand } from "../../src/commands/hooks.js";
import { hardenCommand } from "../../src/commands/harden.js";
import { pinnedCommands } from "../../src/harden/pinned-commands.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-hooks-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const setup = (config = {}) => {
  const store = { current: structuredClone(config) };
  return {
    store,
    load: vi.fn(async () => structuredClone(store.current)),
    write: vi.fn(async (_path, cfg) => { store.current = cfg; }),
    act: vi.fn(async () => {}),
    print: vi.fn(),
  };
};

describe("kj hooks set / unset", () => {
  it("pins a step in harden.commands after the human act", async () => {
    const io = setup({ other: 1 });
    await hooksSetCommand({ step: "lint", command: "make lint", projectDir: dir, ...io });
    expect(io.act).toHaveBeenCalledOnce();
    expect(io.store.current).toEqual({ other: 1, harden: { commands: { lint: "make lint" } } });
    expect(io.print.mock.calls[0][0]).toMatch(/kj harden.*seal/);
  });

  it.each([
    ["deploy", "x"], ["lint", ""], ["lint", "  "], ["lint", "a\nb"], ["lint", "a\0b"], ["lint", "x".repeat(301)],
  ])("refuses step %j with command %j and changes nothing", async (step, command) => {
    const io = setup();
    await expect(hooksSetCommand({ step, command, projectDir: dir, ...io })).rejects.toThrow();
    expect(io.act).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  });

  it("unset removes only that step, through the human act", async () => {
    const io = setup({ harden: { commands: { lint: "a", test: "b" } } });
    await hooksUnsetCommand({ step: "lint", projectDir: dir, ...io });
    expect(io.act).toHaveBeenCalledOnce();
    expect(io.store.current.harden.commands).toEqual({ test: "b" });
  });

  it("a refused act changes nothing", async () => {
    const io = setup();
    io.act.mockRejectedValue(new Error("human only"));
    await expect(hooksSetCommand({ step: "test", command: "true", projectDir: dir, ...io })).rejects.toThrow("human only");
    expect(io.write).not.toHaveBeenCalled();
  });
});

describe("kj hooks listing and precedence", () => {
  it("pinned > Makefile > detected, else none, each with its origin", async () => {
    expect((await hooksCommand({ projectDir: dir, ...setup() }))[0]).toEqual({ step: "lint", command: null, origin: "none" });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run" } }));
    writeFileSync(join(dir, "Makefile"), "test:\n\techo\nformat-check:\n\techo\n");
    mkdirSync(join(dir, ".karajan"));
    const io = setup({ harden: { commands: { format: "my-format" } } });
    const steps = await hooksCommand({ projectDir: dir, load: io.load, print: io.print });
    expect(steps).toEqual([
      { step: "lint", command: "npm run -s lint", origin: "detected" },
      { step: "format", command: "my-format", origin: "pinned" },
      { step: "test", command: "make test", origin: "Makefile" },
    ]);
    expect(io.print).toHaveBeenCalledTimes(3);
  });

  it("hardenCommand writes the pinned command into the hook, over the Makefile", async () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, "Makefile"), "lint:\n\techo\n");
    mkdirSync(join(dir, ".karajan"));
    writeFileSync(join(dir, ".karajan", "kj.config.yml"), "harden:\n  commands:\n    lint: my-pinned-lint\n");
    await hardenCommand({ projectDir: dir, profile: "standard", ci: false, guidelines: false, logger: { info() {}, error() {} } });
    const hook = readFileSync(join(dir, ".karajan", "hooks", "pre-commit"), "utf8");
    expect(hook).toContain("my-pinned-lint");
    expect(hook).not.toContain("make lint");
  });

  it("pinnedCommands ignores unknown steps and empty values", async () => {
    const io = setup({ harden: { commands: { lint: "a", bogus: "b", test: "" } } });
    expect(await pinnedCommands(dir, io.load)).toEqual({ lint: "a" });
  });
});
