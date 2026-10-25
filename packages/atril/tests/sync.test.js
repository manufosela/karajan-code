// ADR 0021, decision 11 and plan step 9b: atril sync writes its persistent pieces into
// .rulesync/ through the ownership ledger, and never touches what is not its own.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expose, MARKER, unexpose } from "../src/bridge.js";
import { hashContent, readLedger, withLedger } from "../src/ledger.js";
import { sync } from "../src/sync.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-sync-"));
  mkdirSync(join(dir, ".rulesync"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const read = (rel) => readFileSync(join(dir, ".rulesync", rel), "utf8");
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const actions = (result) => Object.fromEntries(result.map(({ path, action }) => [path, action]));

describe("atril sync", () => {
  it("writes the bridge and the router rule, owned by atril in the ledger, and then has nothing to do", () => {
    expect(actions(sync(o()))).toEqual({ "commands/atril.md": "written", "rules/atril-router.md": "written" });
    expect(read("commands/atril.md")).toContain(MARKER);
    expect(readLedger(dir).entries["commands/atril.md"]).toEqual({ owner: "atril", hash: hashContent(read("commands/atril.md")) });
    expect(sync(o()).every(({ action }) => action === "unchanged")).toBe(true);
  });

  it("removes an exposed skill once it is unexposed, its folder and its entries with it", () => {
    put("store/skills/tdd/SKILL.md", "---\nname: tdd\ndescription: d\nkind: skill\n---\nbody\n");
    put("store/skills/tdd/refs/notes.md", "notes");
    expose(["skill:tdd"], o());
    expect(actions(sync(o()))["skills/tdd/refs/notes.md"]).toBe("written");
    unexpose(["skill:tdd"], o());
    expect(actions(sync(o()))).toMatchObject({ "skills/tdd/SKILL.md": "removed", "skills/tdd/refs/notes.md": "removed" });
    expect(existsSync(join(dir, ".rulesync", "skills", "tdd"))).toBe(false);
    expect(Object.keys(readLedger(dir).entries)).toEqual(["commands/atril.md", "rules/atril-router.md"]);
  });

  it("claims, once, a file carrying its marker that the ledger does not know", () => {
    put(".rulesync/commands/atril.md", `---\ndescription: old\n---\n${MARKER}\nold bridge\n`);
    expect(actions(sync(o()))["commands/atril.md"]).toBe("claimed");
    expect(read("commands/atril.md")).toContain("atril route");
  });

  it("stops before writing anything over a hand edit, a user's file or another owner's entry", () => {
    sync(o());
    put(".rulesync/commands/atril.md", `${read("commands/atril.md")}my edit\n`);
    rmSync(join(dir, ".rulesync", "rules", "atril-router.md"));
    withLedger(dir, (ledger) => { delete ledger.entries["rules/atril-router.md"]; });
    expect(() => sync(o())).toThrow(/commands\/atril\.md: edited by hand/);
    expect(existsSync(join(dir, ".rulesync", "rules", "atril-router.md"))).toBe(false);
    put(".rulesync/commands/atril.md", "---\ndescription: mine\n---\nmine\n");
    withLedger(dir, (ledger) => { delete ledger.entries["commands/atril.md"]; });
    expect(() => sync(o())).toThrow(/not written by atril/);
    withLedger(dir, (ledger) => { ledger.entries["commands/atril.md"] = { owner: "kj", hash: hashContent("x") }; });
    expect(() => sync(o())).toThrow(/belongs to kj/);
  });

  it("never writes through a symlink inside .rulesync/", () => {
    mkdirSync(join(dir, "outside"));
    symlinkSync(join(dir, "outside"), join(dir, ".rulesync", "commands"));
    expect(() => sync(o())).toThrow(/commands is a symlink/);
    expect(readdirSync(join(dir, "outside"))).toEqual([]);
  });

  it("refuses a ledger key outside rulesync's kind folders, and a project without .rulesync/", () => {
    withLedger(dir, (ledger) => { ledger.entries["../escape.md"] = { owner: "atril", hash: hashContent("x") }; });
    expect(() => sync(o())).toThrow(/"\.\.\/escape\.md" is not a path atril writes/);
    rmSync(join(dir, ".rulesync"), { recursive: true });
    expect(() => sync(o())).toThrow(/installs nothing persistent without rulesync/);
  });

  it("runs from the CLI", () => {
    const res = spawnSync(process.execPath, [BIN, "sync", "--root", "store"], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "nu") } });
    expect(res.stdout).toBe("written\tcommands/atril.md\nwritten\trules/atril-router.md\n");
  });
});
