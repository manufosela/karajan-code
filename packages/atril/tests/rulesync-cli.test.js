// ADR 0021 decision 11 / ADR 0022: one place resolves and runs the rulesync binary (project's own, else npx --no-install).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rulesyncCommand, runRulesync } from "../src/rulesync-cli.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-rulesync-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
// an empty, non-executable file is enough: rulesyncCommand only checks that it exists
const fakeBin = (root) => {
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "rulesync"), "");
  return join(root, "node_modules", ".bin", "rulesync");
};

describe("rulesyncCommand", () => {
  it("uses npx without installing when the project has no local binary", () => {
    expect(rulesyncCommand(dir, ["generate"])).toEqual(["npx", ["--no-install", "rulesync", "generate"]]);
  });

  it("uses the project's own binary when it exists", () => {
    const bin = fakeBin(dir);
    expect(rulesyncCommand(dir, ["generate"])).toEqual([bin, ["generate"]]);
  });
});

describe("runRulesync", () => {
  it("resolves the binary from projectDir, not from cwd, and returns what run returns", () => {
    const other = mkdtempSync(join(tmpdir(), "atril-rulesync-cwd-"));
    try {
      fakeBin(other);
      const calls = [];
      const run = (cmd, args, cwd) => {
        calls.push({ cmd, args, cwd });
        return "out";
      };
      expect(runRulesync(["import"], { projectDir: dir, cwd: other }, run)).toBe("out");
      expect(calls).toEqual([{ cmd: "npx", args: ["--no-install", "rulesync", "import"], cwd: other }]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("uses the binary found in projectDir and runs it in cwd", () => {
    const bin = fakeBin(dir);
    const calls = [];
    runRulesync(["import"], { projectDir: dir, cwd: tmpdir() }, (cmd, args, cwd) => calls.push({ cmd, args, cwd }));
    expect(calls).toEqual([{ cmd: bin, args: ["import"], cwd: tmpdir() }]);
  });

  it("defaults cwd to projectDir", () => {
    const cwds = [];
    runRulesync(["generate"], { projectDir: dir }, (_cmd, _args, cwd) => cwds.push(cwd));
    expect(cwds).toEqual([dir]);
  });

  it("lets errors propagate", () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(() => runRulesync(["generate"], { projectDir: dir }, boom)).toThrow("boom");
  });
});
