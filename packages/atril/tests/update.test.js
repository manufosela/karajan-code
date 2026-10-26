// ADR 0031: the catalogs keep themselves current. catalogUpdates says, per git source, whether
// a newer commit exists and the diff of its skills, so another AI can review it; nothing moves.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { applyCatalogUpdate, catalogUpdates } from "../src/update.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
let first;
let second;
const remote = () => join(dir, "remotes", "acme", "skills.git");
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-update-"));
  put("remotes/acme/skills.git/tools/lint/SKILL.md", "---\nname: lint\ndescription: lint the code\n---\nbody\n");
  git(remote(), "init", "--quiet");
  git(remote(), "add", "-A");
  git(remote(), "commit", "--quiet", "-m", "one");
  first = git(remote(), "rev-parse", "HEAD");
  put("remotes/acme/skills.git/tools/lint/SKILL.md", "---\nname: lint\ndescription: lint the code strictly\n---\nbody\n");
  git(remote(), "commit", "--quiet", "-am", "two");
  second = git(remote(), "rev-parse", "HEAD");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store" });
const pin = (commit) => {
  put("pins.json", JSON.stringify({ sources: [{ source: "acme/skills/tools", commit, note: "acme" }] }));
  writeConfig({ catalogs: ["pins.json"] }, o());
};
const how = () => ({ gitBase: `file://${join(dir, "remotes")}` });

describe("catalogUpdates", () => {
  it("finds a newer commit and gives the diff of the source's skills, moving nothing", () => {
    pin(first);
    const [update] = catalogUpdates(o(), how());
    expect(update).toMatchObject({ catalog: "pins.json", source: "acme/skills/tools", from: first, to: second, status: "outdated" });
    expect(update.diff).toContain("-description: lint the code\n");
    expect(update.diff).toContain("+description: lint the code strictly\n");
    expect(JSON.parse(readFileSync(join(dir, "pins.json"), "utf8")).sources[0].commit).toBe(first);
  });

  it("says current when the pin is the latest commit", () => {
    pin(second);
    expect(catalogUpdates(o(), how())).toEqual([{ catalog: "pins.json", source: "acme/skills/tools", from: second, to: second, status: "current" }]);
  });

  it("applies a reviewed update by rewriting only the pin, and refuses a commit never fetched", () => {
    put("pins.json", JSON.stringify({ sources: [{ source: "acme/skills/tools", commit: first, note: "acme" }], about: "kept" }));
    writeConfig({ catalogs: ["pins.json"] }, o());
    expect(() => applyCatalogUpdate(o(), { catalog: "pins.json", source: "acme/skills/tools", to: second })).toThrow(/not in the cache/);
    const [update] = catalogUpdates(o(), how());
    applyCatalogUpdate(o(), update);
    expect(JSON.parse(readFileSync(join(dir, "pins.json"), "utf8"))).toEqual({ sources: [{ source: "acme/skills/tools", commit: second, note: "acme" }], about: "kept" });
    expect(() => applyCatalogUpdate(o(), { catalog: "pins.json", source: "acme/other", to: second })).toThrow(/has no source "acme\/other"/);
  });

  it("runs from the CLI, with nothing to check when no catalog lists git sources", () => {
    const res = spawnSync(process.execPath, [BIN, "catalog", "update", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect([res.status, res.stdout.trim()]).toEqual([0, "no git sources to check"]);
  });

  it("fails naming catalog and source when the remote cannot be read", () => {
    pin(first);
    expect(() => catalogUpdates(o(), { gitBase: `file://${join(dir, "nowhere")}` })).toThrow(/catalog "pins\.json": acme\/skills\/tools could not be checked for updates/);
  });
});
