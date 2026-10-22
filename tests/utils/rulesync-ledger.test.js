// HU-0001 (ADR 0022, decision 3): the ownership ledger lets several writers
// (the user, kj, atril) share one .rulesync/ source without overwriting each
// other. It is versioned, written atomically under a lock, and the single
// source of hashes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashContent, hookKey, LEDGER_FILE, LOCK_FILE, mcpKey, permissionKey,
  readLedger, verifyEntry, withLedger,
} from "../../src/utils/rulesync-ledger.js";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kj-ledger-")); mkdirSync(join(dir, ".rulesync")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const ledgerPath = () => join(dir, LEDGER_FILE);

describe("keys", () => {
  it("name entries of single-file features as ADR 0022 says", () => {
    expect(mcpKey("github")).toBe("mcp:github");
    expect(permissionKey("Bash(git status)")).toBe("permissions:Bash(git status)");
    expect(hookKey("preToolUse", "atril/p/h1")).toBe("hooks:preToolUse:atril/p/h1");
  });
});

describe("readLedger", () => {
  it("an absent ledger is empty, version 1", () => {
    expect(readLedger(dir)).toEqual({ version: 1, entries: {} });
  });

  it("an unknown version fails loudly naming the file", () => {
    writeFileSync(ledgerPath(), JSON.stringify({ version: 2, entries: {} }));
    expect(() => readLedger(dir)).toThrow(/\.owners\.json.*version 2/);
  });

  it("garbage fails loudly naming the file", () => {
    writeFileSync(ledgerPath(), "{nope");
    expect(() => readLedger(dir)).toThrow(/\.owners\.json/);
  });
});

describe("withLedger", () => {
  it("round-trips entries and the version", () => {
    const hash = hashContent("body");
    withLedger(dir, "kj", (ledger) => { ledger.entries["rules/karajan.md"] = { owner: "kj", hash }; });
    expect(readLedger(dir)).toEqual({ version: 1, entries: { "rules/karajan.md": { owner: "kj", hash } } });
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it("a held lock fails naming who holds it, and leaves the ledger valid", () => {
    withLedger(dir, "kj", (l) => { l.entries[mcpKey("a")] = { owner: "kj", hash: hashContent("a") }; });
    writeFileSync(join(dir, LOCK_FILE), "atril");
    expect(() => withLedger(dir, "kj", () => {})).toThrow(/held by atril/);
    expect(JSON.parse(readFileSync(ledgerPath(), "utf8")).entries).toHaveProperty("mcp:a");
  });

  it("releases the lock and writes nothing when the change throws", () => {
    expect(() => withLedger(dir, "kj", () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    expect(existsSync(ledgerPath())).toBe(false);
  });
});

describe("verifyEntry", () => {
  const ledger = { version: 1, entries: { "mcp:a": { owner: "kj", hash: hashContent("same") } } };

  it("ok when the content still matches its hash", () => {
    expect(verifyEntry(ledger, "mcp:a", "same")).toBe("ok");
  });

  it("edited when the content changed by hand", () => {
    expect(verifyEntry(ledger, "mcp:a", "changed")).toBe("edited");
  });

  it("unowned when no writer recorded it: it is the user's", () => {
    expect(verifyEntry(ledger, "mcp:b", "anything")).toBe("unowned");
  });
});
