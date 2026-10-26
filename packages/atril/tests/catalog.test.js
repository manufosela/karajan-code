// ADR 0021, decision 12 and plan step 11a: catalogs are declared in atril.json and searched
// before anything is installed; what they offer is "available", installing stays explicit.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogs } from "../src/catalog.js";
import { writeConfig } from "../src/config.js";
import { resolve } from "../src/resolve.js";
import { search } from "../src/search.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-catalog-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const command = (rel, name, description) => put(rel, `---\nname: ${name}\ndescription: ${description}\nkind: command\n---\nbody\n`);
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const COMMIT = "a".repeat(40);

describe("catalogs", () => {
  it("read a store-shaped folder and a sources file, both relative to the project", () => {
    command("kit/commands/deploy.md", "deploy", "deploy the app");
    put("pins.json", JSON.stringify({ sources: [{ source: "acme/skills/tools", commit: COMMIT, note: "acme's tools" }] }));
    writeConfig({ catalogs: ["kit", "pins.json"] }, o());
    expect(catalogs(o())).toEqual([
      { ref: "kit", type: "store", dir: join(dir, "kit") },
      { ref: "pins.json", type: "sources", sources: [{ source: "acme/skills/tools", commit: COMMIT, note: "acme's tools" }] },
    ]);
  });

  it("refuse a missing catalog, a source with .. or no repo, a short commit and a missing note", () => {
    const bad = (sources) => {
      put("pins.json", JSON.stringify({ sources }));
      writeConfig({ catalogs: ["pins.json"] }, o());
      return () => catalogs(o());
    };
    writeConfig({ catalogs: ["nowhere"] }, o());
    expect(() => catalogs(o())).toThrow(/catalog "nowhere": .* not found/);
    expect(bad([{ source: "acme/../x", commit: COMMIT, note: "n" }])).toThrow(/source "acme\/\.\.\/x" is not owner\/repo\[\/path\]/);
    expect(bad([{ source: "acme", commit: COMMIT, note: "n" }])).toThrow(/source "acme" is not owner\/repo/);
    expect(bad([{ source: "acme/skills", commit: "abc123", note: "n" }])).toThrow(/commit .* 40 hex/);
    expect(bad([{ source: "acme/skills", commit: COMMIT }])).toThrow(/note/);
  });
});

describe("available artifacts", () => {
  beforeEach(() => {
    command("store/commands/review.md", "review", "review a pull request");
    command("kit/commands/review.md", "review", "the catalog's review");
    command("kit/commands/deploy.md", "deploy", "deploy the app to production");
    writeConfig({ catalogs: ["kit"] }, o());
  });

  it("show in search as not installed, and an installed artifact wins over the catalog's", () => {
    expect(search("review deploy", o()).map(({ name, installed, source }) => [name, installed, source])).toEqual([
      ["deploy", false, "catalog:kit"],
      ["review", true, "project"],
    ]);
  });

  it("are proposed by resolve, never loaded", () => {
    const result = resolve({ task: "deploy the app", ...o() });
    expect(result.block).toEqual([]);
    expect(result.available).toEqual([{ name: "deploy", kind: "command", description: "deploy the app to production", catalog: "kit" }]);
    const res = spawnSync(process.execPath, [BIN, "route", "deploy the app", "--root", "store"], { cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "nu") } });
    expect(res.stdout).toContain("available\tcommand:deploy\tfrom kit");
  });
});
