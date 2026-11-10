// HU-3727 — a corrupt or malformed privacy.yml must fail loud, never read as "no file".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPrivacyList } from "../../src/privacy/scan.js";
import { privacyScanCommand } from "../../src/commands/privacy.js";

let home;
const write = (yml) => writeFileSync(join(home, ".karajan", "privacy.yml"), yml);
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kj-priv-bad-"));
  mkdirSync(join(home, ".karajan"), { recursive: true });
});
afterEach(() => {
  delete process.env.KJ_PRIVACY_CONFIG;
  process.exitCode = undefined;
  rmSync(home, { recursive: true, force: true });
});

describe("loadPrivacyList fails loud on a bad privacy.yml", () => {
  it("a missing file still reads as absent", () => {
    expect(loadPrivacyList({ home: join(home, "nope") })).toEqual({ personal: [], allow: [], present: false });
  });
  it("invalid YAML throws naming the file", () => {
    write("personal: [unclosed\n  - : :\n");
    expect(() => loadPrivacyList({ home })).toThrow(/privacy\.yml.*(invalid|YAML)/is);
  });
  it("personal that is not a list throws", () => {
    write('personal: "text"\n');
    expect(() => loadPrivacyList({ home })).toThrow(/privacy\.yml.*personal.*list/is);
  });
  it("allow that is not a list throws", () => {
    write("allow: 5\n");
    expect(() => loadPrivacyList({ home })).toThrow(/privacy\.yml.*allow.*list/is);
  });
  it.each(["personal - secret@example.com\n", "- a\n- b\n"])("a scalar or sequence document throws: %j", (yml) => {
    write(yml);
    expect(() => loadPrivacyList({ home })).toThrow(/privacy\.yml.*mapping/is);
  });
  it("a read error other than ENOENT throws (the path is a directory)", () => {
    process.env.KJ_PRIVACY_CONFIG = home;
    expect(() => loadPrivacyList({ home })).toThrow(/privacy\.yml|cannot read/i);
  });
  it("a valid list, an empty file and null keys are unchanged", () => {
    write("personal:\n  - ' a '\nallow:\n");
    expect(loadPrivacyList({ home })).toEqual({ personal: ["a"], allow: [], present: true });
    write("");
    expect(loadPrivacyList({ home })).toEqual({ personal: [], allow: [], present: true });
  });
});

describe("kj privacy scan with a malformed privacy.yml", () => {
  it("exits non-zero with the error instead of the 'no denylist' hint", async () => {
    write('personal: "text"\n');
    process.env.KJ_PRIVACY_CONFIG = join(home, ".karajan", "privacy.yml");
    const errors = [];
    const logger = { error: (m) => errors.push(m), info: (m) => errors.push(m), warn: () => {} };
    const res = await privacyScanCommand({ paths: [home], logger });
    expect(res.ok).toBe(false);
    expect(process.exitCode).toBe(2);
    expect(errors.join("\n")).toMatch(/personal.*list/i);
    expect(errors.join("\n")).not.toMatch(/no personal denylist/);
  });
});
