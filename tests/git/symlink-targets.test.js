// KJC-BUG-0414 (#2606, from #2564): Solomon told the coder to drop .karajan/adrs/0009-*.md from
// the commit as a mirror of docs/adr/0009-*.md, but docs/adr/*.md were symlinks to it: the link
// would be committed dangling and the ADR lost. A symlink's target in the change stays in it.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keepSymlinkTargets, symlinkTargets } from "../../src/git/symlink-targets.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-symlink-"));
  mkdirSync(join(dir, ".karajan", "adrs"), { recursive: true });
  mkdirSync(join(dir, "docs", "adr"), { recursive: true });
  writeFileSync(join(dir, ".karajan", "adrs", "0009-x.md"), "# x\n");
  symlinkSync("../../.karajan/adrs/0009-x.md", join(dir, "docs", "adr", "0009-x.md"));
  symlinkSync("/etc/hosts", join(dir, "outside"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("symlinkTargets", () => {
  it("lists the in-repo target of each symlink among the paths, and nothing else", () => {
    expect(symlinkTargets(dir, ["docs/adr/0009-x.md", ".karajan/adrs/0009-x.md", "outside", "gone.md"]))
      .toEqual([{ link: "docs/adr/0009-x.md", target: ".karajan/adrs/0009-x.md" }]);
  });
});

describe("keepSymlinkTargets", () => {
  const targets = [{ link: "docs/adr/0009-x.md", target: ".karajan/adrs/0009-x.md" }];
  it("drops a condition that takes a symlink's target out of the commit, by path or by glob", () => {
    const conditions = [
      "Unstage .karajan/adrs/0009-*.md: it is a harness artifact that only mirrors docs/adr/0009-*.md",
      "git restore --staged .karajan/adrs/0009-x.md",
      "Fix the typo in .karajan/adrs/0009-x.md",
      "Add a test for src/a.js",
    ];
    const { kept, dropped } = keepSymlinkTargets(conditions, targets);
    expect(dropped).toEqual(conditions.slice(0, 2));
    expect(kept).toEqual(conditions.slice(2));
  });
  it("recognizes targets with any character git allows, quoted or not, and in-repo dirs that start with dots", () => {
    mkdirSync(join(dir, "..generated", "my docs"), { recursive: true });
    writeFileSync(join(dir, "..generated", "my docs", "adr@1 ñ.md"), "x\n");
    symlinkSync("../..generated/my docs/adr@1 ñ.md", join(dir, "docs", "odd.md"));
    const odd = symlinkTargets(dir, ["docs/odd.md"]);
    expect(odd).toEqual([{ link: "docs/odd.md", target: "..generated/my docs/adr@1 ñ.md" }]);
    const conditions = ['Remove "..generated/my docs/adr@1 ñ.md" from the commit', "git rm --cached '..generated/my docs/adr@*.md'"];
    expect(keepSymlinkTargets(conditions, odd).dropped).toEqual(conditions);
  });
  it("keeps every condition when the change has no symlink", () => {
    expect(keepSymlinkTargets(["Remove .karajan/adrs/0009-x.md"], [])).toEqual({ kept: ["Remove .karajan/adrs/0009-x.md"], dropped: [] });
  });
});
