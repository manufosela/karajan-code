// HU-3181 part 1 (ADR 0041): a plugin's hooks and MCP entries are merged into .rulesync/ and owned in the ledger.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLedger } from "../src/ledger.js";
import { mergeEntries, removeEntries } from "../src/rulesync-entries.js";
import { sync } from "../src/sync.js";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-entries-"));
  mkdirSync(join(dir, ".rulesync"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const file = (name) => join(dir, ".rulesync", name);
const json = (name) => JSON.parse(readFileSync(file(name), "utf8"));
const put = (name, text) => writeFileSync(file(name), typeof text === "string" ? text : JSON.stringify(text));
const hook = { type: "command", command: "echo hi" };
const entries = { mcp: { mcpServers: { db: { command: "db", env: { DB_HOST: "${DB_HOST}" } } } }, hooks: { hooks: { sessionStart: [hook] } } };

describe("mergeEntries / removeEntries", () => {
  it("creates the .json files and owns each entry in the ledger", () => {
    mergeEntries(dir, "kit", entries);
    expect([json("mcp.json").mcpServers.db.command, json("hooks.json").hooks.sessionStart]).toEqual(["db", [hook]]);
    expect(Object.keys(readLedger(dir).entries).map((key) => key.replace(/[0-9a-f]{64}/, "<sha>")).sort()).toEqual(["hooks.json#kit/sessionStart/<sha>", "mcp.json#kit/db"]);
    expect(() => sync({ projectDir: dir, root: join(dir, ".atril"), userRoot: join(dir, "u"), env: {} })).not.toThrow(); // atril sync leaves plugin entries alone
  });


  it("leaves user entries and other plugins' entries intact, and remove undoes exactly its own", () => {
    put("mcp.json", { mcpServers: { mine: { command: "x" } } });
    put("hooks.json", { version: 1, hooks: { sessionStart: [hook] } }); // identical to the plugin's handler: only one occurrence goes
    mergeEntries(dir, "other", { mcp: { mcpServers: { o: { command: "o" } } } });
    const before = [json("mcp.json"), json("hooks.json")];
    mergeEntries(dir, "kit", entries);
    removeEntries(dir, "kit");
    expect([json("mcp.json"), json("hooks.json")]).toEqual(before);
    expect(Object.keys(readLedger(dir).entries)).toEqual(["mcp.json#other/o"]);
  });

  it("a reinstall replaces the plugin's entries in every file, even a kind the new version omits", () => {
    mergeEntries(dir, "kit", entries);
    mergeEntries(dir, "kit", entries);
    expect(json("hooks.json").hooks.sessionStart).toHaveLength(1);
    mergeEntries(dir, "kit", { mcp: entries.mcp });
    expect(json("hooks.json").hooks).toEqual({});
  });

  it("an entry the user edited is theirs: remove keeps and lists it, a reinstall stops with a conflict", () => {
    mergeEntries(dir, "kit", entries);
    const ledger = readFileSync(file(".owners.json"), "utf8");
    for (const edited of [{ command: "edited" }, null, 0]) { // a falsy replacement is an edit too
      put("mcp.json", { mcpServers: { db: edited } });
      expect(() => mergeEntries(dir, "kit", entries)).toThrow(/"db" was edited since atril wrote it/);
      expect([json("mcp.json").mcpServers.db, readFileSync(file(".owners.json"), "utf8")]).toEqual([edited, ledger]);
    }
    expect(removeEntries(dir, "kit").kept).toEqual(["mcp.json#kit/db"]);
    expect(json("mcp.json").mcpServers.db).toBe(0);
    expect(Object.keys(readLedger(dir).entries)).toEqual([]);
  });

  it("stops without changing anything when a user entry has the key atril would write", () => {
    put("mcp.json", { mcpServers: { db: { command: "mine" } } });
    expect(() => mergeEntries(dir, "kit", entries)).toThrow(/mcp\.json: "db" is already an entry/);
    expect(json("mcp.json").mcpServers.db.command).toBe("mine");
    expect(existsSync(file("hooks.json"))).toBe(false);
  });

  it("a winning .jsonc is acted on and the .json is never written; a comment in it stops with a clear error", () => {
    put("mcp.jsonc", { mcpServers: {} });
    mergeEntries(dir, "kit", entries);
    expect([json("mcp.jsonc").mcpServers.db.command, existsSync(file("mcp.json"))]).toEqual(["db", false]);
    const text = '{\n  // mine\n  "mcpServers": {}\n}'; put("mcp.jsonc", text);
    expect(() => mergeEntries(dir, "other", entries)).toThrow(/mcp\.jsonc: comments or trailing commas/);
    expect(readFileSync(file("mcp.jsonc"), "utf8")).toBe(text);
    put("hooks.json", "[]");
    expect(() => mergeEntries(dir, "other", { hooks: entries.hooks })).toThrow(/hooks\.json: must be a JSON object/);
  });

  it("rejects names that could poison an object or escape the key", () => {
    expect(() => mergeEntries(dir, "a/b", entries)).toThrow(/plugin name/);
    expect(() => mergeEntries(dir, "kit", { mcp: { mcpServers: { constructor: {} } } })).toThrow(/"constructor"/);
  });
});
