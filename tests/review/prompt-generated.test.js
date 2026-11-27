// HU-4976: the reviewer prompt summarizes only what the BASE branch marks
// linguist-generated, never code or AI-rule files: a diff cannot hide itself.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generatedForPrompt } from "../../src/review/linguist-generated.js";

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { stdio: "pipe" });

/** A repo whose `base` branch commits `baseAttrs`; the diff then stages `diffAttrs`. */
function repo(baseAttrs, diffAttrs = baseAttrs) {
  const cwd = mkdtempSync(join(tmpdir(), "kj-prompt-generated-"));
  dirs.push(cwd);
  git(cwd, "init", "-q");
  writeFileSync(join(cwd, ".gitattributes"), baseAttrs);
  git(cwd, "add", ".gitattributes");
  git(cwd, "commit", "-q", "--no-verify", "-m", "base");
  git(cwd, "branch", "base");
  writeFileSync(join(cwd, ".gitattributes"), diffAttrs);
  git(cwd, "add", ".gitattributes");
  return cwd;
}

// `check-attr --source` needs git >= 2.40; an older git is the fail-closed path.
const hasSource = (() => {
  try {
    execFileSync("git", ["check-attr", "--source", "HEAD", "text", "--", "package.json"], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();

describe("generatedForPrompt", () => {
  it("asks git with the base tree as the source of the attributes", () => {
    const calls = [];
    const runner = (_cwd, args) => { calls.push(args); return "data/a.json\0linguist-generated\0set\0"; };
    expect(generatedForPrompt(["data/a.json"], { base: "origin/main", runner })).toEqual(["data/a.json"]);
    expect(calls).toEqual([["check-attr", "--source", "origin/main", "-z", "linguist-generated", "--", "data/a.json"]]);
  });

  it("never asks about code or AI-rule files, so they are never summarized", () => {
    const calls = [];
    const runner = (_cwd, args) => { calls.push(args); return ""; };
    const files = ["src/a.js", "ci.yml", "Dockerfile", "AGENTS.md", "packages/x/CLAUDE.md", "GEMINI.md", "templates/roles/coder.md"];
    expect(generatedForPrompt(files, { base: "origin/main", runner })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("summarizes nothing extra and warns once when git refuses --source", () => {
    const said = [];
    const runner = () => { throw new Error("error: unknown option `source'"); };
    const out = generatedForPrompt(["data/a.json", "data/b.csv"], { base: "origin/main", runner, warn: (m) => said.push(m) });
    expect(out).toEqual([]);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/check-attr failed.*source/);
  });

  it("summarizes nothing extra without a base ref", () => {
    const runner = () => { throw new Error("must not be called"); };
    expect(generatedForPrompt(["data/a.json"], { runner })).toEqual([]);
  });

  it.runIf(hasSource)("does not summarize a file marked only in the diff's .gitattributes", () => {
    const cwd = repo("", "data/** linguist-generated\n");
    expect(generatedForPrompt(["data/a.json"], { cwd, base: "base" })).toEqual([]);
  });

  it.runIf(hasSource)("summarizes the base-marked data file, never base-marked code or AI rules", () => {
    const cwd = repo("data/** linguist-generated\n*.js linguist-generated\nAGENTS.md linguist-generated\n", "");
    expect(generatedForPrompt(["data/a.json", "src/a.js", "AGENTS.md"], { cwd, base: "base" })).toEqual(["data/a.json"]);
  });

  it.runIf(!hasSource)("with a git without --source summarizes nothing extra", () => {
    const cwd = repo("data/** linguist-generated\n");
    expect(generatedForPrompt(["data/a.json"], { cwd, base: "base", warn: () => {} })).toEqual([]);
  });
});
