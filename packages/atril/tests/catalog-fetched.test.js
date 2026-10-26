// ADR 0021, decision 12 and plan step 11b: once fetched, a git source's artifacts are indexed
// like any other and show as available. OpenSkills skills declare no kind: a SKILL.md is a skill.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfig } from "../src/config.js";
import { catalogSync } from "../src/fetch.js";
import { search } from "../src/search.js";

let dir;
let commit;
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atril-fetched-"));
  put("remotes/acme/skills.git/tools/lint/SKILL.md", skill("lint", "lint the code"));
  put("remotes/acme/skills.git/tools/fmt/SKILL.md", skill("fmt", "format the code"));
  const remote = join(dir, "remotes", "acme", "skills.git");
  git(remote, "init", "--quiet");
  git(remote, "add", "-A");
  git(remote, "commit", "--quiet", "-m", "skills");
  commit = git(remote, "rev-parse", "HEAD");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const pin = (source) => {
  put("pins.json", JSON.stringify({ sources: [{ source, commit, note: "acme's tools" }] }));
  writeConfig({ catalogs: ["pins.json"] }, o());
};
const fetch = () => catalogSync(o(), { gitBase: `file://${join(dir, "remotes")}` });
const hits = (query) => search(query, o()).map(({ name, kind, installed, catalog }) => [name, kind, installed, catalog]);

describe("fetched sources", () => {
  it("offer nothing until fetched, then their skill folders as available skills", () => {
    pin("acme/skills/tools");
    expect(hits("code")).toEqual([]);
    fetch();
    expect(hits("code")).toEqual([["fmt", "skill", false, "pins.json"], ["lint", "skill", false, "pins.json"]]);
  });

  it("read a source that points at one skill folder", () => {
    pin("acme/skills/tools/lint");
    fetch();
    expect(hits("code")).toEqual([["lint", "skill", false, "pins.json"]]);
  });

  it("fail naming the folder when a skill's name does not match it", () => {
    put("remotes/acme/skills.git/tools/fmt/SKILL.md", skill("formatter", "format the code"));
    git(join(dir, "remotes", "acme", "skills.git"), "commit", "--quiet", "-am", "rename");
    commit = git(join(dir, "remotes", "acme", "skills.git"), "rev-parse", "HEAD");
    pin("acme/skills/tools");
    fetch();
    expect(() => search("code", o())).toThrow(/fmt.*named after its folder/);
  });
});
