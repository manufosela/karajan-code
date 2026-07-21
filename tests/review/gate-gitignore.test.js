// KJC-TSK-0646: `kj review --install-gate` must leave the v4 contract
// TRACKABLE. Three field reproductions: a `.karajan/` dir-exclude in
// .gitignore silently keeps the marker and hooks out of git (git cannot
// re-include children of an excluded directory), so teammates never
// inherit the gate. install-gate now rewrites the pattern itself.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureGateTrackable } from "../../src/review/gate-gitignore.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-gi-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function ignored(relPath) {
  // git check-ignore exits 0 when the path IS ignored, 1 when it is not.
  try { execFileSync("git", ["check-ignore", "-q", relPath], { cwd: dir }); return true; } catch { return false; }
}

describe("ensureGateTrackable", () => {
  it("rewrites a dir-exclude `.karajan/` so the contract is trackable", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.karajan/\n*.log\n");
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(true);
    expect(ignored(".karajan/review-gate")).toBe(false);
    expect(ignored(".karajan/hooks/pre-commit")).toBe(false);
    expect(ignored(".karajan/reviews/x.json")).toBe(true); // volatile stays ignored
    const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(text).toContain("node_modules/"); // rest of the file untouched
    expect(text).toContain("*.log");
  });

  it("no .karajan mention → nothing to do", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "dist/\n");
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("dist/\n");
  });

  it("idempotent: a second run changes nothing", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/\n");
    await ensureGateTrackable(dir);
    const once = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(once);
  });

  it("no .gitignore at all → nothing to do", async () => {
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(false);
  });

  it("duplicate root excludes later in the file are removed (last match wins in gitignore)", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/\ndist/\n.karajan/*\n");
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(true);
    expect(ignored(".karajan/review-gate")).toBe(false);
    expect(ignored(".karajan/hooks/pre-commit")).toBe(false);
    const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(text.match(/^\.karajan\/\*$/gm)).toHaveLength(1);
    expect(text).toContain("dist/");
  });

  it("a partial hand-written contract is completed, not silently accepted", async () => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".karajan/*\n!.karajan/review-gate\n");
    const res = await ensureGateTrackable(dir);
    expect(res.changed).toBe(true);
    expect(ignored(".karajan/hooks/pre-commit")).toBe(false);
    // exactly one coherent block — no duplicated re-includes
    const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    expect(text.match(/!\.karajan\/review-gate/g)).toHaveLength(1);
  });
});
