// KJC-BUG-0523 (#3623): a state written by an older harness can still hold a source
// outside the repository. The Stop gate judges only the recorded paths inside it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB = fileURLToPath(new URL("../../src/harden/sentinel/sentinel-lib.mjs", import.meta.url));
const PROBE = "const m = await import(process.argv[1]); const a = JSON.parse(process.argv[2]);"
  + " console.log(JSON.stringify(a.fn === 'inside' ? a.rels.map(m.insideRepo) : m.violations(a.s, a.branch, [], a.top)));";
const probe = (cwd, args) => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", PROBE, LIB, JSON.stringify(args)], { cwd, encoding: "utf8" }).trim());

describe("Stop gate and sources outside the repository — KJC-BUG-0523", () => {
  let repo;
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const judge = (sources) => probe(repo, { fn: "violations", s: { edited_sources: sources, edited_tests: [] }, branch: "feat/KJC-TSK-0001-x", top: repo });

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-sentinel-outside-")));
    git("init", "-q", "-b", "main");
    fs.mkdirSync(path.join(repo, "src"));
    fs.writeFileSync(path.join(repo, "src", "a.js"), "export const a = 1;\n");
    git("add", "src/a.js");
    git("commit", "-qm", "base");
    git("switch", "-qc", "feat/KJC-TSK-0001-x");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("a session whose only recorded source is outside has no source violation", () => {
    expect(judge(["../../../../tmp/x/script.sh"])).toEqual([]);
  });

  it("a source on another Windows drive, as the normalized relative path records it, is outside too", () => {
    expect(judge(["C:/temp/file.js"])).toEqual([]);
  });

  it("an inside source still owes its test, and the message names only it", () => {
    fs.appendFileSync(path.join(repo, "src", "a.js"), "export const b = 2;\n");
    const v = judge(["../../../../tmp/x/script.sh", "src/a.js"]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("sin tocar un solo test (src/a.js)");
  });

  it("insideRepo applies the posttooluse rule", () => {
    expect(probe(repo, { fn: "inside", rels: ["src/a.js", "", "..", "../x", "/abs", "C:/temp/file.js"] })).toEqual([true, false, false, false, false, false]);
  });
});
