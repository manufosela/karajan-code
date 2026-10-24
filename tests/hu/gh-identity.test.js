// KJC-TSK-1186: with an identity declared, kj hu on the shared board refuses to write as another
// gh account, and says the exact command that fixes it, before any gh call.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeGhUser, assertGhIdentity } from "../../src/hu/gh-identity.js";
import { huCommand } from "../../src/commands/hu.js";

let root, projectDir, ghDir;
const hosts = (user) => writeFileSync(join(ghDir, "hosts.yml"), `github.com:\n    users:\n        manufosela:\n        other:\n    user: ${user}\n    git_protocol: ssh\n`);
const declare = (ghUser) => writeFileSync(join(projectDir, ".karajan", "identity.local.yml"), `gh_user: ${ghUser}\ngit_email: dev@example.test\n`);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-gh-id-"));
  projectDir = join(root, "proj");
  ghDir = join(root, "gh");
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  mkdirSync(ghDir);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("activeGhUser", () => {
  it("reads the account gh would use, under GH_CONFIG_DIR, and null when gh has none", () => {
    expect(activeGhUser({ GH_CONFIG_DIR: ghDir })).toBeNull();
    hosts("other");
    expect(activeGhUser({ GH_CONFIG_DIR: ghDir })).toBe("other");
    expect(activeGhUser({ XDG_CONFIG_HOME: join(root, "empty") })).toBeNull();
  });
});

describe("assertGhIdentity", () => {
  it("asserts nothing without a declaration, passes when the accounts match, refuses with the remedy otherwise", () => {
    hosts("other");
    expect(assertGhIdentity({ projectDir, env: { GH_CONFIG_DIR: ghDir } })).toEqual({ declared: null, active: null });
    declare("other");
    expect(assertGhIdentity({ projectDir, env: { GH_CONFIG_DIR: ghDir } })).toEqual({ declared: "other", active: "other" });
    declare("manufosela");
    expect(() => assertGhIdentity({ projectDir, env: { GH_CONFIG_DIR: ghDir } })).toThrow(/active gh account is other and this clone declares manufosela: run gh auth switch --user manufosela/);
    rmSync(join(ghDir, "hosts.yml"));
    expect(assertGhIdentity({ projectDir, env: { GH_CONFIG_DIR: ghDir } })).toEqual({ declared: "manufosela", active: null });
  });
});

describe("kj hu on the shared board", () => {
  it("checks the account before touching GitHub, and leaves the local board alone", async () => {
    hosts("other");
    declare("manufosela");
    const prev = process.env.GH_CONFIG_DIR;
    process.env.GH_CONFIG_DIR = ghDir;
    const listTeamHus = vi.fn(async () => []);
    try {
      await expect(huCommand({ config: { projectDir }, action: "list", deps: { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus, who: "me" } }))
        .rejects.toThrow(/gh auth switch --user manufosela/);
      expect(listTeamHus).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.GH_CONFIG_DIR; else process.env.GH_CONFIG_DIR = prev;
    }
  });
});
