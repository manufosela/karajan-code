// HU-0003 (ADR 0022, decision 3): `kj rulesync adopt|release <key>` settle a
// ledger entry edited by hand: adopt takes its current content as kj's,
// release hands it to the user for good (kj no longer claims it).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGuidelines } from "../../src/harden/guidelines-engine.js";
import { registerMeta } from "../../src/cli/register-meta.js";
import { RULESYNC_RULE, settleRulesyncEntry } from "../../src/utils/rulesync.js";
import { readLedger, withLedger } from "../../src/utils/rulesync-ledger.js";

let dir;
const key = "rules/karajan.md#guidelines";
const rule = () => join(dir, RULESYNC_RULE);
const install = () => installGuidelines({ projectDir: dir, language: "javascript" });
const editBlock = () => {
  const edited = readFileSync(rule(), "utf8").replace(/(>>> kj:managed:guidelines v\d+ >>>[^\n]*\n)/, "$1- my own line\n");
  writeFileSync(rule(), edited);
  return edited;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-rulesync-settle-"));
  mkdirSync(join(dir, ".rulesync"));
  install();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kj rulesync adopt|release", () => {
  it("adopt after a hand edit records the current block as kj's, and the next write succeeds", () => {
    editBlock();
    expect(() => install()).toThrow(/edited by hand.*kj rulesync adopt rules\/karajan\.md#guidelines.*kj rulesync release/);
    const before = readLedger(dir).entries[key].hash;
    const res = settleRulesyncEntry({ projectDir: dir, key, action: "adopt" });
    expect(res).toMatchObject({ key, owner: "kj" });
    expect(res.hash).not.toBe(before);
    expect(() => install()).not.toThrow();
  });

  it("release hands the entry to the user: kj then refuses to touch it, marker or not, until adopted again", () => {
    const edited = editBlock();
    expect(settleRulesyncEntry({ projectDir: dir, key, action: "release" })).toMatchObject({ key, owner: "user" });
    expect(() => install()).toThrow(/rules\/karajan\.md#guidelines.*belongs to user.*kj rulesync adopt/);
    expect(readFileSync(rule(), "utf8")).toBe(edited);
    settleRulesyncEntry({ projectDir: dir, key, action: "adopt" });
    expect(() => install()).not.toThrow();
  });

  it.each(["adopt", "release"])("%s on a key owned by another writer fails naming the owner", (action) => {
    withLedger(dir, "atril", (l) => { l.entries["mcp:atril"] = { owner: "atril", hash: `sha256:${"0".repeat(64)}` }; });
    expect(() => settleRulesyncEntry({ projectDir: dir, key: "mcp:atril", action })).toThrow(/mcp:atril.*owned by atril/);
  });

  it.each(["adopt", "release"])("%s on an unknown key fails saying it has no owner", (action) => {
    expect(() => settleRulesyncEntry({ projectDir: dir, key: "rules/nope.md", action })).toThrow(/rules\/nope\.md.*no owner/);
  });

  it("release of an entry already the user's fails naming the owner", () => {
    settleRulesyncEntry({ projectDir: dir, key, action: "release" });
    expect(() => settleRulesyncEntry({ projectDir: dir, key, action: "release" })).toThrow(/owned by user/);
  });

  it("both commands offer --json", () => {
    const program = new Command();
    registerMeta(program, { pkgVersion: "0.0.0-test" });
    const rulesync = program.commands.find((c) => c.name() === "rulesync");
    for (const name of ["adopt", "release"]) {
      const cmd = rulesync.commands.find((c) => c.name() === name);
      expect(cmd.options.map((o) => o.long)).toContain("--json");
    }
  });
});
