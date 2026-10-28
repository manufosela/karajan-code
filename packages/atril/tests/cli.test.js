// HU-0006 (ADR 0021, plan step 1): atril runs on its own and says its version.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFromCatalog } from "../src/catalog-install.js";
import { writeConfig } from "../src/config.js";
import { VERSION } from "../src/index.js";
import { recordInstall } from "../src/lock.js";

const BIN = fileURLToPath(new URL("../bin/atril.js", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("atril CLI", () => {
  it("is published as @karajan-family/atril with the bin atril", () => {
    expect(PKG.name).toBe("@karajan-family/atril");
    expect(PKG.bin).toEqual({ atril: "bin/atril.js" });
  });

  it("--version prints the package version", () => {
    expect(VERSION).toBe(PKG.version);
    expect(execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf8" }).trim()).toBe(PKG.version);
  });

  it("an unknown command fails loudly with the usage", () => {
    const res = spawnSync(process.execPath, [BIN, "nope"], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/unknown command "nope"/);
    expect(res.stderr).toMatch(/Usage: atril/);
  });

  describe("status", () => {
    const run = (dir, ...args) => spawnSync(process.execPath, [BIN, "status", "--root", join(dir, "store"), ...args], { encoding: "utf8", cwd: dir });
    const put = (dir, name, body) => {
      mkdirSync(join(dir, "store/commands"), { recursive: true });
      writeFileSync(join(dir, `store/commands/${name}.md`), `---\nname: ${name}\ndescription: d\nkind: command\n---\n${body}\n`);
    };
    let dir;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-cli-status-")); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("says nothing installed for an empty store", () => {
      expect(run(dir).stdout.trim()).toBe("nothing installed");
    });

    it("--json prints the array, and --check passes when there are only uncurated artifacts", () => {
      put(dir, "deploy", "body");
      const res = run(dir, "--json", "--check");
      expect(res.status).toBe(0);
      expect(JSON.parse(res.stdout)).toEqual([{ kind: "command", name: "deploy", state: "uncurated", origin: null }]);
      expect(run(dir).stdout).toBe("uncurated\tcommand:deploy\tunknown\n0 ok, 0 edited, 0 missing, 1 uncurated\n");
    });

    it("--check exits 1 when an artifact is edited", () => {
      put(dir, "deploy", "body");
      recordInstall({ kind: "command", name: "deploy", path: join(dir, "store/commands/deploy.md") }, { origin: "local" }, { root: join(dir, "store") });
      put(dir, "deploy", "changed");
      const res = run(dir, "--check");
      expect(res.status).toBe(1);
      expect(res.stdout).toMatch(/^edited\tcommand:deploy\tlocal\n/);
    });

    it("--check exits 1 when an artifact is missing, and prints a catalog origin with its ref", () => {
      put(dir, "deploy", "body");
      recordInstall({ kind: "command", name: "deploy", path: join(dir, "store/commands/deploy.md") }, { origin: "catalog", catalog: "team", source: "org/repo", commit: "a".repeat(40) }, { root: join(dir, "store") });
      rmSync(join(dir, "store/commands/deploy.md"));
      const res = run(dir, "--check");
      expect(res.status).toBe(1);
      expect(res.stdout).toBe("missing\tcommand:deploy\tcatalog team org/repo@aaaaaaaaaaaa\n0 ok, 0 edited, 1 missing, 0 uncurated\n");
    });
  });
});

// Step 10c2: `atril update` moves installed catalog artifacts; --yes never implies --discard-edits.
describe("atril update", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atril-cli-update-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const put = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const command = (rel, name, body) => put(rel, `---\nname: ${name}\ndescription: ${name}\nkind: command\n---\n${body}\n`);
  const read = (rel) => readFileSync(join(dir, rel), "utf8");
  const update = (...args) => spawnSync(process.execPath, [BIN, "update", "--root", "store", ...args], {
    cwd: dir, encoding: "utf8", env: { ...process.env, ATRIL_USER_ROOT: join(dir, "no-user-store") },
  });

  beforeEach(() => {
    command("kit/commands/deploy.md", "deploy", "v1");
    command("kit/commands/ship.md", "ship", "v1");
    const opts = { projectDir: dir, root: "store", userRoot: join(dir, "no-user-store") };
    writeConfig({ catalogs: ["kit"] }, opts);
    for (const ref of ["command:deploy", "command:ship"]) installFromCatalog(ref, opts);
    command("kit/commands/deploy.md", "deploy", "v2");
    command("kit/commands/ship.md", "ship", "v2");
    command("store/commands/ship.md", "ship", "mine");
  });

  it("without a terminal and without --yes is a dry run: diffs shown, nothing applied, exit 0", () => {
    const res = update();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/outdated\tcommand:deploy/);
    expect(res.stdout).toMatch(/edited\tcommand:ship/);
    expect(res.stdout).toMatch(/-v1[\s\S]*\+v2/);
    expect(res.stderr).toMatch(/pass --yes/);
    expect(read("store/commands/deploy.md")).toMatch(/v1/);
  });
  it("--yes applies the outdated ones and skips the edited one", () => {
    const res = update("--yes");
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/updated\tcommand:deploy/);
    expect(res.stdout).toMatch(/skipped\tcommand:ship.*--discard-edits/);
    expect(read("store/commands/deploy.md")).toMatch(/v2/);
    expect(read("store/commands/ship.md")).toMatch(/mine/);
  });
  it("--yes --discard-edits also replaces the edited one; --json adds applied", () => {
    const res = update("--yes", "--discard-edits", "--json");
    expect(JSON.parse(res.stdout).applied).toEqual(["command:deploy", "command:ship"]);
    expect(read("store/commands/ship.md")).toMatch(/v2/);
  });
  it("a named ref its catalog no longer offers fails instead of reporting up to date", () => {
    rmSync(join(dir, "kit", "commands", "deploy.md"));
    const res = update("--yes", "command:deploy");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/command:deploy: not offered by its catalog/);
  });
  it("a named ref that is not installed from a catalog fails before applying anything", () => {
    const res = update("--yes", "command:deploy", "command:ghost");
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/command:ghost/);
    expect(read("store/commands/deploy.md")).toMatch(/v1/);
  });
});
