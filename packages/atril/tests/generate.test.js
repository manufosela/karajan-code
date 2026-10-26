// ADR 0021, decision 11 and plan step 9c: atril sync --check for CI, and rulesync generate
// with ADR 0022's canonical arguments, only when atril.json opts in.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { generate } from "../src/generate.js";
import { sync } from "../src/sync.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const ARGS = ["generate", "--targets", "*", "--features", "*"];
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-generate-"));
  mkdirSync(join(dir, ".rulesync"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const atril = (...args) => spawnSync(process.execPath, [BIN, ...args, "--root", "store"], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "nu") } });
const recorder = () => {
  const calls = [];
  return { calls, run: (cmd, args, cwd) => calls.push({ cmd, args, cwd }) };
};

describe("atril sync --check", () => {
  it("judges without writing, and fails while a piece is out of date", () => {
    expect(sync({ ...o(), check: true }).map(({ action }) => action)).toEqual(["written", "written"]);
    expect(existsSync(join(dir, ".rulesync", "commands"))).toBe(false);
    const res = atril("sync", "--check");
    expect([res.status, res.stdout]).toEqual([1, "written\tcommands/atril.md\nwritten\trules/atril-router.md\n"]);
    expect(res.stderr).toMatch(/2 piece\(s\) out of date: run atril sync/);
    sync(o());
    expect(atril("sync", "--check").status).toBe(0);
  });
});

describe("rulesync generate", () => {
  it("does not run unless atril.json opts in, and the CLI says how to reach the agents", () => {
    const { calls, run } = recorder();
    expect(generate(o(), run)).toBe(false);
    expect(calls).toEqual([]);
    expect(atril("sync").stderr).toMatch(/rulesync generate.*rulesync\.generate: true/);
  });

  it("runs with the canonical arguments: the project's own binary, else npx without installing", () => {
    writeConfig({ rulesync: { generate: true } }, o());
    const { calls, run } = recorder();
    expect(generate(o(), run)).toBe(true);
    expect(calls).toEqual([{ cmd: "npx", args: ["--no-install", "rulesync", ...ARGS], cwd: dir }]);
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".bin", "rulesync"), "");
    generate(o(), run);
    expect(calls[1]).toEqual({ cmd: join(dir, "node_modules", ".bin", "rulesync"), args: ARGS, cwd: dir });
  });

  it("fails loudly when rulesync generate fails", () => {
    writeConfig({ rulesync: { generate: true } }, o());
    expect(() => generate(o(), () => { throw new Error("boom"); })).toThrow(/rulesync generate failed \(boom\)/);
  });
});
