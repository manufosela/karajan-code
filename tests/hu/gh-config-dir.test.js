// KJC-BUG-0530 (HU-3699): a clone whose account lives in another gh config dir (gh-ox, gh-tribbu)
// declares that dir, and kj uses it for every gh call, so harden can read the branch protection.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDeclaredGhConfig } from "../../src/hu/gh-identity.js";
import { readIdentity } from "../../src/identity/store.js";
import { identityCommand } from "../../src/commands/identity.js";

let root, projectDir, ghDir;
const identityFile = () => join(projectDir, ".karajan", "identity.local.yml");
const declare = (extra = "") => writeFileSync(identityFile(), `gh_user: dev-ox\ngit_email: dev@example.test\n${extra}`);
const run = async (flags) => {
  const lines = [];
  const code = await identityCommand({ action: "set", config: { projectDir }, flags: { yes: true, ...flags }, deps: { log: (l) => lines.push(l), isTTY: () => false, env: {} } });
  return { code, out: lines.join("\n") };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kj-gh-dir-"));
  projectDir = join(root, "proj");
  ghDir = join(root, "gh-ox");
  mkdirSync(join(projectDir, ".karajan"), { recursive: true });
  mkdirSync(ghDir);
  writeFileSync(join(ghDir, "hosts.yml"), "github.com:\n    users:\n        dev-ox:\n    user: dev-ox\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the declared gh config dir", () => {
  it("is read from the declaration, with ~ expanded, and absent when not declared", () => {
    declare();
    expect(readIdentity(projectDir).gh_config_dir).toBeUndefined();
    declare("gh_config_dir: ~/.config/gh-ox\n");
    expect(readIdentity(projectDir).gh_config_dir).toBe(join(homedir(), ".config/gh-ox"));
  });

  it("becomes GH_CONFIG_DIR for kj's gh calls, unless one is already set", () => {
    const env = {};
    applyDeclaredGhConfig({ projectDir, env });
    expect(env).toEqual({});
    declare(`gh_config_dir: ${ghDir}\n`);
    applyDeclaredGhConfig({ projectDir, env });
    expect(env.GH_CONFIG_DIR).toBe(ghDir);
    const explicit = { GH_CONFIG_DIR: "/chosen" };
    applyDeclaredGhConfig({ projectDir, env: explicit });
    expect(explicit.GH_CONFIG_DIR).toBe("/chosen");
  });
});

describe("kj identity set --gh-config-dir", () => {
  it("takes the account from that dir and declares the dir", async () => {
    const { code } = await run({ email: "dev@example.test", ghConfigDir: ghDir });
    expect(code).toBe(0);
    expect(readIdentity(projectDir)).toMatchObject({ gh_user: "dev-ox", gh_config_dir: ghDir });
  });

  it("refuses a dir where gh has no login, and declares nothing", async () => {
    const empty = join(root, "nothing");
    const { code, out } = await run({ gh: "dev-ox", email: "dev@example.test", ghConfigDir: empty });
    expect(code).toBe(1);
    expect(out).toContain(`${empty} has no gh login (hosts.yml)`);
    expect(() => readFileSync(identityFile())).toThrow();
  });
});
