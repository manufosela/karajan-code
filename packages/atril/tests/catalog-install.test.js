// ADR 0021, decision 12 and plan step 11c: atril install kind:name takes an available
// artifact from a catalog into the store; installing stays an explicit step.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFromCatalog } from "../src/catalog-install.js";
import { writeConfig } from "../src/config.js";
import { catalogSync } from "../src/fetch.js";
import { search } from "../src/search.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
let dir;
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-catalog-install-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const o = () => ({ projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") });
const env = () => ({ ...process.env, ATRIL_USER_ROOT: join(dir, "nu") });

describe("atril install kind:name", () => {
  it("installs a folder catalog's artifact, which then is installed, not available", () => {
    put("kit/commands/deploy.md", "---\nname: deploy\ndescription: deploy the app\nkind: command\n---\nbody\n");
    writeConfig({ catalogs: ["kit"] }, o());
    expect(installFromCatalog("command:deploy", o())).toMatchObject({ status: "installed", catalog: "kit", path: join(dir, "store", "commands", "deploy.md") });
    expect(search("deploy", o()).map(({ installed }) => installed)).toEqual([true]);
    expect(() => installFromCatalog("command:deploy", o())).toThrow(/command:deploy is already installed/);
  });

  it("installs a fetched OpenSkills skill with its whole folder, declaring kind: skill", () => {
    const remote = join(dir, "remotes", "acme", "skills.git");
    put("remotes/acme/skills.git/lint/SKILL.md", "---\nname: lint\ndescription: lint the code\n---\nbody\n");
    put("remotes/acme/skills.git/lint/rules.md", "rules");
    git(remote, "init", "--quiet");
    git(remote, "add", "-A");
    git(remote, "commit", "--quiet", "-m", "skills");
    put("pins.json", JSON.stringify({ sources: [{ source: "acme/skills", commit: git(remote, "rev-parse", "HEAD"), note: "acme" }] }));
    writeConfig({ catalogs: ["pins.json"] }, o());
    catalogSync(o(), { gitBase: `file://${join(dir, "remotes")}` });
    expect(installFromCatalog("skill:lint", o())).toMatchObject({ status: "installed", catalog: "pins.json" });
    expect(readFileSync(join(dir, "store", "skills", "lint", "SKILL.md"), "utf8")).toBe("---\nkind: skill\nname: lint\ndescription: lint the code\n---\nbody\n");
    expect(readFileSync(join(dir, "store", "skills", "lint", "rules.md"), "utf8")).toBe("rules");
  });

  it("names what no catalog offers, from the API and the CLI", () => {
    expect(() => installFromCatalog("skill:ghost", o())).toThrow(/skill:ghost is not in any catalog .*atril catalog sync/);
    const res = spawnSync(process.execPath, [BIN, "install", "skill:ghost", "--root", "store"], { cwd: dir, encoding: "utf8", env: env() });
    expect([res.status, res.stderr]).toEqual([1, expect.stringMatching(/skill:ghost is not in any catalog/)]);
  });
});
