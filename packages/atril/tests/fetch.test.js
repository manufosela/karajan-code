// ADR 0021, decision 12 and plan step 11b: atril catalog sync fetches each pinned source into
// a cache under the store, at exactly its commit, and installs nothing.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sourceDir } from "../src/catalog.js";
import { writeConfig } from "../src/config.js";
import { catalogSync } from "../src/fetch.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
let commit;
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-fetch-"));
  const remote = join(dir, "remotes", "acme", "skills.git");
  put("remotes/acme/skills.git/tools/lint/SKILL.md", "---\nname: lint\ndescription: lint the code\n---\nbody\n");
  symlinkSync("/etc/passwd", join(remote, "tools", "lint", "evil"));
  git(remote, "init", "--quiet");
  git(remote, "add", "-A");
  git(remote, "commit", "--quiet", "-m", "skills");
  commit = git(remote, "rev-parse", "HEAD");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store" });
const pin = (sha) => {
  put("pins.json", JSON.stringify({ sources: [{ source: "acme/skills/tools", commit: sha, note: "acme's tools" }] }));
  writeConfig({ catalogs: ["pins.json"] }, o());
};
const gitBase = () => `file://${join(dir, "remotes")}`;

describe("atril catalog sync", () => {
  it("fetches a pinned source into the cache once, at its commit, without its git history", () => {
    pin(commit);
    expect(catalogSync(o(), { gitBase: gitBase() }).map(({ status }) => status)).toEqual(["fetched"]);
    const at = sourceDir(o(), { source: "acme/skills/tools", commit });
    expect(at).toBe(join(dir, "store", ".cache", "catalogs", "acme", "skills", commit));
    expect(readFileSync(join(at, "tools", "lint", "SKILL.md"), "utf8")).toContain("lint the code");
    expect(existsSync(join(at, ".git"))).toBe(false);
    expect(catalogSync(o(), { gitBase: gitBase() }).map(({ status }) => status)).toEqual(["cached"]);
  });

  it("never materializes a symlink from the fetched repo", () => {
    pin(commit);
    catalogSync(o(), { gitBase: gitBase() });
    const evil = join(sourceDir(o(), { source: "acme/skills/tools", commit }), "tools", "lint", "evil");
    expect(lstatSync(evil).isSymbolicLink()).toBe(false);
    expect(readFileSync(evil, "utf8")).toBe("/etc/passwd");
  });

  it("fails naming the source and leaves nothing half-fetched", () => {
    pin("b".repeat(40));
    expect(() => catalogSync(o(), { gitBase: gitBase() })).toThrow(/catalog "pins\.json": acme\/skills\/tools@bbbbbbbbbbbb could not be fetched/);
    expect(readdirSync(join(dir, "store", ".cache", "catalogs", "acme", "skills"))).toEqual([]);
  });

  it("runs from the CLI, with nothing to fetch when no catalog lists git sources", () => {
    const res = spawnSync(process.execPath, [BIN, "catalog", "sync", "--root", "store"], { cwd: dir, encoding: "utf8" });
    expect([res.status, res.stdout.trim()]).toEqual([0, "no git sources to fetch"]);
  });
});
