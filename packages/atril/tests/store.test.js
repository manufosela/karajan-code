// HU-0021 (ADR 0021, decision 5 and plan step 7): install and remove put
// artifacts in the store and take them out, never silently overwriting.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCK_FILE } from "../src/lock.js";
import { install, remove } from "../src/store.js";
const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
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
const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: "utf8" });

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
  it("replace swaps different content in; a failed copy keeps the old one", () => {
    install(artifact("src/review.md", "command", "review"), o());
    const other = artifact("other/review.md", "command", "review", "changed");
    expect(install(other, { ...o(), replace: true })).toMatchObject({ status: "installed", path: at("commands", "review.md") });
    expect(readFileSync(at("commands", "review.md"), "utf8")).toMatch(/\nchanged\n/);
    install(dirname(artifact("old/review/SKILL.md", "skill", "review")), o());
    const next = dirname(artifact("next/review/SKILL.md", "skill", "review", "new"));
    const unreadable = write("next/review/x.md", "x");
    chmodSync(unreadable, 0o000);
    expect(() => install(next, { ...o(), replace: true })).toThrow();
    chmodSync(unreadable, 0o644);
    expect(readFileSync(at("skills", "review", "SKILL.md"), "utf8")).toMatch(/\nbody\n/);
    expect(readdirSync(at("skills"))).toEqual(["review"]);
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

// HU-2677 (plan step 10a1): every install leaves a record in atril.lock.json.
describe("lockfile", () => {
  const lock = () => JSON.parse(readFileSync(at(LOCK_FILE), "utf8")).artifacts;
  it("records a local install with its hash and never the path", () => {
    install(dirname(artifact("src/tdd/SKILL.md", "skill", "tdd")), o());
    expect(lock()["skill:tdd"]).toEqual({ origin: "local", hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
    expect(readFileSync(at(LOCK_FILE), "utf8")).not.toContain(dir);
  });
  it("records the origin a caller passes and keeps an existing entry on an unchanged install", () => {
    const src = artifact("src/review.md", "command", "review");
    install(src, { ...o(), origin: { origin: "import", from: "openskills" } });
    install(src, o());
    expect(lock()["command:review"]).toMatchObject({ origin: "import", from: "openskills" });
  });
  it("records an unchanged install that has no entry yet", () => {
    const src = artifact("src/review.md", "command", "review");
    install(src, o());
    rmSync(at(LOCK_FILE));
    expect(install(src, o()).status).toBe("unchanged");
    expect(lock()["command:review"].origin).toBe("local");
  });
  it("remove deletes the entry; removing an artifact without one is fine", () => {
    install(artifact("src/review.md", "command", "review"), o());
    remove("review", { ...o(), kind: "command" });
    expect(lock()).toEqual({});
    install(artifact("src/tester.md", "agent", "tester"), o());
    rmSync(at(LOCK_FILE));
    expect(() => remove("tester", { ...o(), kind: "agent" })).not.toThrow();
  });
  it("a lock that cannot be updated fails the remove and keeps the artifact", () => {
    install(artifact("src/review.md", "command", "review"), o());
    writeFileSync(at(LOCK_FILE), "not json");
    expect(() => remove("review", { ...o(), kind: "command" })).toThrow();
    expect(existsSync(at("commands", "review.md"))).toBe(true);
    expect(readdirSync(at("commands"))).toEqual(["review.md"]);
  });
  it("an artifact that cannot be deleted fails the remove and keeps its lock entry", () => {
    install(artifact("src/review.md", "command", "review"), o());
    chmodSync(at("commands"), 0o500);
    try {
      expect(() => remove("review", { ...o(), kind: "command" })).toThrow();
      expect(lock()["command:review"]).toMatchObject({ origin: "local" });
    } finally {
      chmodSync(at("commands"), 0o700);
    }
    expect(existsSync(at("commands", "review.md"))).toBe(true);
  });
  it("a partial delete keeps the lock entry and a retry finishes the remove", () => {
    const src = dirname(artifact("src/tdd/SKILL.md", "skill", "tdd"));
    write("src/tdd/refs/notes.md", "notes");
    install(src, o());
    chmodSync(at("skills", "tdd", "refs"), 0o500);
    try {
      expect(() => remove("tdd", { ...o(), kind: "skill" })).toThrow();
      expect(lock()["skill:tdd"]).toBeDefined();
    } finally {
      chmodSync(at("skills", "tdd", "refs"), 0o700);
    }
    remove("tdd", { ...o(), kind: "skill" });
    expect(lock()).toEqual({});
    expect(existsSync(at("skills", "tdd"))).toBe(false);
  });
  it("remove clears a lock entry whose artifact is already gone", () => {
    install(artifact("src/review.md", "command", "review"), o());
    rmSync(at("commands", "review.md"));
    expect(() => remove("review", { ...o(), kind: "command" })).not.toThrow();
    expect(lock()).toEqual({});
  });
  it("a lock that cannot be written fails the install and leaves no artifact", () => {
    mkdirSync(at(LOCK_FILE), { recursive: true });
    expect(() => install(artifact("src/review.md", "command", "review"), o())).toThrow();
    expect(existsSync(at("commands", "review.md"))).toBe(false);
  });
});
describe("atril install / remove CLI", () => {
  it("installs a path and removes kind:name", () => {
    artifact("src/review.md", "command", "review");
    const installed = run("install", "src/review.md", "--root", "store");
    expect(installed.status).toBe(0);
    expect(installed.stdout).toMatch(/installed\tcommand:review/);
    expect(run("install", "src/review.md", "--root", "store", "--kind", "agent").stderr).toMatch(/not agent/);
    artifact("src/review.md", "command", "review", "changed");
    expect(run("install", "src/review.md", "--root", "store").status).toBe(1);
    expect(run("remove", "command:review", "--root", "store").status).toBe(0);
    expect(existsSync(at("commands", "review.md"))).toBe(false);
  });
  it("an unknown remove or a malformed ref fails with exit 1", () => {
    const unknown = run("remove", "agent:ghost", "--root", "store");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/agent:ghost is not installed/);
    expect(run("remove", "ghost", "--root", "store").stderr).toMatch(/kind:name/);
  });
});
