// HU-4441: `kj atril [args...]` is a proxy: atril's own CLI, on the .karajan store.
import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { atrilCommand, rawAtrilArgs } from "../../src/commands/atril.js";
import { registerRolesSkills } from "../../src/cli/register-roles-skills.js";

vi.mock("../../src/commands/atril.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, atrilCommand: vi.fn(actual.atrilCommand) };
});

const run = (args, status = 0) => {
  const calls = [];
  const spawn = (cmd, argv, opts) => { calls.push({ argv: argv.slice(1), opts }); return { status }; };
  const code = atrilCommand({ args, spawn, bin: "/b/atril.js" });
  return { code, ...calls[0] };
};

describe("kj atril", () => {
  it("catalog sync gets the .karajan root and atril's exit code comes back", () => {
    const { code, argv, opts } = run(["catalog", "sync"], 3);
    expect(argv).toEqual(["catalog", "sync", "--root", ".karajan"]);
    expect(code).toBe(3);
    expect(opts.stdio).toBe("inherit");
  });
  it("an unknown option reaches atril unchanged", () => {
    expect(run(["scan", "--whatever"]).argv).toEqual(["scan", "--whatever", "--root", ".karajan"]);
  });
  it("a person-given --root is not duplicated and .karajan is not added", () => {
    expect(run(["scan", "--root", "/x"]).argv).toEqual(["scan", "--root", "/x"]);
    expect(run(["--root", "/x", "scan"]).argv).toEqual(["--root", "/x", "scan"]);
  });
  it("the default root goes before a `--` separator, never after it", () => {
    expect(run(["search", "--", "--help"]).argv).toEqual(["search", "--root", ".karajan", "--", "--help"]);
    expect(run(["search", "--", "--root", "x"]).argv).toEqual(["search", "--root", ".karajan", "--", "--root", "x"]);
    expect(run(["search", "--root", "/x", "--", "--help"]).argv).toEqual(["search", "--root", "/x", "--", "--help"]);
    expect(run(["scan"]).argv).toEqual(["scan", "--root", ".karajan"]);
  });
  it("a command atril does not have today still reaches atril", () => {
    expect(run(["future-command"]).argv).toEqual(["future-command", "--root", ".karajan"]);
  });
  it("no arguments runs atril with no arguments", () => {
    expect(run([]).argv).toEqual([]);
  });
  it("--help and -h go to atril, not to commander's help", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    const program = new Command().exitOverride();
    registerRolesSkills(program, { pkgVersion: "0.0.0" });
    const savedArgv = process.argv;
    for (const argv of [["catalog", "--help"], ["-h"], ["--help"]]) {
      atrilCommand.mockClear();
      atrilCommand.mockReturnValue(0);
      process.argv = ["node", "kj", "atril", ...argv];
      await program.parseAsync(process.argv);
      expect(atrilCommand).toHaveBeenCalledWith({ args: argv });
    }
    process.argv = savedArgv;
    exit.mockRestore();
  });
  it("rawAtrilArgs returns the raw tail after the first atril token", () => {
    expect(rawAtrilArgs(["node", "kj", "atril", "search", "--", "--help"])).toEqual(["search", "--", "--help"]);
    expect(rawAtrilArgs(["node", "kj", "atril"])).toEqual([]);
    expect(rawAtrilArgs(["node", "kj", "atril", "scan", "atril"])).toEqual(["scan", "atril"]);
  });
  it("the `--` separator reaches atril through the registration", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    const savedArgv = process.argv;
    process.argv = ["node", "kj", "atril", "search", "--", "--help"];
    try {
      const program = new Command().exitOverride();
      registerRolesSkills(program, { pkgVersion: "0.0.0" });
      atrilCommand.mockClear();
      atrilCommand.mockReturnValue(0);
      await program.parseAsync(process.argv);
      expect(atrilCommand).toHaveBeenCalledWith({ args: ["search", "--", "--help"] });
    } finally {
      process.argv = savedArgv;
      exit.mockRestore();
    }
  });
  describe("--version / -V (HU-4480)", () => {
    const kj = (...args) => spawnSync(process.execPath, ["src/cli.js", ...args], { encoding: "utf8", timeout: 60_000 });
    const atrilOwn = (flag) => spawnSync(process.execPath, ["node_modules/@karajan-family/atril/bin/atril.js", flag], { encoding: "utf8" });
    const kjVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

    it.each(["--version", "-V"])("kj atril %s prints atril's version and its exit code", (flag) => {
      const own = atrilOwn(flag);
      const res = kj("atril", flag);
      expect(res.stdout.trim()).not.toBe(kjVersion);
      expect(res.stdout).toBe(own.stdout);
      expect(res.status).toBe(own.status);
    });
    it.each(["--version", "-V"])("kj %s still prints kj's version", (flag) => {
      expect(kj(flag).stdout.trim()).toBe(kjVersion);
    });
    it("another command keeps its behaviour: kj skills --version is not atril's", () => {
      expect(kj("skills", "--version").stdout).not.toBe(atrilOwn("--version").stdout);
    });
  });
});
