// ADR 0041, plan step 13e: rulesync generate after a plugin wrote or removed .rulesync/ entries, only when the project opted in.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { generateAfter, requireRulesync } from "../src/plugin-generate.js";
import { hasEntries, mergeEntries } from "../src/rulesync-entries.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-plugin-generate-"));
  mkdirSync(join(dir, ".rulesync"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const on = () => writeConfig({ rulesync: { generate: true } }, o());
const recorder = () => {
  const calls = [];
  return { calls, run: (cmd, args) => calls.push(args) };
};

describe("generateAfter", () => {
  it("runs generate once when the option is on and entries changed", () => {
    on();
    const { calls, run } = recorder();
    expect(generateAfter(true, o(), run)).toMatch(/rulesync generate: done/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("generate");
  });

  it("prints the command and runs nothing when the option is off", () => {
    const { calls, run } = recorder();
    expect(generateAfter(true, o(), run)).toMatch(/run `rulesync generate --targets '\*' --features '\*'`/);
    expect(calls).toEqual([]);
  });

  it("says nothing and runs nothing for a plugin that wrote nothing", () => {
    on();
    const { calls, run } = recorder();
    expect(generateAfter(false, o(), run)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("names the command and says the entries stay when generate fails", () => {
    on();
    expect(() => generateAfter(true, o(), () => { throw new Error("boom"); })).toThrow(/rulesync generate failed \(boom\).*\.rulesync\/.*run it yourself/);
  });
});

describe("requireRulesync", () => {
  const absent = () => { throw new Error("not found"); };

  it("stops with a clear error when the option is on and rulesync is absent", () => {
    on();
    expect(() => requireRulesync(o(), absent)).toThrow(/rulesync.generate is true but rulesync is not installed; nothing was changed/);
  });

  it("passes when rulesync answers, or the option is off", () => {
    on();
    expect(() => requireRulesync(o(), () => "1.0.0")).not.toThrow();
    writeConfig({ rulesync: { generate: false } }, o());
    expect(() => requireRulesync(o(), absent)).not.toThrow();
  });
});

describe("hasEntries", () => {
  it("is true only for a plugin that owns entries in .rulesync/", () => {
    expect(hasEntries(dir, "demo")).toBe(false);
    mergeEntries(dir, "demo", { mcp: { mcpServers: { srv: { command: "x" } } } });
    expect(hasEntries(dir, "demo")).toBe(true);
    expect(hasEntries(dir, "other")).toBe(false);
  });
});
