// HU-2677 (ADR 0021, decision 10, plan step 10a1): atril.lock.json records
// what entered the store; reading never writes and a broken file fails loudly.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash, forgetInstall, LOCK_FILE, readLock, recordInstall, recordPlugin, writeLock } from "../src/lock.js";
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-lock-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store" });
const lockFile = () => join(dir, "store", LOCK_FILE);
const write = (rel, text) => {
  const file = join(dir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};
const HASH = `sha256:${"a".repeat(64)}`;
const withEntry = (fields, key = "skill:tdd") => ({ version: 1, artifacts: { [key]: { origin: "local", hash: HASH, ...fields } } });
const withPlugin = (fields) => ({ version: 1, artifacts: {}, plugins: { kit: { entries: ["skill:kit__tdd"], ...fields } } });
const skill = (extra = "") => write("s/SKILL.md", `---\nname: tdd\ndescription: d\nkind: skill\n${extra}---\nbody\n`);
describe("readLock", () => {
  it("reads an absent file as an empty lock without writing it", () => {
    expect(readLock(o())).toEqual({ version: 1, artifacts: {} });
    expect(existsSync(lockFile())).toBe(false);
  });
  it.each([
    ["not json", "{", /atril\.lock\.json: invalid JSON/],
    ["an unknown version", { version: 2, artifacts: {} }, /version/],
    ["a key that is not kind:slug", withEntry({}, "tdd"), /"tdd"/],
    ["a key with two colons", withEntry({}, "skill:a:b"), /"skill:a:b"/],
    ["an unknown field", withEntry({ installedAt: "x" }), /skill:tdd.*installedAt/],
    ["a non-string source", withEntry({ source: 5 }), /skill:tdd.*source/],
    ["an unknown origin", withEntry({ origin: "web" }), /skill:tdd.*origin/],
    ["a bad hash", withEntry({ hash: "abc" }), /skill:tdd.*hash/],
    ["a bad commit", withEntry({ commit: "abc" }), /skill:tdd.*commit/],
    ["a plugin origin with no plugin name", withEntry({ origin: "plugin" }), /skill:tdd.*plugin/],
    ["a plugins section that is not a mapping", { version: 1, artifacts: {}, plugins: [] }, /plugins/],
    ["a plugin entry with an unknown field", withPlugin({ installedAt: "x" }), /plugin "kit".*installedAt/],
    ["a plugin entry whose entries are not refs", withPlugin({ entries: ["tdd"] }), /plugin "kit".*entries/],
    ["a plugin entry with a bad commit", withPlugin({ commit: "abc" }), /plugin "kit".*commit/],
  ])("fails naming the file and the entry on %s", (_why, content, message) => {
    write("store/atril.lock.json", typeof content === "string" ? content : JSON.stringify(content));
    expect(() => readLock(o())).toThrow(message);
    expect(() => readLock(o())).toThrow(lockFile());
  });
});
describe("plugins", () => {
  const entry = { catalog: "kits", source: "github:o/r", commit: "a".repeat(40), version: "1.0.0", entries: ["skill:kit__tdd"] };
  it("records a plugin under plugins and its artifacts with origin plugin, and an old lock gains no section", () => {
    recordInstall({ kind: "skill", name: "kit__tdd", path: dirname(skill()) }, { origin: "plugin", plugin: "kit" }, o());
    expect(readLock(o())).not.toHaveProperty("plugins");
    recordPlugin("kit", entry, o());
    expect(readLock(o()).plugins).toEqual({ kit: entry });
    expect(readLock(o()).artifacts["skill:kit__tdd"]).toMatchObject({ origin: "plugin", plugin: "kit" });
  });
});
describe("writeLock", () => {
  it("writes sorted keys, two-space indent and a trailing newline", () => {
    writeLock({ version: 1, artifacts: { "skill:b": { origin: "local", hash: HASH }, "agent:a": { hash: HASH, origin: "local" } } }, o());
    const text = readFileSync(lockFile(), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(text).artifacts)).toEqual(["agent:a", "skill:b"]);
    expect(text).toContain('\n  "artifacts": {');
    expect(readLock(o()).artifacts["agent:a"]).toEqual({ hash: HASH, origin: "local" });
  });
});
describe("recordInstall and forgetInstall", () => {
  it("records an entry with the origin fields and the folder hash, and forgets it", () => {
    const path = dirname(skill());
    recordInstall({ kind: "skill", name: "tdd", path }, { origin: "import", from: "openskills" }, o());
    expect(readLock(o()).artifacts["skill:tdd"]).toEqual({ origin: "import", from: "openskills", hash: contentHash(path, "skill") });
    forgetInstall("skill:tdd", o());
    expect(readLock(o()).artifacts).toEqual({});
    expect(() => forgetInstall("skill:tdd", o())).not.toThrow();
  });
});
describe("contentHash", () => {
  it("changes when a script in a skill folder changes", () => {
    const folder = dirname(skill());
    const before = contentHash(folder, "skill");
    write("s/run.sh", "echo hi");
    const withScript = contentHash(folder, "skill");
    write("s/run.sh", "echo bye");
    expect(withScript).not.toBe(before);
    expect(contentHash(folder, "skill")).not.toBe(withScript);
  });
  it("fails loudly on a symlink inside a skill folder", () => {
    const folder = dirname(skill());
    symlinkSync(write("outside.sh", "x"), join(folder, "run.sh"));
    expect(() => contentHash(folder, "skill")).toThrow(/run\.sh: a skill may not hold symlinks/);
  });
  it("ignores the atril: block, so enrichment is not an edit", () => {
    const plain = contentHash(dirname(skill()), "skill");
    const enriched = contentHash(dirname(skill("atril:\n  tags: [x]\n")), "skill");
    expect(enriched).toBe(plain);
  });
});
