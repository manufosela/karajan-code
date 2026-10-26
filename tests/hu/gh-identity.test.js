// KJC-TSK-1186: with an identity declared, kj hu on the shared board refuses to write as another
// gh account, and says the exact command that fixes it, before any gh call.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeGhUser, assertGhIdentity, pinGhIdentity } from "../../src/hu/gh-identity.js";
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

// KJC-BUG-0406: checking the account first was a race; another session switched it between the
// check and the gh calls, and #2540 was created as another account, without its labels.
describe("pinGhIdentity", () => {
  it("pins GH_TOKEN to the declared account's token, whatever account is active", () => {
    hosts("other");
    declare("manufosela");
    const env = { GH_CONFIG_DIR: ghDir };
    const tokenOf = vi.fn(() => "tok-manufosela");
    expect(pinGhIdentity({ projectDir, env, tokenOf })).toEqual({ declared: "manufosela", pinned: true });
    expect(tokenOf).toHaveBeenCalledWith("manufosela", env);
    expect(env.GH_TOKEN).toBe("tok-manufosela");
  });

  it("pins nothing without a declaration, or when the environment already names a token", () => {
    const env = { GH_CONFIG_DIR: ghDir };
    expect(pinGhIdentity({ projectDir, env, tokenOf: () => "x" })).toEqual({ declared: null, pinned: false });
    declare("manufosela");
    const explicit = { GH_TOKEN: "mine" };
    expect(pinGhIdentity({ projectDir, env: explicit, tokenOf: () => "x" })).toEqual({ declared: "manufosela", pinned: false });
    expect(explicit.GH_TOKEN).toBe("mine");
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it("refuses with the remedy when gh has no login for the declared account", () => {
    declare("manufosela");
    expect(() => pinGhIdentity({ projectDir, env: {}, tokenOf: () => null })).toThrow(/no login for manufosela.*gh auth login/);
  });
});

describe("kj hu on the shared board", () => {
  it("pins the account before touching GitHub, and nothing reaches GitHub when it cannot", async () => {
    const listTeamHus = vi.fn(async () => []);
    const deps = { boardConfig: async () => ({ backend: "github", repo: "acme/app" }), listTeamHus, who: "me" };
    const refuse = vi.fn(() => { throw new Error("gh has no login for manufosela"); });
    await expect(huCommand({ config: { projectDir }, action: "list", deps: { ...deps, pinGhIdentity: refuse } })).rejects.toThrow(/no login/);
    expect(refuse).toHaveBeenCalledWith({ projectDir });
    expect(listTeamHus).not.toHaveBeenCalled();
  });
});
