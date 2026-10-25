// KJC-TSK-1202 (ADR 0030, step 3): the Sentinel lib finds the project wherever it runs.
// Installed under <project>/.karajan/harness it sits two levels below the root, as
// always; run from the kj package, the project is the one the host names
// (CLAUDE_PROJECT_DIR) or the working directory, at its git root.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("../../src/harden/sentinel/sentinel-lib.mjs", import.meta.url));
const PROBE = 'const m = await import(process.argv[1]); if (process.argv[2] === "save") m.save({ probe: 1 }); console.log(JSON.stringify({ root: m.ROOT, state: m.STATE }));';

const probe = (lib, { cwd, env = {}, save = false }) => {
  const clean = { ...process.env };
  delete clean.CLAUDE_PROJECT_DIR;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", PROBE, lib, save ? "save" : ""], { cwd, env: { ...clean, ...env }, encoding: "utf8" });
  return JSON.parse(out.trim());
};

describe("sentinel lib project root", () => {
  let tmp;
  let repo;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-root-")));
    repo = path.join(tmp, "repo");
    fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("installed in .karajan/harness, the project is two levels up, whatever the cwd", () => {
    const harness = path.join(repo, ".karajan", "harness");
    fs.mkdirSync(harness, { recursive: true });
    fs.copyFileSync(LIB, path.join(harness, "sentinel-lib.mjs"));
    const got = probe(path.join(harness, "sentinel-lib.mjs"), { cwd: tmp });
    expect(got.root).toBe(repo);
    expect(got.state).toBe(path.join(harness, "sentinel-state.json"));
  });

  it("run from the package, the project is the git root of CLAUDE_PROJECT_DIR", () => {
    const got = probe(LIB, { cwd: tmp, env: { CLAUDE_PROJECT_DIR: path.join(repo, "sub") } });
    expect(got.root).toBe(repo);
    expect(got.state).toBe(path.join(repo, ".karajan", "harness", "sentinel-state.json"));
  });

  it("run from the package with no host variable, the project is the git root of the cwd", () => {
    expect(probe(LIB, { cwd: path.join(repo, "sub") }).root).toBe(repo);
  });

  it("saving state in a project without a harness directory creates it", () => {
    probe(LIB, { cwd: repo, save: true });
    expect(JSON.parse(fs.readFileSync(path.join(repo, ".karajan", "harness", "sentinel-state.json"), "utf8"))).toEqual({ probe: 1 });
  });
});
