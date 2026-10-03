// KJC-TSK-0916 (SNT-B, ADR 0014): the discard guard as a real module, tested by
// unit: what a git command would discard, and what of it the session did not own.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { discardOf, foreignLost } from "../../src/harden/sentinel/sentinel-discard.mjs";

let root;
const w = (cmd) => cmd.split(" ");
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kj-discard-mod-")));
  fs.writeFileSync(path.join(root, "a.js"), "a\n");
  execSync("git init -q -b main && git add -A && git commit -q -m init", { cwd: root, env: { ...process.env, ...gitEnv } });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("discardOf", () => {
  it("names what each discard form throws away", () => {
    expect(discardOf(w("git checkout -- a.js"), root)).toEqual({ cwd: root, paths: ["a.js"] });
    expect(discardOf(w("git reset --hard"), root)).toEqual({ cwd: root, paths: [":/"] });
    expect(discardOf(w("git stash drop"), root)).toEqual({ cwd: root, stash: true });
    expect(discardOf(w("git clean -fd"), root)).toMatchObject({ clean: [["-fd"], []] });
  });

  it("returns null for what discards nothing, and unknown for what it cannot read", () => {
    for (const cmd of ["git checkout main", "git checkout -b x", "git restore --staged a.js", "git clean -n", "echo git checkout"]) expect(discardOf(w(cmd), root), cmd).toBeNull();
    for (const cmd of ["git --git-dir .git checkout -- a.js", "$g checkout -- a.js", "git clean -i"]) expect(discardOf(w(cmd), root), cmd).toEqual({ unknown: true });
  });
});

describe("foreignLost", () => {
  it("lists the user's dirty files, never the ones the session found clean", () => {
    fs.writeFileSync(path.join(root, "a.js"), "changed\n");
    const d = discardOf(w("git checkout -- a.js"), root);
    expect(foreignLost(d, {}, root)).toEqual(["a.js"]);
    expect(foreignLost(d, { "a.js": "clean" }, root)).toEqual([]);
    expect(foreignLost(d, { "a.js": "dirty" }, root)).toEqual(["a.js"]);
  });

  it("fails closed on stash, unknown and paths git does not know", () => {
    expect(foreignLost({ stash: true }, {}, root)).toEqual(["git stash"]);
    expect(foreignLost({ unknown: true }, {}, root)).toHaveLength(1);
    expect(foreignLost({ cwd: root, paths: ["$F"] }, {}, root)).toHaveLength(1);
  });

  it("asks git clean -n what an untracked clean would remove", () => {
    fs.writeFileSync(path.join(root, "draft.md"), "user\n");
    expect(foreignLost(discardOf(w("git clean -f"), root), {}, root)).toEqual(["draft.md"]);
    expect(foreignLost(discardOf(w("git clean -f"), root), { "draft.md": "clean" }, root)).toEqual([]);
  });
});
