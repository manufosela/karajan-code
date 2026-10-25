// ADR 0022, decision 3: atril keeps its share of .rulesync/ in the same ownership ledger kj
// uses, implemented in its own package (ADR 0021, decision 11).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, LEDGER_FILE, LOCK_FILE, readLedger, withLedger } from "../src/ledger.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-ledger-"));
  mkdirSync(join(dir, ".rulesync"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const ledgerAt = (text) => writeFileSync(join(dir, LEDGER_FILE), text);
const HASH = hashContent("x");

describe("ledger", () => {
  it("is empty when absent, and hashes as sha256:<hex>", () => {
    expect(readLedger(dir)).toEqual({ version: 1, entries: {} });
    expect(HASH).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is changed under its lock, written whole, and the lock is gone afterwards", () => {
    withLedger(dir, (ledger) => {
      expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
      ledger.entries["commands/atril.md"] = { owner: "atril", hash: HASH };
    });
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8")).entries["commands/atril.md"]).toEqual({ owner: "atril", hash: HASH });
  });

  it("writes nothing when the change throws or leaves a malformed entry", () => {
    expect(() => withLedger(dir, () => { throw new Error("boom"); })).toThrow("boom");
    expect(() => withLedger(dir, (ledger) => { ledger.entries.x = { owner: "atril" }; })).toThrow(/entry "x" needs/);
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(false);
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
  });

  it("never steals a held lock: it names the holder and how to clear it", () => {
    writeFileSync(join(dir, LOCK_FILE), "kj 4242");
    expect(() => withLedger(dir, () => {})).toThrow(/held by kj 4242[\s\S]*delete/);
    expect(readFileSync(join(dir, LOCK_FILE), "utf8")).toBe("kj 4242");
  });

  it("fails loudly on a missing .rulesync/, broken JSON, another version or a bad entry", () => {
    rmSync(join(dir, ".rulesync"), { recursive: true });
    expect(() => withLedger(dir, () => {})).toThrow(/\.rulesync\/ is missing/);
    mkdirSync(join(dir, ".rulesync"));
    ledgerAt("{");
    expect(() => readLedger(dir)).toThrow(/not valid JSON/);
    ledgerAt('{"version":2,"entries":{}}');
    expect(() => readLedger(dir)).toThrow(/version 2 is not supported/);
    ledgerAt('{"version":1,"entries":{"a":{"owner":"kj","hash":"md5:1"}}}');
    expect(() => readLedger(dir)).toThrow(/entry "a" needs/);
  });
});
