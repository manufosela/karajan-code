// HU-0001 (ADR 0022, decision 3): the ownership ledger lets several writers (the user, kj,
// atril) share one .rulesync/ without overwriting each other: versioned, atomic, locked.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashContent, hookKey, LEDGER_FILE, LEDGER_VERSION, LOCK_FILE, mcpKey, permissionKey,
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
    expect(() => hookKey("pre:tool", "x")).toThrow(/event/);
  });
});

describe("readLedger", () => {
  it("an absent ledger is empty, version 1", () => {
    expect(readLedger(dir)).toEqual({ version: LEDGER_VERSION, entries: {} });
  });

  it.each([
    ["an unknown version", { version: 2, entries: {} }, /\.owners\.json.*version 2/],
    ["entries is a list", { version: 1, entries: [] }, /entries/],
    ["entries is missing", { version: 1 }, /entries/],
    ["an entry has no owner", { version: 1, entries: { k: { hash: `sha256:${"0".repeat(64)}` } } }, /"k"/],
    ["an entry hash is not sha256", { version: 1, entries: { k: { owner: "kj", hash: "md5:x" } } }, /"k"/],
    // KJC-TSK-1129 (review of #2294): a list holding a valid hash must not pass as one.
    ["an entry hash is not a string", { version: 1, entries: { k: { owner: "kj", hash: [`sha256:${"0".repeat(64)}`] } } }, /"k"/],
    ["garbage", "{nope", /\.owners\.json.*not valid JSON/],
  ])("a malformed ledger fails naming what is wrong: %s", (_label, ledger, why) => {
    writeFileSync(ledgerPath(), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
    expect(() => readLedger(dir)).toThrow(why);
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
    expect(() => withLedger(dir, "kj", () => {})).toThrow(/held by atril.*if no writer is running, delete/);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
    expect(JSON.parse(readFileSync(ledgerPath(), "utf8")).entries).toHaveProperty("mcp:a");
  });

  it.each([
    ["throws", () => { throw new Error("boom"); }, /boom/],
    ["leaves an entry without hash", (l) => { l.entries.k = { owner: "kj" }; }, /"k"/],
    ["sets a wrong version", (l) => { l.version = 2; }, /version 2/],
  ])("releases the lock and writes nothing when the change %s", (_label, change, why) => {
    expect(() => withLedger(dir, "kj", change)).toThrow(why);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it("a missing .rulesync/ fails saying to run rulesync init", () => {
    rmSync(join(dir, ".rulesync"), { recursive: true });
    expect(() => withLedger(dir, "kj", () => {})).toThrow(/\.rulesync\/ is missing.*run rulesync init/);
  });

  it("records who holds the lock and its pid while the change runs", () => {
    withLedger(dir, "kj", () => expect(readFileSync(join(dir, LOCK_FILE), "utf8")).toBe(`kj ${process.pid}`));
  });

  it("an empty owner fails before taking the lock", () => {
    expect(() => withLedger(dir, "", () => {})).toThrow(/owner/);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
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
    expect(verifyEntry(ledger, "constructor", "anything")).toBe("unowned");
  });
});
