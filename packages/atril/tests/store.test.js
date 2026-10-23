// HU-0021 (ADR 0021, decision 5 and plan step 7): install and remove put
// artifacts in the store and take them out, never silently overwriting.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { install, remove } from "../src/store.js";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-store-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const write = (rel, text) => {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};
const artifact = (rel, kind, name, body = "body") =>
  write(rel, `---\nname: ${name}\ndescription: d\nkind: ${kind}\n---\n${body}\n`);
const o = () => ({ projectDir: dir, root: "store" });
const at = (...parts) => join(dir, "store", ...parts);

describe("install", () => {
  it("copies a skill folder with its files into skills/<name>/", () => {
    const src = dirname(artifact("src/tdd/SKILL.md", "skill", "tdd"));
    write("src/tdd/refs/notes.md", "notes");
    expect(install(src, o())).toMatchObject({ kind: "skill", name: "tdd", status: "installed", path: at("skills", "tdd") });
    expect(readFileSync(at("skills", "tdd", "refs", "notes.md"), "utf8")).toBe("notes");
    expect(existsSync(at("skills", "tdd", "SKILL.md"))).toBe(true);
  });
  it("copies a command and an agent file into commands/ and agents/", () => {
    install(artifact("src/review.md", "command", "review"), o());
    install(artifact("src/tester.md", "agent", "tester"), { ...o(), kind: "agent" });
    expect(readdirSync(at("commands"))).toEqual(["review.md"]);
    expect(readdirSync(at("agents"))).toEqual(["tester.md"]);
  });
  it("refuses an invalid artifact or a kind mismatch and leaves the store untouched", () => {
    expect(() => install(write("src/bad.md", "no frontmatter"), o())).toThrow(/no frontmatter/);
    expect(() => install(artifact("src/x.md", "command", "x"), { ...o(), kind: "agent" })).toThrow(/declares kind command, not agent/);
    expect(() => install(artifact("src/s.md", "skill", "s"), o())).toThrow(/a skill must be a folder/);
    expect(() => install(join(dir, "src"), o())).toThrow(/needs a SKILL.md/);
    expect(() => install(join(dir, "missing.md"), o())).toThrow(/does not exist/);
    expect(existsSync(at())).toBe(false);
  });
  it("refuses different content over an existing artifact; the same content is a no-op", () => {
    const src = artifact("src/review.md", "command", "review");
    install(src, o());
    expect(install(src, o()).status).toBe("unchanged");
    const other = artifact("other/review.md", "command", "review", "changed");
    expect(() => install(other, o())).toThrow(/command:review already exists .* different content/);
    expect(readFileSync(at("commands", "review.md"), "utf8")).toMatch(/\nbody\n/);
  });
  it("compares every file of a skill folder", () => {
    const src = dirname(artifact("src/tdd/SKILL.md", "skill", "tdd"));
    install(src, o());
    write("src/tdd/extra.md", "new");
    expect(() => install(src, o())).toThrow(/skill:tdd already exists/);
  });
  it("refuses a skill holding a symlink and leaves the store untouched", () => {
    const src = dirname(artifact("src/tdd/SKILL.md", "skill", "tdd"));
    symlinkSync(write("outside.md", "outside"), join(src, "refs-link.md"));
    expect(() => install(src, o())).toThrow(/refs-link.md: a skill may not hold symlinks/);
    expect(existsSync(at())).toBe(false);
  });
  // KJC-TSK-1129 (review of #2311): cpSync keeps a symlink source as a link, so the source itself may not be one.
  it("refuses a symlink as the artifact file or the skill folder and leaves the store untouched", () => {
    const cmd = artifact("src/review.md", "command", "review");
    symlinkSync(cmd, join(dir, "review-link.md"));
    const folder = dirname(artifact("src/tdd/SKILL.md", "skill", "tdd"));
    symlinkSync(folder, join(dir, "tdd-link"));
    expect(() => install(join(dir, "review-link.md"), o())).toThrow(/review-link.md: an artifact may not be a symlink/);
    expect(() => install(join(dir, "tdd-link"), o())).toThrow(/tdd-link: an artifact may not be a symlink/);
    expect(existsSync(at())).toBe(false);
  });
});

describe("remove", () => {
  it("deletes an installed skill, command and agent", () => {
    install(dirname(artifact("src/tdd/SKILL.md", "skill", "tdd")), o());
    install(artifact("src/tester.md", "agent", "tester"), o());
    expect(remove("tester", { ...o(), kind: "agent" }).path).toBe(at("agents", "tester.md"));
    install(artifact("src/review.md", "command", "review"), o());
    expect(remove("tdd", { ...o(), kind: "skill" })).toMatchObject({ kind: "skill", name: "tdd" });
    remove("review", { ...o(), kind: "command" });
    expect(existsSync(at("skills", "tdd"))).toBe(false);
    expect(existsSync(at("commands", "review.md"))).toBe(false);
  });
  it("fails loudly on an unknown artifact, kind or name", () => {
    expect(() => remove("ghost", { ...o(), kind: "agent" })).toThrow(/agent:ghost is not installed/);
    expect(() => remove("x", { ...o(), kind: "plugin" })).toThrow(/kind "plugin"/);
    expect(() => remove("../x", { ...o(), kind: "agent" })).toThrow(/not a slug/);
  });
});
