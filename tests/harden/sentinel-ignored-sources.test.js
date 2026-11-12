// HU-4092 (#4089): the sources the Stop gate judges leave out what git ignores. The rule is
// tested on its own function, with the changed files and the git ignore check injected: no
// hook, no harness, no real path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { notIgnored } from "../../src/harden/sentinel/sentinel-lib.mjs";

describe("notIgnored — sources that owe a test", () => {
  const ignoring = (...names) => (files) => files.filter((f) => names.includes(f));

  it("an ignored file does not count", () => {
    expect(notIgnored(["src/gen.js"], "/repo", ignoring("src/gen.js"))).toEqual([]);
  });

  it("a source git does not ignore still counts", () => {
    expect(notIgnored(["src/a.js"], "/repo", ignoring())).toEqual(["src/a.js"]);
  });

  it("only the ignored one drops out of a mix", () => {
    expect(notIgnored(["src/a.js", "src/gen.js"], "/repo", ignoring("src/gen.js"))).toEqual(["src/a.js"]);
  });

  it("asks git with the files and the tree it was given", () => {
    const calls = [];
    notIgnored(["src/a.js"], "/repo", (files, top) => { calls.push([files, top]); return []; });
    expect(calls).toEqual([[["src/a.js"], "/repo"]]);
  });
  it("with real git, drops an ignored file and keeps the rest (git itself answers)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-ignored-"));
    try {
      spawnSync("git", ["init", "-q", dir]);
      fs.writeFileSync(path.join(dir, ".gitignore"), "src/gen.js\n");
      expect(notIgnored(["src/gen.js", "src/a.js"], dir)).toEqual(["src/a.js"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
